from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Callable, Literal

from backend.core.finnhub_client import FinnhubClient
from backend.core.yahoo_client import YahooClient
from backend.shared.cache import cache as cache_instance

SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "INR"]
DEFAULT_PAIR_INTERVAL = "1d"
DEFAULT_PAIR_RANGE = "3mo"

_YAHOO_USD_REFERENCE_SYMBOLS: dict[str, tuple[str, bool]] = {
    "EUR": ("EURUSD=X", False),
    "GBP": ("GBPUSD=X", False),
    "JPY": ("USDJPY=X", True),
    "CHF": ("USDCHF=X", True),
    "AUD": ("AUDUSD=X", False),
    "CAD": ("USDCAD=X", True),
    "INR": ("USDINR=X", True),
}

_PAIR_RANGE_TO_DELTA: dict[str, timedelta] = {
    "1d": timedelta(days=1),
    "5d": timedelta(days=5),
    "1mo": timedelta(days=31),
    "3mo": timedelta(days=93),
    "6mo": timedelta(days=186),
    "1y": timedelta(days=366),
    "2y": timedelta(days=732),
    "5y": timedelta(days=366 * 5),
    "10y": timedelta(days=366 * 10),
    "max": timedelta(days=366 * 50),
}

_MAX_ACCEPTABLE_RATE_AGE = timedelta(days=7)

_FINNHUB_RESOLUTION_MAP: dict[str, str] = {
    "1m": "1",
    "5m": "5",
    "15m": "15",
    "30m": "30",
    "60m": "60",
    "1h": "60",
    "1d": "D",
    "1wk": "W",
    "1mo": "M",
}

_CENTRAL_BANK_SNAPSHOTS: list[dict[str, Any]] = [
    {
        "currency": "USD",
        "bank": "Federal Reserve",
        "policy_rate": 5.25,
        "last_decision_date": date(2026, 2, 18),
        "next_decision_date": date(2026, 3, 31),
        "last_action": "Hold",
        "last_change_bps": 0,
        "decision_cycle": "6 weeks",
    },
    {
        "currency": "EUR",
        "bank": "European Central Bank",
        "policy_rate": 3.00,
        "last_decision_date": date(2026, 3, 5),
        "next_decision_date": date(2026, 4, 16),
        "last_action": "Cut",
        "last_change_bps": -25,
        "decision_cycle": "6 weeks",
    },
    {
        "currency": "GBP",
        "bank": "Bank of England",
        "policy_rate": 4.50,
        "last_decision_date": date(2026, 3, 19),
        "next_decision_date": date(2026, 5, 7),
        "last_action": "Hold",
        "last_change_bps": 0,
        "decision_cycle": "6 weeks",
    },
    {
        "currency": "JPY",
        "bank": "Bank of Japan",
        "policy_rate": 0.25,
        "last_decision_date": date(2026, 3, 19),
        "next_decision_date": date(2026, 4, 30),
        "last_action": "Hike",
        "last_change_bps": 10,
        "decision_cycle": "2 months",
    },
    {
        "currency": "CHF",
        "bank": "Swiss National Bank",
        "policy_rate": 1.25,
        "last_decision_date": date(2026, 3, 14),
        "next_decision_date": date(2026, 6, 13),
        "last_action": "Hold",
        "last_change_bps": 0,
        "decision_cycle": "Quarterly",
    },
    {
        "currency": "AUD",
        "bank": "Reserve Bank of Australia",
        "policy_rate": 4.10,
        "last_decision_date": date(2026, 3, 3),
        "next_decision_date": date(2026, 4, 7),
        "last_action": "Hold",
        "last_change_bps": 0,
        "decision_cycle": "Monthly",
    },
    {
        "currency": "CAD",
        "bank": "Bank of Canada",
        "policy_rate": 4.00,
        "last_decision_date": date(2026, 3, 12),
        "next_decision_date": date(2026, 4, 23),
        "last_action": "Cut",
        "last_change_bps": -25,
        "decision_cycle": "6 weeks",
    },
    {
        "currency": "INR",
        "bank": "Reserve Bank of India",
        "policy_rate": 6.50,
        "last_decision_date": date(2026, 2, 7),
        "next_decision_date": date(2026, 4, 5),
        "last_action": "Hold",
        "last_change_bps": 0,
        "decision_cycle": "Bi-monthly",
    },
]


def _normalize_pair_text(pair: str) -> str:
    return "".join(ch for ch in str(pair).upper() if "A" <= ch <= "Z")


def _yahoo_symbol(base_currency: str, quote_currency: str) -> str:
    return f"{base_currency}{quote_currency}=X"


def _f(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
        if result != result:
            return default
        return result
    except Exception:
        return default


def _coerce_positive_price(row: dict[str, Any]) -> float:
    for key in ("regularMarketPrice", "bid", "ask", "previousClose"):
        value = _f(row.get(key))
        if value > 0:
            return value
    return 0.0


def _parse_yahoo_candles(payload: dict[str, Any], *, invert: bool = False) -> list[dict[str, Any]]:
    chart = payload.get("chart") if isinstance(payload, dict) else None
    result = chart.get("result") if isinstance(chart, dict) else None
    if not isinstance(result, list) or not result:
        return []

    first = result[0] if isinstance(result[0], dict) else {}
    timestamps = first.get("timestamp") if isinstance(first, dict) else None
    indicators = first.get("indicators") if isinstance(first, dict) else {}
    quotes = indicators.get("quote") if isinstance(indicators, dict) else None
    if not isinstance(timestamps, list) or not isinstance(quotes, list) or not quotes:
        return []

    quote = quotes[0] if isinstance(quotes[0], dict) else {}
    opens = quote.get("open") if isinstance(quote, dict) else None
    highs = quote.get("high") if isinstance(quote, dict) else None
    lows = quote.get("low") if isinstance(quote, dict) else None
    closes = quote.get("close") if isinstance(quote, dict) else None
    volumes = quote.get("volume") if isinstance(quote, dict) else None
    if not all(isinstance(series, list) for series in (opens, highs, lows, closes)):
        return []

    if not isinstance(volumes, list):
        volumes = [0] * len(timestamps)

    length = min(len(timestamps), len(opens), len(highs), len(lows), len(closes), len(volumes))
    candles: list[dict[str, Any]] = []
    for idx in range(length):
        timestamp = timestamps[idx]
        open_price = _f(opens[idx], -1)
        high_price = _f(highs[idx], -1)
        low_price = _f(lows[idx], -1)
        close_price = _f(closes[idx], -1)
        volume = int(_f(volumes[idx], 0))
        if not isinstance(timestamp, (int, float)):
            continue
        if min(open_price, high_price, low_price, close_price) <= 0:
            continue

        if invert:
            candles.append(
                {
                    "t": int(timestamp),
                    "o": round(1.0 / open_price, 6),
                    "h": round(1.0 / low_price, 6),
                    "l": round(1.0 / high_price, 6),
                    "c": round(1.0 / close_price, 6),
                    "v": volume,
                }
            )
        else:
            candles.append(
                {
                    "t": int(timestamp),
                    "o": round(open_price, 6),
                    "h": round(high_price, 6),
                    "l": round(low_price, 6),
                    "c": round(close_price, 6),
                    "v": volume,
                }
            )
    return candles


def _parse_finnhub_candles(payload: dict[str, Any], *, invert: bool = False) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    status = str(payload.get("s") or "").lower()
    if status and status != "ok":
        return []

    timestamps = payload.get("t")
    opens = payload.get("o")
    highs = payload.get("h")
    lows = payload.get("l")
    closes = payload.get("c")
    volumes = payload.get("v")
    if not all(isinstance(series, list) for series in (timestamps, opens, highs, lows, closes)):
        return []

    if not isinstance(volumes, list):
        volumes = [0] * len(timestamps)

    length = min(len(timestamps), len(opens), len(highs), len(lows), len(closes), len(volumes))
    candles: list[dict[str, Any]] = []
    for idx in range(length):
        timestamp = timestamps[idx]
        open_price = _f(opens[idx], -1)
        high_price = _f(highs[idx], -1)
        low_price = _f(lows[idx], -1)
        close_price = _f(closes[idx], -1)
        volume = int(_f(volumes[idx], 0))
        if min(open_price, high_price, low_price, close_price) <= 0:
            continue

        if invert:
            candles.append(
                {
                    "t": int(timestamp),
                    "o": round(1.0 / open_price, 6),
                    "h": round(1.0 / low_price, 6),
                    "l": round(1.0 / high_price, 6),
                    "c": round(1.0 / close_price, 6),
                    "v": volume,
                }
            )
        else:
            candles.append(
                {
                    "t": int(timestamp),
                    "o": round(open_price, 6),
                    "h": round(high_price, 6),
                    "l": round(low_price, 6),
                    "c": round(close_price, 6),
                    "v": volume,
                }
            )
    return candles


@dataclass(frozen=True)
class PairResolution:
    interval: str
    range_str: str


def _provider_from_source_symbol(
    source_symbol: str,
) -> Literal["yahoo", "finnhub", "cache", "unknown"]:
    if source_symbol.startswith("OANDA:"):
        return "finnhub"
    if source_symbol.endswith("=X"):
        return "yahoo"
    return "cache" if source_symbol == "stale-cache" else "unknown"


class ForexService:
    def __init__(
        self,
        yahoo: YahooClient | None = None,
        finnhub: FinnhubClient | None = None,
        cache_backend: Any = cache_instance,
        now_factory: Callable[[], datetime] | None = None,
    ) -> None:
        self._yahoo = yahoo or YahooClient()
        self._finnhub = finnhub or FinnhubClient()
        self._cache = cache_backend
        self._now_factory = now_factory or (lambda: datetime.now(timezone.utc))

    def _now(self) -> datetime:
        now = self._now_factory()
        return now if now.tzinfo else now.replace(tzinfo=timezone.utc)

    def _forex_market_open(self) -> bool:
        return self._now().weekday() < 5

    def _quote_ttl(self) -> int:
        return 60 if self._forex_market_open() else 600

    def _chart_ttl(self) -> int:
        return 120 if self._forex_market_open() else 1800

    def _calendar_ttl(self) -> int:
        return 3600 if self._forex_market_open() else 21600

    def _resolve_pair(self, pair: str) -> tuple[str, str, str]:
        normalized = _normalize_pair_text(pair)
        if len(normalized) != 6:
            raise ValueError("pair must resolve to a 6-letter FX symbol, for example EURUSD")
        base_currency = normalized[:3]
        quote_currency = normalized[3:]
        if base_currency not in SUPPORTED_CURRENCIES or quote_currency not in SUPPORTED_CURRENCIES:
            raise ValueError("pair must use supported currency codes: USD, EUR, GBP, JPY, CHF, AUD, CAD, INR")
        if base_currency == quote_currency:
            raise ValueError("pair must use two different currencies")
        return normalized, base_currency, quote_currency

    def _pair_resolution(self, interval: str | None, range_str: str | None) -> PairResolution:
        normalized_interval = str(interval or DEFAULT_PAIR_INTERVAL).strip().lower() or DEFAULT_PAIR_INTERVAL
        normalized_range = str(range_str or DEFAULT_PAIR_RANGE).strip().lower() or DEFAULT_PAIR_RANGE
        return PairResolution(interval=normalized_interval, range_str=normalized_range)

    def _valuation_range(self, requested_date: date) -> str:
        age = (self._now().date() - requested_date).days
        if age <= 5:
            return "5d"
        if age <= 31:
            return "1mo"
        if age <= 93:
            return "3mo"
        if age <= 186:
            return "6mo"
        if age <= 366:
            return "1y"
        if age <= 732:
            return "2y"
        if age <= 366 * 5:
            return "5y"
        if age <= 366 * 10:
            return "10y"
        return "max"

    async def _finnhub_get_forex_rates(self, base_currency: str) -> dict[str, Any]:
        getter = getattr(self._finnhub, "get_forex_rates", None)
        if callable(getter):
            payload = await getter(base_currency)
            return payload if isinstance(payload, dict) else {}

        internal_get = getattr(self._finnhub, "_get", None)
        if not callable(internal_get):
            return {}
        payload = await internal_get("/forex/rates", {"base": base_currency})
        return payload if isinstance(payload, dict) else {}

    async def _finnhub_get_forex_candles(
        self,
        symbol: str,
        resolution: str,
        from_ts: int,
        to_ts: int,
    ) -> dict[str, Any]:
        getter = getattr(self._finnhub, "get_forex_candles", None)
        if callable(getter):
            payload = await getter(symbol, resolution, from_ts, to_ts)
            return payload if isinstance(payload, dict) else {}

        internal_get = getattr(self._finnhub, "_get", None)
        if not callable(internal_get):
            return {}
        payload = await internal_get(
            "/forex/candle",
            {"symbol": symbol, "resolution": resolution, "from": from_ts, "to": to_ts},
        )
        return payload if isinstance(payload, dict) else {}

    async def _fetch_usd_reference_map(self) -> dict[str, float]:
        symbols = [spec[0] for spec in _YAHOO_USD_REFERENCE_SYMBOLS.values()]
        try:
            yahoo_rows = await self._yahoo.get_quotes(symbols)
        except Exception:
            yahoo_rows = []
        yahoo_by_symbol = {
            str(row.get("symbol") or "").upper(): row
            for row in yahoo_rows
            if isinstance(row, dict)
        }

        usd_per_unit: dict[str, float] = {"USD": 1.0}
        missing: list[str] = []
        for currency, (symbol, invert) in _YAHOO_USD_REFERENCE_SYMBOLS.items():
            row = yahoo_by_symbol.get(symbol, {})
            price = _coerce_positive_price(row)
            if price <= 0:
                missing.append(currency)
                continue
            usd_per_unit[currency] = (1.0 / price) if invert else price

        if missing:
            fallback = await self._finnhub_get_forex_rates("USD")
            quotes = fallback.get("quote") if isinstance(fallback.get("quote"), dict) else fallback
            if isinstance(quotes, dict):
                for currency in missing:
                    quote_value = _f(quotes.get(currency))
                    if quote_value > 0:
                        usd_per_unit[currency] = 1.0 / quote_value

        unresolved = [currency for currency in SUPPORTED_CURRENCIES if currency not in usd_per_unit]
        if unresolved:
            raise RuntimeError(f"Unable to resolve FX reference rates for {', '.join(unresolved)}")
        return usd_per_unit

    async def _build_cross_rates_payload(self) -> dict[str, Any]:
        usd_per_unit = await self._fetch_usd_reference_map()
        currencies = list(SUPPORTED_CURRENCIES)
        matrix: list[list[float]] = []
        pair_quotes: dict[str, dict[str, Any]] = {}

        for base_currency in currencies:
            row: list[float] = []
            for quote_currency in currencies:
                rate = round(usd_per_unit[base_currency] / usd_per_unit[quote_currency], 6)
                row.append(rate)
                if base_currency != quote_currency:
                    pair_code = f"{base_currency}{quote_currency}"
                    pair_quotes[pair_code] = {
                        "pair": pair_code,
                        "symbol": _yahoo_symbol(base_currency, quote_currency),
                        "base_currency": base_currency,
                        "quote_currency": quote_currency,
                        "rate": rate,
                    }
            matrix.append(row)

        return {
            "as_of": self._now(),
            "base_currency": "USD",
            "currencies": currencies,
            "matrix": matrix,
            "pair_quotes": pair_quotes,
        }

    async def _build_pair_chart_payload(self, pair: str, interval: str | None, range_str: str | None) -> dict[str, Any]:
        normalized_pair, base_currency, quote_currency = self._resolve_pair(pair)
        resolution = self._pair_resolution(interval, range_str)
        direct_symbol = _yahoo_symbol(base_currency, quote_currency)
        inverse_symbol = _yahoo_symbol(quote_currency, base_currency)

        direct_payload: dict[str, Any] = {}
        inverse_payload: dict[str, Any] = {}

        try:
            direct_payload = await self._yahoo.get_chart(
                direct_symbol,
                range_str=resolution.range_str,
                interval=resolution.interval,
            )
        except Exception:
            direct_payload = {}

        candles = _parse_yahoo_candles(direct_payload)
        source_symbol = direct_symbol

        if not candles:
            try:
                inverse_payload = await self._yahoo.get_chart(
                    inverse_symbol,
                    range_str=resolution.range_str,
                    interval=resolution.interval,
                )
            except Exception:
                inverse_payload = {}
            inverse_candles = _parse_yahoo_candles(inverse_payload, invert=True)
            if inverse_candles:
                candles = inverse_candles
                source_symbol = inverse_symbol

        if not candles:
            finnhub_resolution = _FINNHUB_RESOLUTION_MAP.get(resolution.interval)
            if finnhub_resolution:
                end_at = self._now()
                start_at = end_at - _PAIR_RANGE_TO_DELTA.get(resolution.range_str, _PAIR_RANGE_TO_DELTA[DEFAULT_PAIR_RANGE])
                direct_finnhub = await self._finnhub_get_forex_candles(
                    f"OANDA:{base_currency}_{quote_currency}",
                    finnhub_resolution,
                    int(start_at.timestamp()),
                    int(end_at.timestamp()),
                )
                candles = _parse_finnhub_candles(direct_finnhub)
                source_symbol = f"OANDA:{base_currency}_{quote_currency}"

                if not candles:
                    inverse_finnhub = await self._finnhub_get_forex_candles(
                        f"OANDA:{quote_currency}_{base_currency}",
                        finnhub_resolution,
                        int(start_at.timestamp()),
                        int(end_at.timestamp()),
                    )
                    inverse_candles = _parse_finnhub_candles(inverse_finnhub, invert=True)
                    if inverse_candles:
                        candles = inverse_candles
                        source_symbol = f"OANDA:{quote_currency}_{base_currency}"

        if not candles:
            raise RuntimeError(f"No FX chart data available for {normalized_pair}")

        current_rate = round(_f(candles[-1].get("c")), 6)
        return {
            "pair": normalized_pair,
            "source_symbol": source_symbol,
            "base_currency": base_currency,
            "quote_currency": quote_currency,
            "interval": resolution.interval,
            "market": "FX",
            "as_of": datetime.fromtimestamp(int(candles[-1]["t"]), tz=timezone.utc),
            "current_rate": current_rate,
            "candles": candles,
        }

    def _build_central_banks_payload(self) -> dict[str, Any]:
        today = self._now().date()
        banks: list[dict[str, Any]] = []
        for snapshot in _CENTRAL_BANK_SNAPSHOTS:
            next_decision = snapshot["next_decision_date"]
            last_decision = snapshot["last_decision_date"]
            banks.append(
                {
                    **snapshot,
                    "days_since_last_decision": (today - last_decision).days,
                    "days_until_next_decision": (next_decision - today).days,
                }
            )
        return {"as_of": self._now(), "banks": banks}

    async def get_cross_rates(self) -> dict[str, Any]:
        params = {"currencies": SUPPORTED_CURRENCIES}
        key = self._cache.build_key("forex_cross_rates", "majors", params)
        stale_key = self._cache.build_key("forex_cross_rates_stale", "majors", params)
        cached = await self._cache.get(key)
        if isinstance(cached, dict):
            return cached

        try:
            payload = await self._build_cross_rates_payload()
        except Exception:
            stale = await self._cache.get(stale_key)
            if isinstance(stale, dict):
                return stale
            raise

        ttl = self._quote_ttl()
        await self._cache.set(key, payload, ttl=ttl)
        await self._cache.set(stale_key, payload, ttl=max(ttl * 6, ttl))
        return payload

    async def get_pair_chart(
        self,
        pair: str,
        interval: str | None = None,
        range_str: str | None = None,
    ) -> dict[str, Any]:
        normalized_pair, _, _ = self._resolve_pair(pair)
        resolution = self._pair_resolution(interval, range_str)
        params = {"interval": resolution.interval, "range": resolution.range_str}
        key = self._cache.build_key("forex_pair_chart", normalized_pair, params)
        stale_key = self._cache.build_key("forex_pair_chart_stale", normalized_pair, params)

        cached = await self._cache.get(key)
        if isinstance(cached, dict):
            return {**cached, "_cache_status": "fresh"}

        try:
            payload = await self._build_pair_chart_payload(normalized_pair, resolution.interval, resolution.range_str)
        except Exception as exc:
            stale = await self._cache.get(stale_key)
            if isinstance(stale, dict):
                return {**stale, "_cache_status": "stale"}
            if isinstance(exc, RuntimeError):
                raise
            raise RuntimeError(f"No FX chart data available for {normalized_pair}") from exc

        ttl = self._chart_ttl()
        await self._cache.set(key, payload, ttl=ttl)
        await self._cache.set(stale_key, payload, ttl=max(ttl * 6, ttl))
        return {**payload, "_cache_status": "fresh"}

    async def get_valuation_rate(
        self,
        base_currency: str,
        quote_currency: str,
        requested_date: date | None = None,
    ) -> dict[str, Any]:
        base = str(base_currency or "").strip().upper()
        quote = str(quote_currency or "").strip().upper()
        unsupported = [currency for currency in (base, quote) if currency not in SUPPORTED_CURRENCIES]
        if unsupported:
            raise ValueError(
                "currencies must use supported codes: USD, EUR, GBP, JPY, CHF, AUD, CAD, INR"
            )

        today = self._now().date()
        if requested_date is not None and requested_date > today:
            raise ValueError("historical FX date cannot be in the future")

        if base == quote:
            rate_at = (
                datetime.combine(requested_date, time.min, tzinfo=timezone.utc)
                if requested_date is not None
                else self._now()
            )
            return {
                "base_currency": base,
                "quote_currency": quote,
                "rate": 1.0,
                "rate_at": rate_at,
                "requested_date": requested_date,
                "source": "identity",
                "source_symbol": f"{base}{quote}",
                "freshness": "historical" if requested_date is not None else "current",
                "cache_status": "identity",
                "degraded": False,
                "degraded_reason": None,
            }

        range_str = self._valuation_range(requested_date or today)
        chart = await self.get_pair_chart(f"{base}{quote}", interval="1d", range_str=range_str)
        raw_candles = chart.get("candles") if isinstance(chart.get("candles"), list) else []
        candles = [row for row in raw_candles if isinstance(row, dict)]
        if not candles:
            raise RuntimeError(f"No FX rate data available for {base}{quote}")

        if requested_date is None:
            candle = max(candles, key=lambda row: _f(row.get("t"), -1))
        else:
            requested_cutoff = datetime.combine(requested_date, time.max, tzinfo=timezone.utc).timestamp()
            eligible = [row for row in candles if _f(row.get("t"), -1) <= requested_cutoff]
            if not eligible:
                raise RuntimeError(f"No FX rate available on or before {requested_date.isoformat()} for {base}{quote}")
            candle = max(eligible, key=lambda row: _f(row.get("t"), -1))

        rate = _f(candle.get("c"), -1)
        if rate <= 0:
            raise RuntimeError(f"No valid FX rate available for {base}{quote}")

        rate_at = datetime.fromtimestamp(int(candle["t"]), tz=timezone.utc)
        cache_status = str(chart.get("_cache_status") or "fresh")
        source_symbol = str(chart.get("source_symbol") or "unknown")
        degraded_reasons: list[str] = []
        if cache_status == "stale":
            degraded_reasons.append("live providers unavailable; serving the stale cache")

        if requested_date is None:
            rate_age = self._now() - rate_at
            freshness = "current" if rate_age <= _MAX_ACCEPTABLE_RATE_AGE else "stale"
            if freshness == "stale":
                degraded_reasons.append(f"latest provider rate is {rate_age.days} days old")
        else:
            historical_gap = requested_date - rate_at.date()
            if historical_gap > _MAX_ACCEPTABLE_RATE_AGE:
                raise RuntimeError(
                    f"Nearest FX rate for {base}{quote} is {historical_gap.days} days before "
                    f"{requested_date.isoformat()}"
                )
            freshness = "historical"

        return {
            "base_currency": base,
            "quote_currency": quote,
            "rate": round(rate, 6),
            "rate_at": rate_at,
            "requested_date": requested_date,
            "source": _provider_from_source_symbol(source_symbol),
            "source_symbol": source_symbol,
            "freshness": freshness,
            "cache_status": cache_status,
            "degraded": bool(degraded_reasons),
            "degraded_reason": "; ".join(degraded_reasons) or None,
        }

    async def get_central_banks(self) -> dict[str, Any]:
        key = self._cache.build_key("forex_central_banks", "calendar", {"currencies": SUPPORTED_CURRENCIES})
        cached = await self._cache.get(key)
        if isinstance(cached, dict):
            return cached

        payload = self._build_central_banks_payload()
        await self._cache.set(key, payload, ttl=self._calendar_ttl())
        return payload


service = ForexService()
