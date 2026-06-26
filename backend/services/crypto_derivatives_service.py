"""Real Binance-backed crypto microstructure + derivatives loaders.

Replaces the previous fabrication (order-book depth synthesized from
``volume*price``; funding/liquidations derived from ``change_24h``) with real
data from Binance's public REST endpoints:

* **Depth** — spot ``bookTicker`` gives the genuine best bid/ask price and
  quantity for every symbol in one call. We expose the real top-of-book notional
  and imbalance for the heatmap.
* **Funding** — futures ``premiumIndex`` gives the real most-recent 8h funding
  rate (and mark price) for every USDⓈ-M perp in one call.
* **Open interest** — futures ``openInterest`` is per-symbol (no bulk endpoint),
  fetched concurrently for the requested set and multiplied by the mark price.

Liquidations are deliberately NOT synthesized here: Binance exposes no public
REST endpoint for 24h liquidation totals (the old ``allForceOrders`` REST route
was removed); the only real source is the live ``!forceOrder@arr`` WebSocket
stream, which feeds ``BinanceDerivativesState``. Until that stream is wired,
liquidations read as 0 and the route flags the response degraded.

All loaders cache their result and return ``{}`` on failure so callers can fall
back to a ``degraded`` marker rather than fake numbers.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from backend.api.deps import cache_instance
from backend.core.binance_client import BinanceClient
from backend.services.binance_ws import app_symbol_from_binance, to_binance_stream

logger = logging.getLogger(__name__)

_CACHE_NS = "crypto_derivs"
_DEPTH_TTL = 30
_FUNDING_OI_TTL = 60


def _f(v: Any, default: float = 0.0) -> float:
    try:
        out = float(v)
        return out if out == out else default
    except (TypeError, ValueError):
        return default


async def load_depth_map() -> dict[str, dict[str, float]]:
    """Return ``{app_symbol: {bid_notional, ask_notional, imbalance}}`` from the
    real Binance spot order book (best level). Cached; ``{}`` on failure."""
    cache_key = cache_instance.build_key(_CACHE_NS, "depth", {})
    cached = await cache_instance.get(cache_key)
    if isinstance(cached, dict) and cached:
        return cached

    client = BinanceClient()
    try:
        tickers = await client.get_book_tickers()
    finally:
        await client.close()

    out: dict[str, dict[str, float]] = {}
    for row in tickers:
        if not isinstance(row, dict):
            continue
        app_symbol = app_symbol_from_binance(str(row.get("symbol") or ""))
        if not app_symbol:
            continue
        bid_notional = _f(row.get("bidPrice")) * _f(row.get("bidQty"))
        ask_notional = _f(row.get("askPrice")) * _f(row.get("askQty"))
        denom = bid_notional + ask_notional
        imbalance = ((bid_notional - ask_notional) / denom) if denom > 0 else 0.0
        out[app_symbol] = {
            "bid_notional": bid_notional,
            "ask_notional": ask_notional,
            "imbalance": max(-1.0, min(1.0, imbalance)),
        }

    if out:
        await cache_instance.set(cache_key, out, ttl=_DEPTH_TTL)
    return out


async def load_funding_oi(symbols: list[str]) -> dict[str, dict[str, float]]:
    """Return ``{app_symbol: {funding_rate_8h, open_interest_usd}}`` from real
    Binance futures data for the requested app symbols. Cached; ``{}`` on
    failure. Symbols without a Binance perp are simply absent from the result."""
    wanted = sorted({(s or "").strip().upper() for s in symbols if s})
    if not wanted:
        return {}

    cache_key = cache_instance.build_key(_CACHE_NS, "funding_oi", {"symbols": wanted})
    cached = await cache_instance.get(cache_key)
    if isinstance(cached, dict) and cached:
        return cached

    client = BinanceClient()
    try:
        premium = await client.get_premium_index()
        if not premium:
            return {}

        mark_by_bsym: dict[str, float] = {}
        funding_by_app: dict[str, float] = {}
        for row in premium:
            if not isinstance(row, dict):
                continue
            bsym = str(row.get("symbol") or "").upper()
            if not bsym:
                continue
            mark_by_bsym[bsym] = _f(row.get("markPrice"))
            app_symbol = app_symbol_from_binance(bsym)
            if app_symbol:
                funding_by_app[app_symbol] = _f(row.get("lastFundingRate"))

        # Open interest has no bulk endpoint — fetch the requested set concurrently.
        pairs: list[tuple[str, str]] = []
        for app_symbol in wanted:
            stream = to_binance_stream(app_symbol)
            if not stream:
                continue
            bsym = stream.upper()
            if bsym in mark_by_bsym:  # only symbols Binance actually lists as perps
                pairs.append((app_symbol, bsym))

        async def _fetch_oi(app_symbol: str, bsym: str) -> tuple[str, float]:
            contracts = await client.get_open_interest(bsym)
            if contracts is None:
                return app_symbol, 0.0
            return app_symbol, contracts * mark_by_bsym.get(bsym, 0.0)

        oi_results = await asyncio.gather(
            *(_fetch_oi(a, b) for a, b in pairs), return_exceptions=True
        )
    finally:
        await client.close()

    oi_by_app: dict[str, float] = {}
    for res in oi_results:
        if isinstance(res, Exception) or not isinstance(res, tuple):
            continue
        app_symbol, oi_usd = res
        oi_by_app[app_symbol] = oi_usd

    out: dict[str, dict[str, float]] = {}
    for app_symbol in wanted:
        if app_symbol not in funding_by_app and app_symbol not in oi_by_app:
            continue
        out[app_symbol] = {
            "funding_rate_8h": funding_by_app.get(app_symbol, 0.0),
            "open_interest_usd": oi_by_app.get(app_symbol, 0.0),
        }

    if out:
        await cache_instance.set(cache_key, out, ttl=_FUNDING_OI_TTL)
    return out
