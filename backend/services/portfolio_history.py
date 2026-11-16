"""Read-only, daily ledger reconstruction; never writes snapshots or repairs trades."""
from __future__ import annotations

import asyncio
import math
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

import pandas as pd

from backend.api.deps import fetch_stock_snapshot_coalesced
from backend.services.forex_service import service as forex_service
from backend.services.portfolio_accounting import calculate_portfolio_accounting
from backend.services.portfolio_analytics import BENCHMARK_MAP, portfolio_analytics_service

METHOD = "daily_ledger_reconstruction"
ASSUMPTIONS = [
    "Approximate reconstruction from the current recorded ledger, not retained account snapshots.",
    "Opening cash is applied from the earliest recorded activity or portfolio creation; no cash funding is invented.",
    "UTC calendar-day closes; prior native closes carry for at most 7 days. Historical FX is valued for each portfolio day.",
    "Return index adjusts deposits/withdrawals as end-of-day external flows; intraday execution timing is unknown.",
    "No corporate-action replay is available; splits, adjusted provider closes or missing ledger entries can distort older values.",
]


def _day(value: Any) -> date:
    return date.fromisoformat(str(value)[:10])


def _finite(value: Any) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Non-finite ledger value")
    return number


async def reconstruct_portfolio_history(
    portfolio: Any, holdings: Iterable[Any], transactions: Iterable[Any], *, today: date | None = None,
) -> dict[str, Any]:
    """Last 30 calendar days of daily NAV and flow-adjusted approximate returns.

    Cash follows the shared accounting engine: each ledger amount/fee is converted
    at its transaction-date FX and carried in the reporting base. Securities use
    their quote currency and each valuation day's FX. Fully closed symbols remain
    in the replay. Future transactions are excluded; inconsistent positions fail
    closed instead of inventing opening positions or funding.
    """
    end = today or datetime.now(timezone.utc).date()
    window_start = end - timedelta(days=29)
    base = str(portfolio.currency or "USD").upper()
    benchmark = portfolio.benchmark_symbol or "S&P500"
    benchmark_symbol = BENCHMARK_MAP.get(benchmark.upper(), benchmark)
    issues: list[dict[str, Any]] = []
    reasons: list[str] = []
    payload: dict[str, Any] = {
        "portfolio_id": str(portfolio.id), "base_currency": base, "benchmark": benchmark,
        "methodology": METHOD, "status": "degraded", "issues": issues,
        "degraded_reasons": reasons, "assumptions": list(ASSUMPTIONS), "equity_curve": [],
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "excluded_transactions": [],
    }

    def fail(code: str, symbol: str | None = None, day: date | None = None) -> dict[str, Any]:
        issues.append({"code": code, "symbol": symbol, "date": day.isoformat() if day else None})
        payload["status"] = "partial"
        payload["equity_curve"] = []
        return payload

    rows = []
    try:
        opening_cash = _finite(portfolio.starting_cash)
        created = _day(portfolio.created_at)
        for tx in transactions:
            occurred = _day(tx.date)
            if occurred > end:
                continue
            kind = str(tx.type).lower()
            shares, price, fees = _finite(tx.shares), _finite(tx.price), _finite(tx.fees)
            if kind not in {"buy", "sell", "dividend", "deposit", "withdrawal"} or min(shares, price, fees) < 0:
                return fail("ledger_value_invalid")
            symbol = str(tx.symbol or "").strip().upper()
            if kind in {"buy", "sell"} and (not symbol or shares <= 0):
                return fail("ledger_value_invalid", symbol)
            rows.append((occurred, tx))
        rows.sort(key=lambda row: (row[0], str(getattr(row[1], "created_at", "")), str(getattr(row[1], "id", ""))))
    except (ValueError, TypeError, OverflowError):
        return fail("ledger_date_or_value_invalid")

    # Reconcile by symbol; historical sells may have consumed several FIFO lots.
    net: dict[str, float] = defaultdict(float)
    replay_rows = []
    for occurred, tx in rows:
        kind, symbol = str(tx.type).lower(), str(tx.symbol or "").strip().upper()
        if kind in {"buy", "sell"}:
            next_quantity = net[symbol] + float(tx.shares) * (1 if kind == "buy" else -1)
            if next_quantity < -1e-7 and occurred < window_start:
                # Legacy add/remove portfolios can contain sales with no recorded
                # acquisition. Ignore the whole old row, including proceeds and
                # fees; do not invent a purchase or change the stored ledger.
                payload["excluded_transactions"].append({
                    "id": str(getattr(tx, "id", "")), "symbol": symbol,
                    "date": occurred.isoformat(), "shares": float(tx.shares),
                    "reason": "legacy_unmatched_sale",
                })
                continue
            if next_quantity < -1e-7:
                return fail("ledger_position_negative", symbol, occurred)
            net[symbol] = next_quantity
        replay_rows.append((occurred, tx))
    rows = replay_rows
    if payload["excluded_transactions"]:
        reasons.append(
            f"Excluded {len(payload['excluded_transactions'])} unmatched legacy sale(s) before the 30-day window, "
            "including their proceeds and fees. Reconstructed cash can differ from current ledger accounting; "
            "inspect the excluded rows. Stored transactions are unchanged."
        )
    current: dict[str, float] = defaultdict(float)
    try:
        for holding in holdings:
            current[str(holding.symbol).strip().upper()] += _finite(holding.shares)
    except (ValueError, TypeError):
        return fail("ledger_value_invalid")
    for symbol in current.keys() | net.keys():
        if not math.isclose(current.get(symbol, 0), net.get(symbol, 0), rel_tol=1e-8, abs_tol=1e-7):
            return fail("ledger_holdings_mismatch", symbol)
    # Only symbols held during this window need market history (including sales).
    before: dict[str, float] = defaultdict(float)
    needed = set()
    for occurred, tx in rows:
        if str(tx.type).lower() in {"buy", "sell"}:
            symbol = str(tx.symbol).strip().upper()
            if occurred < window_start:
                before[symbol] += float(tx.shares) * (1 if str(tx.type).lower() == "buy" else -1)
            else:
                needed.add(symbol)
    needed.update(symbol for symbol, quantity in before.items() if quantity > 1e-7)
    start = max(window_start, min([created, *(day for day, _ in rows)]))
    if start > end:
        return fail("ledger_history_empty")
    days = list(pd.date_range(start, end, tz="UTC"))

    # Reuse transaction-date conversion, fee-currency and cash conventions.
    accounting = await calculate_portfolio_accounting(
        base_currency=base, starting_cash=opening_cash, holdings=[], transactions=[tx for _, tx in rows],
        quotes={}, resolve_rate=forex_service.get_valuation_rate,
    )
    if any(item["cash_delta_base"] is None for item in accounting["transactions"]):
        return fail("ledger_fx_or_currency_unavailable")
    reasons.extend(accounting["degraded_reasons"])
    by_day: dict[date, list[tuple[Any, dict[str, Any]]]] = defaultdict(list)
    cash = opening_cash
    positions: dict[str, float] = defaultdict(float)
    for (occurred, tx), detail in zip(rows, accounting["transactions"]):
        if occurred < start:
            cash += detail["cash_delta_base"]
            if str(tx.type).lower() in {"buy", "sell"}:
                positions[str(tx.symbol).strip().upper()] += float(tx.shares) * (1 if str(tx.type).lower() == "buy" else -1)
        else:
            by_day[occurred].append((tx, detail))

    async def market(symbol: str) -> tuple[str, pd.Series, str | None]:
        try:
            quote, prices = await asyncio.gather(
                fetch_stock_snapshot_coalesced(symbol),
                portfolio_analytics_service._close_series(symbol, range_str="3mo"),
            )
            classification = quote.get("_classification") or {}
            currency = classification.get("currency") or quote.get("currency")
            # Validate native series before ffill; never convert invalid/zero closes.
            prices = prices[prices.map(lambda value: math.isfinite(float(value)) and float(value) > 0)].sort_index()
            return symbol, prices, currency
        except Exception:
            return symbol, pd.Series(dtype="float64"), None

    market_rows = await asyncio.gather(*(market(symbol) for symbol in sorted(needed | {benchmark_symbol})))
    native = {symbol: series for symbol, series, _ in market_rows}
    currencies = {symbol: currency for symbol, _, currency in market_rows}
    rates: dict[str, dict[str, Any]] = {}
    # Daily FX (rather than ffilled converted security prices) captures weekend FX
    # effects consistently even if native exchanges have different close dates.
    async def fx(currency: str) -> None:
        try:
            rates[currency] = await forex_service.get_historical_valuation_rates(currency, base, [day.date() for day in days])
        except Exception:
            rates[currency] = {}
    await asyncio.gather(*(fx(currency) for currency in sorted({str(currencies[s]) for s in native if currencies[s]})))

    def close(symbol: str, day: pd.Timestamp) -> tuple[float | None, str | None]:
        series = native[symbol]
        if series.empty:
            return None, None
        previous = series.loc[series.index <= day]
        if previous.empty or (day - previous.index[-1]).days > 7:
            return None, None
        currency = currencies[symbol]
        rate = rates.get(str(currency), {}).get(day.date().isoformat())
        if not rate or not currency:
            return None, None
        try:
            rate_value = _finite(rate["rate"])
            if rate_value <= 0:
                return None, None
            if rate.get("degraded"):
                reason = str(rate.get("degraded_reason") or "Historical FX is degraded")
                if reason not in reasons:
                    reasons.append(reason)
            return float(previous.iloc[-1]) * rate_value, previous.index[-1].date().isoformat()
        except (KeyError, ValueError, TypeError):
            return None, None

    curve = []
    previous_nav: float | None = None
    index: float | None = None
    index_broken = False
    benchmark_missing = False
    for day in days:
        external_flow = 0.0
        for tx, detail in by_day[day.date()]:
            cash += detail["cash_delta_base"]
            kind = str(tx.type).lower()
            if kind in {"deposit", "withdrawal"}:
                external_flow += detail["amount_base"] * (1 if kind == "deposit" else -1)
            elif kind in {"buy", "sell"}:
                positions[str(tx.symbol).strip().upper()] += float(tx.shares) * (1 if kind == "buy" else -1)
        market_value = 0.0
        price_dates: dict[str, str] = {}
        for symbol, quantity in positions.items():
            if quantity <= 1e-7:
                continue
            price, as_of = close(symbol, day)
            if price is None:
                return fail("ledger_price_or_fx_unavailable", symbol, day.date())
            market_value += quantity * price
            price_dates[symbol] = as_of
        nav = cash + market_value
        if not math.isfinite(nav):
            return fail("ledger_value_invalid", day=day.date())
        if cash < -1e-7 and "Negative ledger cash; no missing deposit was inferred." not in reasons:
            reasons.append("Negative ledger cash; no missing deposit was inferred.")
        if not index_broken:
            if previous_nav is None or previous_nav == 0 and index is None:
                index = 100.0 if nav > 0 else None
            elif previous_nav > 0 and index is not None:
                factor = (nav - external_flow) / previous_nav
                if factor > 0 and math.isfinite(index * factor):
                    index *= factor
                else:
                    index, index_broken = None, True
            else:
                index, index_broken = None, True
        bench_price, bench_as_of = close(benchmark_symbol, day)
        benchmark_missing |= bench_price is None
        curve.append({"date": day.date().isoformat(), "net_liquidation_value": nav, "cash_balance": cash,
                      "holdings_value": market_value, "external_flow": external_flow, "portfolio": index,
                      "benchmark": bench_price, "benchmark_as_of": bench_as_of, "price_dates": price_dates})
        previous_nav = nav
    if any(point["portfolio"] is None for point in curve):
        reasons.append("Return index unavailable on non-positive or unfunded valuation periods; inspect reconstructed values instead.")
    if benchmark_missing:
        issues.append({"code": "benchmark_history_unavailable", "symbol": benchmark_symbol})
    payload["equity_curve"] = curve
    return payload
