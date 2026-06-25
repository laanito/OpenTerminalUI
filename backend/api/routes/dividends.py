from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.api.deps import fetch_stock_snapshot_coalesced, get_db
from backend.db.models import Holding, WatchlistItem
from backend.equity.services.corporate_actions import (
    EventType,
    corporate_actions_service,
    extract_amount,
)

router = APIRouter()

# Fallback universe when the user has no holdings/watchlist yet — a small basket
# of large US dividend payers so the calendar is never empty out of the box.
_DEFAULT_UNIVERSE = ["AAPL", "MSFT", "JNJ", "KO", "PG", "PEP", "XOM", "JPM"]

# Dividend Aristocrats are, by definition, a curated index (S&P 500 members with
# 25+ consecutive years of dividend increases). The membership list is static;
# the yield shown is fetched live per symbol. Streaks are approximate (2025).
_ARISTOCRATS: list[tuple[str, int]] = [
    ("PG", 68),
    ("MMM", 66),
    ("JNJ", 62),
    ("KO", 62),
    ("CL", 61),
    ("LOW", 60),
    ("PEP", 52),
    ("ABBV", 52),
    ("WMT", 51),
    ("ADP", 49),
    ("MCD", 48),
    ("XOM", 42),
]


def _dividend_type(title: str) -> str:
    low = title.lower()
    if "special" in low:
        return "Special"
    if "interim" in low:
        return "Interim"
    if "final" in low:
        return "Final"
    return "Dividend"


def _portfolio_symbols(db: Session) -> list[str]:
    holdings = {h.ticker.strip().upper() for h in db.query(Holding).all() if h.ticker}
    watchlist = {w.ticker.strip().upper() for w in db.query(WatchlistItem).all() if w.ticker}
    return sorted(holdings | watchlist)


@router.get("/dividends/calendar")
async def get_dividend_calendar(
    days: int = Query(default=30, ge=1, le=365),
    symbols: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Upcoming dividend ex-dates for the user's universe.

    Universe = explicit ``symbols`` (csv) → else portfolio holdings ∪ watchlist
    → else a default US dividend basket. Sourced from the corporate-actions
    service (Yahoo / FMP), so it works for US/EU symbols, not just NSE.
    """
    if symbols:
        universe = sorted({s.strip().upper() for s in symbols.split(",") if s.strip()})
    else:
        universe = _portfolio_symbols(db) or _DEFAULT_UNIVERSE

    events = await corporate_actions_service.get_upcoming_dividends(universe, days_ahead=days)
    out: list[dict[str, Any]] = []
    for evt in events:
        ex = evt.ex_date or evt.event_date
        estimated = evt.source == "projection"
        out.append(
            {
                "symbol": evt.symbol,
                "ex_date": ex.isoformat() if ex else None,
                "amount": extract_amount(evt.value) or 0.0,
                "type": "Estimated" if estimated else _dividend_type(evt.title),
                "estimated": estimated,
            }
        )
    out.sort(key=lambda r: r.get("ex_date") or "")
    return out


@router.get("/dividends/history/{symbol}")
async def get_dividend_history(symbol: str):
    """Historical dividends for a symbol (real, from Yahoo/FMP)."""
    events = await corporate_actions_service.get_dividend_history(symbol)
    rows: list[dict[str, Any]] = []
    for evt in events:
        amount = extract_amount(evt.value)
        if amount is None:
            continue
        d = evt.ex_date or evt.event_date
        rows.append({"date": d.isoformat() if d else None, "amount": amount})
    rows.sort(key=lambda r: r.get("date") or "")
    return rows


@router.get("/dividends/aristocrats")
async def get_dividend_aristocrats():
    """S&P 500 Dividend Aristocrats with live trailing yields.

    Membership is a defined index (curated); yields are fetched live per symbol.
    """

    async def _one(sym: str, years: int) -> dict[str, Any]:
        yld: Optional[float] = None
        try:
            snap = await fetch_stock_snapshot_coalesced(sym)
            raw = snap.get("div_yield_pct")
            if isinstance(raw, (int, float)):
                yld = round(float(raw), 2)
        except Exception:
            yld = None
        return {"symbol": sym, "years_growth": years, "yield": yld}

    return await asyncio.gather(*[_one(s, y) for s, y in _ARISTOCRATS])


@router.get("/dividends/portfolio-income")
async def get_portfolio_dividend_income(db: Session = Depends(get_db)):
    """Projected dividend income for current holdings, bucketed by month.

    Combines concrete upcoming ex-date events (next 12 months) with a
    trailing-yield estimate so the annual figure is meaningful even when a name
    has no scheduled event in the window.
    """
    holdings = db.query(Holding).all()
    qty = {h.ticker.strip().upper(): float(h.quantity) for h in holdings if h.ticker}
    symbols = sorted(qty.keys())

    months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]
    monthly = {m: 0.0 for m in months}
    annual_income = 0.0

    if symbols:
        events = await corporate_actions_service.get_portfolio_events(symbols, days_ahead=365)
        for evt in events:
            if evt.event_type != EventType.DIVIDEND:
                continue
            amt = extract_amount(evt.value)
            if amt is None:
                continue
            d = evt.ex_date or evt.event_date
            if not d:
                continue
            projected = amt * qty.get(evt.symbol.upper(), 0.0)
            annual_income += projected
            monthly[months[d.month - 1]] += projected

        # Yield-based fallback estimate for names with no scheduled event.
        seen = {evt.symbol.upper() for evt in events if evt.event_type == EventType.DIVIDEND}
        for h in holdings:
            sym = (h.ticker or "").strip().upper()
            if not sym or sym in seen:
                continue
            try:
                snap = await fetch_stock_snapshot_coalesced(sym)
            except Exception:
                continue
            dy = snap.get("div_yield_pct")
            px = snap.get("current_price")
            if isinstance(dy, (int, float)) and isinstance(px, (int, float)):
                annual_income += float(h.quantity) * float(px) * (float(dy) / 100.0)

    return {
        "annual_income": annual_income,
        "monthly_breakdown": [{"month": m, "amount": round(monthly[m], 2)} for m in months],
    }
