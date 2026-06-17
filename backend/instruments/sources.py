"""Instrument-universe source loaders for ``instrument_master``.

Produces canonical row dicts (matching :class:`InstrumentMaster` columns) from:
- US equities/ETFs via the free Nasdaq Trader listing files (no key, offline-able)
- Crypto via the shared CoinGecko-backed ``crypto_universe.load_universe``

Parsers are pure (text -> rows) so they're unit-testable without network; the
``fetch_*`` helpers add the HTTP download.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from backend.services.crypto_universe import load_universe

logger = logging.getLogger(__name__)

NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"

# otherlisted.txt "Exchange" column codes -> readable exchange names.
_OTHER_EXCHANGE_CODES = {
    "A": "AMEX",
    "N": "NYSE",
    "P": "NYSE ARCA",
    "Z": "CBOE BZX",
    "V": "IEX",
}


def _row(
    *,
    exchange: str,
    symbol: str,
    name: str,
    is_etf: bool,
    lot_size: str | None,
    currency: str = "USD",
) -> dict[str, Any]:
    return {
        "canonical_id": f"{exchange}:{symbol}",
        "display_symbol": symbol,
        "name": name or symbol,
        "type": "etf" if is_etf else "equity",
        "exchange": exchange,
        "currency": currency,
        "tick_size": None,
        "lot_size": (lot_size or None),
        # US tickers map 1:1 to Yahoo; refine share-class suffixes later if needed.
        "vendor_mappings_json": {"yahoo": symbol},
    }


def _split(line: str) -> list[str]:
    return [c.strip() for c in line.split("|")]


def parse_nasdaq_listed(text: str) -> list[dict[str, Any]]:
    """Parse ``nasdaqlisted.txt`` (NASDAQ-listed equities/ETFs)."""
    rows: list[dict[str, Any]] = []
    lines = text.splitlines()
    for line in lines[1:]:  # skip header
        if not line or line.startswith("File Creation Time"):
            continue
        f = _split(line)
        if len(f) < 8:
            continue
        symbol, name, _mkt, test_issue, _fin, lot, etf, _next = f[:8]
        if not symbol or test_issue == "Y":
            continue
        rows.append(
            _row(exchange="NASDAQ", symbol=symbol, name=name, is_etf=(etf == "Y"), lot_size=lot)
        )
    return rows


def parse_other_listed(text: str) -> list[dict[str, Any]]:
    """Parse ``otherlisted.txt`` (NYSE / AMEX / ARCA / BZX / IEX)."""
    rows: list[dict[str, Any]] = []
    lines = text.splitlines()
    for line in lines[1:]:  # skip header
        if not line or line.startswith("File Creation Time"):
            continue
        f = _split(line)
        if len(f) < 8:
            continue
        act_symbol, name, exch_code, _cqs, etf, lot, test_issue, _nasdaq = f[:8]
        if not act_symbol or test_issue == "Y":
            continue
        exchange = _OTHER_EXCHANGE_CODES.get(exch_code, exch_code or "US")
        rows.append(
            _row(exchange=exchange, symbol=act_symbol, name=name, is_etf=(etf == "Y"), lot_size=lot)
        )
    return rows


async def fetch_us_equities(timeout: float = 30.0) -> list[dict[str, Any]]:
    """Download + parse the Nasdaq Trader files into instrument rows."""
    rows: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=timeout, trust_env=False, follow_redirects=True) as client:
        for url, parser in ((NASDAQ_LISTED_URL, parse_nasdaq_listed), (OTHER_LISTED_URL, parse_other_listed)):
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                rows.extend(parser(resp.text))
            except Exception as exc:  # noqa: BLE001
                logger.warning("US instrument fetch failed for %s: %s", url, exc)
    # Dedupe by canonical_id (keep first); same ticker can appear across files.
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for r in rows:
        if r["canonical_id"] in seen:
            continue
        seen.add(r["canonical_id"])
        deduped.append(r)
    return deduped


def crypto_row(coin: dict[str, Any]) -> dict[str, Any] | None:
    symbol = str(coin.get("symbol") or "").strip().upper()
    if not symbol:
        return None
    return {
        "canonical_id": f"CRYPTO:{symbol}",
        "display_symbol": symbol,
        "name": str(coin.get("name") or symbol),
        "type": "crypto",
        "exchange": "CRYPTO",
        "currency": "USD",
        "tick_size": None,
        "lot_size": None,
        "vendor_mappings_json": {
            "coingecko": str(coin.get("coin_id") or ""),
            "yahoo": symbol,
        },
    }


async def fetch_crypto(limit: int = 300) -> list[dict[str, Any]]:
    """Crypto instrument rows from the shared CoinGecko-backed universe."""
    universe = await load_universe(limit)
    rows: list[dict[str, Any]] = []
    for coin in universe:
        row = crypto_row(coin)
        if row is not None:
            rows.append(row)
    return rows


# Yahoo/home-exchange suffix -> (exchange, currency). pytickersymbols' `symbol`
# field is the home-exchange ticker (e.g. ADS.DE, III.L, NESN.SW, AC.PA), which
# doubles as a valid Yahoo ticker; the suffix identifies exchange + currency.
# A symbol without a known EU suffix (bare US tickers, .T Tokyo, ...) is skipped,
# so iterating every index still yields only the European universe.
_EU_SUFFIX = {
    "DE": ("XETRA", "EUR"),
    "F": ("Frankfurt", "EUR"),
    "PA": ("Euronext Paris", "EUR"),
    "AS": ("Euronext Amsterdam", "EUR"),
    "BR": ("Euronext Brussels", "EUR"),
    "LS": ("Euronext Lisbon", "EUR"),
    "MI": ("Borsa Italiana", "EUR"),
    "MC": ("BME Madrid", "EUR"),
    "VI": ("Wiener Borse", "EUR"),
    "IR": ("Euronext Dublin", "EUR"),
    "HE": ("Nasdaq Helsinki", "EUR"),
    "L": ("LSE", "GBP"),
    "SW": ("SIX Swiss", "CHF"),
    "ST": ("Nasdaq Stockholm", "SEK"),
    "CO": ("Nasdaq Copenhagen", "DKK"),
    "OL": ("Oslo Bors", "NOK"),
}


def eu_row(stock: dict[str, Any]) -> dict[str, Any] | None:
    symbol = str(stock.get("symbol") or "").strip().upper()
    # A valid home ticker is TICKER.SUFFIX (exactly one dot); skip bare tickers
    # and malformed double-suffixed source entries (e.g. "AIR.PA.DE").
    if symbol.count(".") != 1:
        return None
    suffix = symbol.rsplit(".", 1)[1]
    meta = _EU_SUFFIX.get(suffix)
    if not meta:
        return None
    exchange, currency = meta
    isins = stock.get("isins") or []
    isin = str(isins[0]) if isins else ""
    vendor: dict[str, str] = {"yahoo": symbol}
    if isin:
        vendor["isin"] = isin
    return {
        "canonical_id": f"{exchange}:{symbol}",
        "display_symbol": symbol,
        "name": str(stock.get("name") or symbol),
        "type": "equity",
        "exchange": exchange,
        "currency": currency,
        "tick_size": None,
        "lot_size": None,
        "vendor_mappings_json": vendor,
    }


def eu_rows_from_stocks(stocks: Any) -> list[dict[str, Any]]:
    """Map an iterable of pytickersymbols stock dicts to EU instrument rows."""
    rows: dict[str, dict[str, Any]] = {}
    for stock in stocks:
        r = eu_row(stock)
        if r is not None and r["canonical_id"] not in rows:
            rows[r["canonical_id"]] = r
    return list(rows.values())


async def fetch_eu_equities() -> list[dict[str, Any]]:
    """EU/UK equities from pytickersymbols (curated index constituents)."""

    def _collect() -> list[dict[str, Any]]:
        try:
            from pytickersymbols import PyTickerSymbols
        except Exception as exc:  # noqa: BLE001
            logger.warning("pytickersymbols unavailable, skipping EU instruments: %s", exc)
            return []
        try:
            store = PyTickerSymbols()
            stocks: list[dict[str, Any]] = []
            for index_name in store.get_all_indices():
                stocks.extend(store.get_stocks_by_index(index_name))
            return eu_rows_from_stocks(stocks)
        except Exception as exc:  # noqa: BLE001
            logger.warning("EU instrument load failed: %s", exc)
            return []

    return await asyncio.to_thread(_collect)
