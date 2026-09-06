"""Canonical fallbacks for generic, market-agnostic workflows.

India support remains explicit through NSE/BSE/IN values. These defaults are
used only when a caller has not supplied usable market context.
"""

from __future__ import annotations

DEFAULT_EQUITY_MARKET = "NASDAQ"
DEFAULT_EQUITY_REGION = "US"
DEFAULT_EQUITY_UNIVERSE = "sp_500"
DEFAULT_EQUITY_SYMBOL = "AAPL"
DEFAULT_BENCHMARK_SYMBOL = "SPY"
DEFAULT_SCAN_MARKETS = ("NYSE", "NASDAQ")


def currency_for_market(market: str | None) -> str:
    normalized = str(market or "").strip().upper()
    if normalized in {"NSE", "BSE", "IN"}:
        return "INR"
    if normalized in {"EU", "EURONEXT", "XETRA", "LSE"}:
        return "EUR"
    return "USD"


def region_for_market(market: str | None) -> str:
    normalized = str(market or "").strip().upper()
    return "IN" if normalized in {"NSE", "BSE", "IN", "INDIA"} else DEFAULT_EQUITY_REGION
