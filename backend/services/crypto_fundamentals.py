"""Crypto fundamentals: tokenomics + on-chain usage + valuation ratios.

Combines CoinGecko (supply, FDV, ATH) with keyless DefiLlama (TVL, fees) to
answer the "is this backed by real usage, or just a story?" question that sits at
the centre of the project's north star. All upstreams degrade gracefully: a coin
that DefiLlama doesn't track still returns its tokenomics, with on-chain fields
left null rather than fabricated.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.api.deps import cache_instance
from backend.config.settings import get_settings
from backend.core.coingecko_client import CoinGeckoClient
from backend.core.defillama_client import DefiLlamaClient
from backend.services.crypto_universe import coin_id_for_symbol

_CACHE_NS = "crypto_fundamentals"
_CACHE_TTL = 3600  # fundamentals move slowly; an hour is plenty.


def _f(v: Any) -> float | None:
    try:
        if v is None:
            return None
        out = float(v)
        return out if out == out else None  # drop NaN
    except (TypeError, ValueError):
        return None


def _ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator == 0:
        return None
    return round(numerator / denominator, 4)


def compute_fundamentals(
    symbol: str,
    cg_row: dict[str, Any] | None,
    dl_entry: dict[str, Any] | None,
    dl_fees: dict[str, Any] | None,
) -> dict[str, Any]:
    """Pure transform: raw upstream rows -> the fundamentals payload (no I/O)."""
    cg = cg_row or {}
    dl = dl_entry or {}
    fees = dl_fees or {}

    circulating = _f(cg.get("circulating_supply"))
    total = _f(cg.get("total_supply"))
    max_supply = _f(cg.get("max_supply"))
    market_cap = _f(cg.get("market_cap"))
    fdv = _f(cg.get("fully_diluted_valuation"))

    # % of the eventual supply already circulating: low => big future dilution.
    supply_denom = max_supply or total
    circulating_pct = round(circulating / supply_denom * 100, 2) if circulating and supply_denom else None

    tvl = _f(dl.get("tvl"))
    fees_24h = _f(fees.get("total24h"))
    fees_30d = _f(fees.get("total30d"))
    # Annualise from the steadier 30d window when available, else from 24h.
    fees_annualized = (fees_30d * 365 / 30) if fees_30d else (fees_24h * 365 if fees_24h else None)

    chains = dl.get("chains") if isinstance(dl.get("chains"), list) else None

    return {
        "symbol": (symbol or "").upper(),
        "name": str(cg.get("name") or dl.get("name") or symbol or "").strip(),
        "tokenomics": {
            "circulating_supply": circulating,
            "total_supply": total,
            "max_supply": max_supply,
            "circulating_pct": circulating_pct,
        },
        "valuation": {
            "market_cap": market_cap,
            "fully_diluted_valuation": fdv,
            # >1 means meaningful supply still to be unlocked (dilution risk).
            "fdv_mcap_ratio": _ratio(fdv, market_cap),
            "ath": _f(cg.get("ath")),
            "ath_change_pct": _f(cg.get("ath_change_percentage")),
            # Backing of price by locked value and by real fee revenue.
            "mcap_tvl_ratio": _ratio(market_cap, tvl),
            "price_to_fees_ratio": _ratio(market_cap, fees_annualized),
        },
        "onchain": {
            "tvl": tvl,
            "fees_24h": fees_24h,
            "fees_30d": fees_30d,
            "fees_annualized": round(fees_annualized, 2) if fees_annualized else None,
            "category": str(dl.get("category")) if dl.get("category") else None,
            "chains": chains,
            "tracked": bool(dl),  # False => DefiLlama has no protocol for this token.
        },
        "sources": ["CoinGecko"] + (["DefiLlama"] if dl else []),
        "ts": datetime.now(timezone.utc).isoformat(),
    }


def _match_protocol(protocols: list[dict[str, Any]], symbol: str) -> dict[str, Any] | None:
    """Find the highest-TVL DefiLlama protocol whose symbol matches the coin."""
    target = (symbol or "").upper().split("-")[0]
    if not target:
        return None
    matches = [p for p in protocols if str(p.get("symbol") or "").upper() == target]
    if not matches:
        return None
    return max(matches, key=lambda p: _f(p.get("tvl")) or 0.0)


async def get_fundamentals(symbol: str) -> dict[str, Any] | None:
    """Fetch + assemble fundamentals for a crypto symbol (cached), or None if unknown."""
    norm = (symbol or "").strip().upper()
    if not norm:
        return None

    cache_key = cache_instance.build_key(_CACHE_NS, norm)
    cached = await cache_instance.get(cache_key)
    if cached is not None:
        return cached

    coin_id = await coin_id_for_symbol(norm)
    if not coin_id:
        return None

    cg_client = CoinGeckoClient(api_key=get_settings().coingecko_api_key)
    dl_client = DefiLlamaClient()
    try:
        cg_row = await cg_client.get_market_by_id(coin_id)
        protocols = await dl_client.get_protocols()
        dl_entry = _match_protocol(protocols, norm)
        dl_fees = await dl_client.get_fees_summary(str(dl_entry.get("slug"))) if dl_entry else {}
    finally:
        await cg_client.close()
        await dl_client.close()

    if cg_row is None and not dl_entry:
        return None

    payload = compute_fundamentals(norm, cg_row, dl_entry, dl_fees)
    await cache_instance.set(cache_key, payload, _CACHE_TTL)
    return payload
