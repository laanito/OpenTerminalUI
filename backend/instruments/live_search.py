"""Live Yahoo Finance symbol-search fallback.

When the seeded ``instrument_master`` has few/no hits for a query (the global
long tail), the search route calls this to resolve symbols on the fly and lazily
write them back into the table (source='yahoo') so subsequent searches are local.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

YAHOO_SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search"

# Yahoo quoteType -> our instrument type. Unmapped types (e.g. OPTION) are dropped.
_QUOTE_TYPE = {
    "EQUITY": "equity",
    "ETF": "etf",
    "MUTUALFUND": "fund",
    "CRYPTOCURRENCY": "crypto",
    "INDEX": "index",
    "CURRENCY": "fx",
    "FUTURE": "futures",
}


def _map_quote(quote: dict[str, Any]) -> dict[str, Any] | None:
    symbol = str(quote.get("symbol") or "").strip().upper()
    if not symbol:
        return None
    typ = _QUOTE_TYPE.get(str(quote.get("quoteType") or "").upper())
    if typ is None:
        return None
    name = str(quote.get("shortname") or quote.get("longname") or symbol)
    exchange = str(quote.get("exchDisp") or quote.get("exchange") or "").strip() or "YAHOO"
    return {
        "canonical_id": f"YAHOO:{symbol}",
        "display_symbol": symbol,
        "name": name,
        "type": typ,
        "exchange": exchange,
        "currency": None,  # Yahoo search doesn't return currency per quote
        "tick_size": None,
        "lot_size": None,
        "vendor_mappings_json": {"yahoo": symbol},
    }


async def yahoo_search(query: str, limit: int = 20, timeout: float = 10.0) -> list[dict[str, Any]]:
    """Return instrument rows for ``query`` from Yahoo's search endpoint, or []."""
    q = (query or "").strip()
    if not q:
        return []
    params = {"q": q, "quotesCount": max(1, min(limit, 25)), "newsCount": 0}
    headers = {"User-Agent": "Mozilla/5.0 (OpenTerminalUI)"}
    try:
        async with httpx.AsyncClient(timeout=timeout, trust_env=False, headers=headers) as client:
            resp = await client.get(YAHOO_SEARCH_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Yahoo search failed for %r: %s", q, exc)
        return []

    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for quote in data.get("quotes", []) if isinstance(data, dict) else []:
        row = _map_quote(quote)
        if row is None or row["display_symbol"] in seen:
            continue
        seen.add(row["display_symbol"])
        rows.append(row)
        if len(rows) >= limit:
            break
    return rows
