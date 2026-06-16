from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from backend.api.deps import cache_instance, get_unified_fetcher
from backend.api.routes.chart import _parse_yahoo_chart
from backend.core.crypto_adapter import CryptoAdapter
from backend.services.crypto_universe import load_candles, load_global, load_universe

_SECTOR_WEIGHTS: dict[str, dict[str, float]] = {
    "L1": {"BTC-USD": 0.65, "ETH-USD": 0.35},
    "DeFi": {"UNI-USD": 0.5, "AAVE-USD": 0.5},
    "Memes": {"DOGE-USD": 0.55, "SHIB-USD": 0.45},
    "AI": {"RNDR-USD": 0.6, "FET-USD": 0.4},
    "Gaming": {"IMX-USD": 0.5, "GALA-USD": 0.5},
    "RWA": {"ONDO-USD": 0.5, "MKR-USD": 0.5},
}

_ALLOWED_SORT_KEYS = {"market_cap", "volume_24h", "change_24h", "price", "symbol"}
FetcherFactory = Callable[[], Awaitable[Any]]
NowFactory = Callable[[], datetime]


@dataclass
class CryptoRow:
    symbol: str
    name: str
    price: float
    change_24h: float
    volume_24h: float
    market_cap: float
    sector: str
    day_high: float
    day_low: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "name": self.name,
            "price": self.price,
            "change_24h": self.change_24h,
            "volume_24h": self.volume_24h,
            "market_cap": self.market_cap,
            "sector": self.sector,
        }


def _f(v: Any, default: float = 0.0) -> float:
    try:
        out = float(v)
        if out != out:
            return default
        return out
    except Exception:
        return default


class CryptoMarketService:
    def __init__(
        self,
        cache_backend: Any = cache_instance,
        fetcher_factory: FetcherFactory = get_unified_fetcher,
        now_factory: NowFactory | None = None,
    ) -> None:
        self._cache = cache_backend
        self._fetcher_factory = fetcher_factory
        self._now_factory = now_factory or (lambda: datetime.now(timezone.utc))

    def _now_iso(self) -> str:
        return self._now_factory().isoformat()

    @staticmethod
    def normalize_symbol(symbol: str) -> str:
        raw = (symbol or "").strip().upper()
        if not raw:
            return ""
        return raw if "-" in raw else f"{raw}-USD"

    async def _fetch_rows(self, universe_limit: int = 300) -> list[CryptoRow]:
        # Sourced from CoinGecko (real market caps + broad coverage) with a
        # Yahoo fallback; see backend.services.crypto_universe.
        payload = await load_universe(universe_limit)
        rows: list[CryptoRow] = []
        for row in payload:
            if not isinstance(row, dict):
                continue
            price = _f(row.get("price"))
            rows.append(
                CryptoRow(
                    symbol=str(row.get("symbol") or ""),
                    name=str(row.get("name") or ""),
                    price=price,
                    change_24h=_f(row.get("change_24h")),
                    volume_24h=_f(row.get("volume_24h")),
                    market_cap=_f(row.get("market_cap")),
                    sector=str(row.get("sector") or "Other"),
                    day_high=_f(row.get("day_high"), price),
                    day_low=_f(row.get("day_low"), price),
                )
            )
        return rows

    async def markets(
        self,
        limit: int = 50,
        q: str = "",
        sector: str = "",
        sort_by: str = "market_cap",
        sort_order: str = "desc",
    ) -> dict[str, Any]:
        rows = await self._fetch_rows(300)
        term = q.strip().lower()
        if term:
            rows = [r for r in rows if term in r.symbol.lower() or term in r.name.lower()]
        sector_term = sector.strip().lower()
        if sector_term:
            rows = [r for r in rows if r.sector.lower() == sector_term]

        key = (sort_by or "market_cap").strip().lower()
        if key not in _ALLOWED_SORT_KEYS:
            key = "market_cap"
        reverse = (sort_order or "desc").strip().lower() != "asc"
        rows.sort(key=lambda x: getattr(x, key), reverse=reverse)

        capped_limit = max(1, min(300, limit))
        items = [r.to_dict() for r in rows[:capped_limit]]
        return {"items": items, "count": len(items), "ts": self._now_iso()}

    async def movers(self, metric: str, limit: int = 20) -> dict[str, Any]:
        metric_key = (metric or "change_24h").strip().lower()
        rows = await self._fetch_rows(300)

        if metric_key in {"gainers", "change_24h"}:
            rows.sort(key=lambda x: x.change_24h, reverse=True)
        elif metric_key == "losers":
            rows.sort(key=lambda x: x.change_24h)
        elif metric_key in {"volume", "volume_24h"}:
            rows.sort(key=lambda x: x.volume_24h, reverse=True)
        elif metric_key in {"market_cap", "cap"}:
            rows.sort(key=lambda x: x.market_cap, reverse=True)
        else:
            raise ValueError("Unsupported movers metric")

        capped_limit = max(1, min(100, limit))
        return {
            "metric": metric_key,
            "items": [r.to_dict() for r in rows[:capped_limit]],
            "ts": self._now_iso(),
        }

    async def dominance(self) -> dict[str, Any]:
        # Prefer CoinGecko's global market data (accurate, whole-market figures).
        glob = await load_global()
        if glob is not None:
            btc_pct = glob["btc_pct"]
            eth_pct = glob["eth_pct"]
            return {
                "btc_pct": btc_pct,
                "eth_pct": eth_pct,
                "others_pct": max(0.0, 100.0 - btc_pct - eth_pct),
                "total_market_cap": glob["total_market_cap"],
                "ts": self._now_iso(),
            }
        # Fallback: approximate from the fetched universe.
        rows = await self._fetch_rows(300)
        total_cap = sum(r.market_cap for r in rows) or 1.0
        cap_by_symbol = {r.symbol: r.market_cap for r in rows}
        btc = cap_by_symbol.get("BTC-USD", 0.0)
        eth = cap_by_symbol.get("ETH-USD", 0.0)
        others = max(0.0, total_cap - btc - eth)
        return {
            "btc_pct": (btc / total_cap) * 100.0,
            "eth_pct": (eth / total_cap) * 100.0,
            "others_pct": (others / total_cap) * 100.0,
            "total_market_cap": total_cap,
            "ts": self._now_iso(),
        }

    async def index(self, top_n: int = 10) -> dict[str, Any]:
        rows = await self._fetch_rows(300)
        rows.sort(key=lambda x: x.market_cap, reverse=True)
        capped_top_n = max(1, min(100, top_n))
        top = rows[:capped_top_n]
        total_cap = sum(r.market_cap for r in top) or 1.0
        weighted_change = sum((r.market_cap / total_cap) * r.change_24h for r in top)
        index_value = 1000.0 * (1.0 + weighted_change / 100.0)
        return {
            "index_name": "OTUI Crypto Market Cap Index",
            "top_n": capped_top_n,
            "component_count": len(top),
            "index_value": index_value,
            "change_24h": weighted_change,
            "total_market_cap": total_cap,
            "ts": self._now_iso(),
        }

    async def sectors(self) -> dict[str, Any]:
        rows = await self._fetch_rows(300)
        row_by_symbol = {r.symbol: r for r in rows}
        items: list[dict[str, Any]] = []

        for sector, weights in _SECTOR_WEIGHTS.items():
            total_w = sum(weights.values()) or 1.0
            change = 0.0
            cap = 0.0
            components: list[dict[str, Any]] = []
            for symbol, w in weights.items():
                row = row_by_symbol.get(symbol)
                if row is None:
                    continue
                weight = w / total_w
                change += row.change_24h * weight
                cap += row.market_cap
                components.append({"symbol": row.symbol, "name": row.name, "weight": weight})
            items.append({"sector": sector, "change_24h": change, "market_cap": cap, "components": components})

        return {"items": items, "ts": self._now_iso()}

    async def coin_detail(self, symbol: str) -> dict[str, Any] | None:
        normalized = self.normalize_symbol(symbol)
        if not normalized:
            return None

        rows = await self._fetch_rows(300)
        row = next((r for r in rows if r.symbol == normalized), None)
        if row is None:
            return None

        adapter = CryptoAdapter((await self._fetcher_factory()).yahoo)
        candles_payload = await adapter.candles(symbol=normalized, interval="1d", range_str="1mo")
        hist = _parse_yahoo_chart(candles_payload if isinstance(candles_payload, dict) else {})
        sparkline: list[float] = []
        if not hist.empty:
            sparkline = [float(v) for v in hist["Close"].tail(30).tolist() if v == v]
        if not sparkline:
            # Yahoo has no series for this coin — use CoinGecko closes.
            sparkline = [c["c"] for c in await load_candles(normalized, "1mo")][-30:]

        return {
            "symbol": row.symbol,
            "name": row.name,
            "sector": row.sector,
            "price": row.price,
            "change_24h": row.change_24h,
            "volume_24h": row.volume_24h,
            "market_cap": row.market_cap,
            "high_24h": row.day_high,
            "low_24h": row.day_low,
            "sparkline": sparkline,
            "ts": self._now_iso(),
        }
