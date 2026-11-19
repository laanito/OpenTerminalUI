"""Read-only owner-selected reporting; never pool ledgers across portfolios.

Revalue native amounts with the existing dated-FX accounting contract instead
of converting an already-computed base-currency P&L at today's rate. This is a
current valuation, not consolidated historical returns or a new tax-lot engine.
"""
from __future__ import annotations

import asyncio
import math
from collections import defaultdict
from datetime import date, datetime, time, timezone
from typing import Any, Iterable

from backend.services.forex_service import SUPPORTED_CURRENCIES
from backend.services.portfolio_accounting import RateResolver, calculate_portfolio_accounting

METHOD = "native_dated_fx_by_portfolio_v1"
ASSUMPTIONS = [
    "Current quotes and FX are retrieved observations, not simultaneous or guaranteed live prices.",
    "Starting cash uses the portfolio creation UTC date as its recorded opening boundary; this is not a verified deposit date.",
    "Cash and cost replay retain existing portfolio accounting semantics; this is not a multi-currency cash wallet or tax-lot calculation.",
    "Positions combine exact stored symbols, exchange and supported quote units only; aliases and currency variants are not merged.",
    "No consolidated historical returns, aggregate risk or AI interpretation is implied.",
]


def metric(values: Iterable[float | None], *, unit: str, known_value: float | None = None) -> dict[str, Any]:
    rows = list(values)
    known = [value for value in rows if value is not None]
    complete = len(known) == len(rows)
    return {
        "value": sum(known) if complete else None,
        "known_value": sum(known) if known_value is None else known_value,
        "complete_items": len(known), "total_items": len(rows), "unit": unit,
        "status": "complete" if complete else "partial" if known else "unavailable",
    }


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _quote(raw: dict[str, Any]) -> dict[str, Any]:
    quote = dict(raw)
    quote["_reported_unit"] = quote.get("currency")
    # Preserve unit casing: GBp is not GBP. Unsupported units remain unavailable.
    if quote.get("currency") not in SUPPORTED_CURRENCIES:
        quote["currency"] = None
    price = quote.get("current_price")
    if not _finite(price) or price < 0:
        quote["current_price"] = None
    return quote


async def consolidate_portfolios(
    *, portfolios: Iterable[Any], holdings: Iterable[Any], transactions: Iterable[Any],
    quotes: dict[str, dict[str, Any]], reporting_currency: str,
    resolve_rate: RateResolver, as_of: datetime | None = None,
) -> dict[str, Any]:
    """Inputs must already be owner-filtered. This service performs no writes."""
    if reporting_currency not in SUPPORTED_CURRENCIES:
        raise ValueError("Unsupported reporting currency")
    valued_at = as_of or datetime.now(timezone.utc)
    portfolio_rows = list(portfolios)
    holdings_by_portfolio: dict[str, list[Any]] = defaultdict(list)
    transactions_by_portfolio: dict[str, list[Any]] = defaultdict(list)
    selected_ids = {row.id for row in portfolio_rows}
    for holding in holdings:
        if holding.portfolio_id in selected_ids:
            holdings_by_portfolio[holding.portfolio_id].append(holding)
    for tx in transactions:
        if tx.portfolio_id in selected_ids:
            transactions_by_portfolio[tx.portfolio_id].append(tx)
    clean_quotes = {symbol: _quote(raw or {}) for symbol, raw in quotes.items()}
    # Deduplicate both successes and failures across portfolios and bound FX I/O.
    rates: dict[tuple[str, str, date | None], asyncio.Task] = {}
    limiter = asyncio.Semaphore(8)

    async def fetch_rate(source: str, target: str, day: date | None) -> dict[str, Any]:
        if source not in SUPPORTED_CURRENCIES or target not in SUPPORTED_CURRENCIES:
            raise ValueError("Unsupported FX currency")
        async with limiter:
            result = await resolve_rate(source, target, day)
        if not _finite(result.get("rate")) or result["rate"] <= 0:
            raise ValueError("FX provider returned an invalid rate")
        return result

    async def shared_rate(source: str, target: str, day: date | None) -> dict[str, Any]:
        key = (source, target, day)
        if key not in rates:
            rates[key] = asyncio.create_task(fetch_rate(source, target, day))
        return await rates[key]

    reports = []
    groups: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
    for portfolio in portfolio_rows:
        rows = holdings_by_portfolio[portfolio.id]
        accounting = await calculate_portfolio_accounting(
            base_currency=reporting_currency, starting_cash=0, holdings=rows,
            transactions=transactions_by_portfolio[portfolio.id], quotes=clean_quotes,
            resolve_rate=shared_rate, as_of=valued_at,
        )
        # Opening cash has its own native currency and recorded boundary. It is
        # never passed to the calculator as if already denominated in reporting units.
        opening = float(portfolio.starting_cash)
        created = portfolio.created_at
        if isinstance(created, datetime):
            opening_day = created.astimezone(timezone.utc).date() if created.tzinfo else created.date()
        else:
            opening_day = date.fromisoformat(str(created)[:10])
        opening_fx = None
        opening_value: float | None = opening
        if opening and portfolio.currency != reporting_currency:
            try:
                opening_fx = await shared_rate(portfolio.currency, reporting_currency, opening_day)
                opening_value = opening * opening_fx["rate"]
                if opening_fx not in accounting["fx_rates"]:
                    accounting["fx_rates"].append(opening_fx)
                if opening_fx.get("degraded"):
                    reason = str(opening_fx.get("degraded_reason") or "Opening cash FX is degraded")
                    if reason not in accounting["degraded_reasons"]:
                        accounting["degraded_reasons"].append(reason)
            except Exception:
                opening_value = None
                accounting["issues"].append({
                    "code": "rate_unavailable", "scope": "opening_cash", "id": portfolio.id,
                    "source_currency": portfolio.currency, "target_currency": reporting_currency,
                    "requested_date": opening_day, "message": "Opening cash FX is unavailable at the recorded portfolio creation boundary",
                })
        elif opening:
            opening_fx = {
                "base_currency": reporting_currency, "quote_currency": reporting_currency,
                "rate": 1.0, "rate_at": datetime.combine(opening_day, time.min, tzinfo=timezone.utc),
                "requested_date": opening_day, "source": "identity",
                "source_symbol": reporting_currency * 2, "freshness": "historical",
                "cache_status": "identity", "degraded": False, "degraded_reason": None,
            }
        totals = accounting["totals"]
        accounting["known_totals"]["cash_balance"] += opening_value or 0
        totals["cash_balance"] = totals["cash_balance"] + opening_value if totals["cash_balance"] is not None and opening_value is not None else None
        totals["net_liquidation_value"] = totals["total_value"] + totals["cash_balance"] if totals["total_value"] is not None and totals["cash_balance"] is not None else None
        accounting["status"] = "partial" if accounting["issues"] else "degraded" if accounting["degraded_reasons"] else "complete"
        reports.append({
            "portfolio_id": portfolio.id, "name": portfolio.name, "portfolio_currency": portfolio.currency,
            "opening_cash": {"native": {"amount": opening, "currency": portfolio.currency},
                             "reporting_value": opening_value, "fx": opening_fx,
                             "boundary_date": opening_day, "method": "portfolio_creation_boundary"},
            "accounting": accounting,
        })
        openings = {tx.lot_id: (getattr(tx, "operation_data", None) or {}).get("opening") for tx in transactions_by_portfolio[portfolio.id] if tx.type == "opening" and getattr(tx, "lot_id", "")}
        details = {detail["id"]: detail for detail in accounting["holdings"]}
        for row in rows:
            quote = clean_quotes.get(row.symbol, {})
            exchange = str(quote.get("exchange") or "").strip().upper()
            if exchange in {"UNKNOWN", "N/A", "NONE"}:
                exchange = ""
            unit = quote.get("_reported_unit")
            compatible = bool(exchange and unit in SUPPORTED_CURRENCIES)
            key = (row.symbol, exchange, unit) if compatible else ("unresolved", portfolio.id, row.id)
            groups[key].append({
                "portfolio_id": portfolio.id, "portfolio_name": portfolio.name,
                "holding_id": row.id, "lot_id": row.lot_id, "symbol": row.symbol,
                "shares": row.shares, "purchase_date": row.purchase_date,
                "cost_basis_per_share": row.cost_basis_per_share,
                "cost_basis_currency": row.cost_basis_currency,
                "notes": row.notes, "exchange": exchange or None, "quote_unit": unit,
                "current_price": quote.get("current_price"),
                "identity_status": "exact_symbol_exchange_unit" if compatible else "unresolved",
                "accounting": details[row.id], "opening": openings.get(row.lot_id),
            })

    positions = []
    for lots in groups.values():
        first = lots[0]
        positions.append({
            "symbol": first["symbol"], "exchange": first["exchange"], "quote_unit": first["quote_unit"],
            "identity_status": first["identity_status"],
            "identity_reason": None if first["identity_status"] != "unresolved" else "Exchange or supported quote unit is unavailable; this lot is kept separate",
            "shares": sum(lot["shares"] for lot in lots), "current_price": first["current_price"],
            "portfolio_ids": list(dict.fromkeys(lot["portfolio_id"] for lot in lots)),
            "metrics": {key: metric((lot["accounting"][field] for lot in lots), unit="lot") for key, field in (
                ("market_value", "market_value_base"), ("cost_basis", "cost_basis_base"), ("unrealized_pnl", "unrealized_pnl_base"))},
            "lots": lots,
        })
    positions.sort(key=lambda row: (row["symbol"], row["exchange"] or "", row["quote_unit"] or "", row["lots"][0]["holding_id"]))
    metrics = {}
    for name, field, known in (
        ("cash_balance", "cash_balance", "cash_balance"), ("fees", "fees", "fees"),
        ("dividend_income_ytd", "dividend_income_ytd", "dividend_income"),
        ("realized_pnl", "realized_pnl", None), ("net_liquidation_value", "net_liquidation_value", None),
    ):
        known_value = sum(report["accounting"]["known_totals"][known] for report in reports) if known else None
        if name == "net_liquidation_value":
            known_value = sum(report["accounting"]["known_totals"]["market_value"] + report["accounting"]["known_totals"]["cash_balance"] for report in reports)
        metrics[name] = metric((report["accounting"]["totals"][field] for report in reports), unit="portfolio", known_value=known_value)
    for name, field in (("market_value", "market_value_base"), ("cost_basis", "cost_basis_base"), ("unrealized_pnl", "unrealized_pnl_base")):
        metrics[name] = metric((lot["accounting"][field] for position in positions for lot in position["lots"]), unit="lot")
    degraded_reasons = list(dict.fromkeys(reason for report in reports for reason in report["accounting"]["degraded_reasons"]))
    return {
        "method": METHOD, "reporting_currency": reporting_currency, "as_of": valued_at,
        "status": "partial" if any(report["accounting"]["status"] == "partial" for report in reports) else "degraded" if degraded_reasons else "complete",
        "assumptions": list(ASSUMPTIONS), "degraded_reasons": degraded_reasons,
        "metrics": metrics, "positions": positions, "portfolios": reports,
    }
