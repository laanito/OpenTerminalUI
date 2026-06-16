"""Shared crypto universe loader.

Single source of truth for the list of crypto rows used by both
``CryptoMarketService`` and the ``/v1/crypto`` routes. CoinGecko is the primary
source (real market caps, volume and broad coverage via /coins/markets); Yahoo
is the fallback for when CoinGecko is unavailable or rate limited. Results are
cached under the shared ``crypto_quotes:universe`` key.
"""

from __future__ import annotations

import logging
from typing import Any

from backend.api.deps import cache_instance, get_unified_fetcher
from backend.config.settings import get_settings
from backend.core.coingecko_client import CoinGeckoClient
from backend.core.ttl_policy import market_open_now, ttl_seconds

logger = logging.getLogger(__name__)

# Curated sector tags + ids for well-known coins. Used to tag CoinGecko rows and
# as the universe for the Yahoo fallback path. Coins outside this map are tagged
# "Other".
FALLBACK_META: dict[str, dict[str, str]] = {
    "BTC-USD": {"id": "bitcoin", "name": "Bitcoin", "sector": "L1"},
    "ETH-USD": {"id": "ethereum", "name": "Ethereum", "sector": "L1"},
    "SOL-USD": {"id": "solana", "name": "Solana", "sector": "L1"},
    "BNB-USD": {"id": "binancecoin", "name": "BNB", "sector": "L1"},
    "XRP-USD": {"id": "ripple", "name": "XRP", "sector": "L1"},
    "UNI-USD": {"id": "uniswap", "name": "Uniswap", "sector": "DeFi"},
    "AAVE-USD": {"id": "aave", "name": "Aave", "sector": "DeFi"},
    "DOGE-USD": {"id": "dogecoin", "name": "Dogecoin", "sector": "Memes"},
    "SHIB-USD": {"id": "shiba-inu", "name": "Shiba Inu", "sector": "Memes"},
    "RNDR-USD": {"id": "render-token", "name": "Render", "sector": "AI"},
    "FET-USD": {"id": "fetch-ai", "name": "Fetch.ai", "sector": "AI"},
    "IMX-USD": {"id": "immutable-x", "name": "Immutable", "sector": "Gaming"},
    "GALA-USD": {"id": "gala", "name": "Gala", "sector": "Gaming"},
    "ONDO-USD": {"id": "ondo-finance", "name": "Ondo", "sector": "RWA"},
    "MKR-USD": {"id": "maker", "name": "Maker", "sector": "RWA"},
}

_SECTOR_BY_SYMBOL = {sym: meta["sector"] for sym, meta in FALLBACK_META.items()}

_CACHE_NS = "crypto_quotes"


def _f(v: Any, default: float = 0.0) -> float:
    try:
        out = float(v)
        return out if out == out else default
    except Exception:
        return default


def _cache_keys(limit: int) -> tuple[str, str]:
    return (
        cache_instance.build_key(_CACHE_NS, "universe", {"limit": limit}),
        cache_instance.build_key(_CACHE_NS, "universe_stale", {"limit": limit}),
    )


def _row_from_coingecko(coin: dict[str, Any]) -> dict[str, Any] | None:
    raw_symbol = str(coin.get("symbol") or "").strip().upper()
    if not raw_symbol:
        return None
    symbol = f"{raw_symbol}-USD"
    price = _f(coin.get("current_price"))
    if price <= 0:
        return None
    return {
        "symbol": symbol,
        "name": str(coin.get("name") or symbol),
        "price": price,
        "change_24h": _f(coin.get("price_change_percentage_24h")),
        "volume_24h": _f(coin.get("total_volume")),
        "market_cap": _f(coin.get("market_cap")),
        "sector": _SECTOR_BY_SYMBOL.get(symbol, "Other"),
        "day_high": _f(coin.get("high_24h"), price),
        "day_low": _f(coin.get("low_24h"), price),
        "coin_id": str(coin.get("id") or ""),
        "market_cap_rank": coin.get("market_cap_rank"),
    }


async def _from_coingecko(limit: int) -> list[dict[str, Any]]:
    client = CoinGeckoClient(api_key=get_settings().coingecko_api_key)
    try:
        await client.initialize()
        coins: list[dict[str, Any]] = []
        page = 1
        while len(coins) < limit and page <= 4:
            batch = await client.get_markets(per_page=min(250, limit), page=page)
            if not batch:
                break
            coins.extend(batch)
            if len(batch) < min(250, limit):
                break
            page += 1
    finally:
        await client.close()

    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for coin in coins:
        row = _row_from_coingecko(coin)
        if row is None or row["symbol"] in seen:
            continue  # keep the highest-market-cap coin per ticker
        seen.add(row["symbol"])
        rows.append(row)
        if len(rows) >= limit:
            break
    return rows


async def _from_yahoo(limit: int) -> list[dict[str, Any]]:
    symbols = list(FALLBACK_META.keys())[:limit]
    try:
        fetcher = await get_unified_fetcher()
        quotes = await fetcher.yahoo.get_quotes(symbols)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Yahoo crypto fallback failed: %s", exc)
        return []
    by_symbol = {str(x.get("symbol") or "").upper(): x for x in quotes if isinstance(x, dict)}
    rows: list[dict[str, Any]] = []
    for sym in symbols:
        q = by_symbol.get(sym, {})
        meta = FALLBACK_META.get(sym, {})
        price = _f(q.get("regularMarketPrice"))
        if price <= 0:
            continue
        volume = _f(q.get("regularMarketVolume"))
        # No real market cap from Yahoo — keep the historical price*volume proxy.
        market_cap_proxy = max(price * max(volume, 1.0), price * 1_000_000.0)
        day_high = _f(q.get("regularMarketDayHigh"), price)
        day_low = _f(q.get("regularMarketDayLow"), price)
        rows.append(
            {
                "symbol": sym,
                "name": str(meta.get("name") or sym),
                "price": price,
                "change_24h": _f(q.get("regularMarketChangePercent")),
                "volume_24h": volume,
                "market_cap": market_cap_proxy,
                "sector": str(meta.get("sector") or "Other"),
                "day_high": day_high if day_high > 0 else price,
                "day_low": day_low if day_low > 0 else price,
                "coin_id": str(meta.get("id") or ""),
                "market_cap_rank": None,
            }
        )
    return rows


async def load_universe(limit: int = 300) -> list[dict[str, Any]]:
    """Return the crypto universe as canonical row dicts (cached).

    Order: fresh cache -> CoinGecko -> Yahoo fallback -> stale cache -> [].
    """
    limit = max(1, min(300, limit))
    cache_key, stale_key = _cache_keys(limit)

    cached = await cache_instance.get(cache_key)
    if isinstance(cached, list) and cached:
        return cached

    rows = await _from_coingecko(limit)
    source = "coingecko"
    if not rows:
        rows = await _from_yahoo(limit)
        source = "yahoo"

    if rows:
        ttl = ttl_seconds("crypto", market_open_now())
        await cache_instance.set(cache_key, rows, ttl=ttl)
        await cache_instance.set(stale_key, rows, ttl=max(ttl * 6, ttl))
        logger.debug("Loaded %d crypto rows from %s", len(rows), source)
        return rows

    stale = await cache_instance.get(stale_key)
    if isinstance(stale, list):
        return stale
    return []


async def search_universe(q: str, limit: int = 20) -> list[dict[str, str]]:
    """Search the crypto universe by ticker, name or coin id.

    Backed by :func:`load_universe` (CoinGecko, ~top-300 by market cap), so the
    symbol searcher finds the full universe rather than a hardcoded handful.
    Returns ``{"id", "symbol", "name"}`` rows ranked exact > prefix > substring,
    preserving the market-cap ordering within each tier.
    """
    limit = max(1, min(100, limit))
    rows = await load_universe(300)
    term = q.strip().lower()

    if not term:
        return [
            {"id": r.get("coin_id", ""), "symbol": r["symbol"], "name": r["name"]}
            for r in rows[:limit]
        ]

    exact: list[dict[str, str]] = []
    prefix: list[dict[str, str]] = []
    substr: list[dict[str, str]] = []
    for r in rows:
        symbol = str(r.get("symbol") or "")
        base = symbol.split("-")[0].lower()  # "BTC-USD" -> "btc"
        name = str(r.get("name") or "")
        coin_id = str(r.get("coin_id") or "")
        item = {"id": coin_id, "symbol": symbol, "name": name}
        if term == base or term == symbol.lower() or term == coin_id:
            exact.append(item)
        elif base.startswith(term) or name.lower().startswith(term):
            prefix.append(item)
        elif term in base or term in name.lower() or term in coin_id:
            substr.append(item)

    return (exact + prefix + substr)[:limit]


async def load_global() -> dict[str, Any] | None:
    """Return real dominance/market-cap totals from CoinGecko /global, or None."""
    client = CoinGeckoClient(api_key=get_settings().coingecko_api_key)
    try:
        await client.initialize()
        data = await client.get_global()
    finally:
        await client.close()
    if not data:
        return None
    pct = data.get("market_cap_percentage") or {}
    total = (data.get("total_market_cap") or {}).get("usd")
    if total is None:
        return None
    return {
        "btc_pct": _f(pct.get("btc")),
        "eth_pct": _f(pct.get("eth")),
        "total_market_cap": _f(total),
    }
