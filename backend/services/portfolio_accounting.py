"""Base-currency accounting for user portfolios.

Every monetary input keeps its native amount and is converted through the
shared, traceable FX valuation contract.  Missing currency evidence or rates
never fall back to parity: dependent totals become unavailable and the result
explains why through machine-readable issues.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, time, timezone
from typing import Any, Awaitable, Callable, Iterable


RateResolver = Callable[[str, str, date | None], Awaitable[dict[str, Any]]]

_TRADE_TYPES = frozenset({"buy", "sell"})
_CASH_ONLY_TYPES = frozenset({"dividend", "deposit", "withdrawal"})


def _currency(value: Any) -> str | None:
    normalized = str(value or "").strip().upper()
    return normalized or None


def _historical_date(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value or "")[:10])
    except (TypeError, ValueError):
        return None


def _number(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _tx_sort_key(tx: Any) -> tuple[datetime, datetime]:
    try:
        occurred = datetime.fromisoformat(str(getattr(tx, "date", "") or ""))
    except (TypeError, ValueError):
        occurred = datetime.min
    created = getattr(tx, "created_at", None)
    if not isinstance(created, datetime):
        created = datetime.min
    return occurred.replace(tzinfo=None), created.replace(tzinfo=None)


async def calculate_portfolio_accounting(
    *,
    base_currency: str,
    starting_cash: float,
    holdings: Iterable[Any],
    transactions: Iterable[Any],
    quotes: dict[str, dict[str, Any]],
    resolve_rate: RateResolver,
    as_of: datetime | None = None,
) -> dict[str, Any]:
    """Calculate auditable portfolio totals in ``base_currency``.

    ``resolve_rate`` must follow ``ForexService.get_valuation_rate`` semantics:
    source/base currency first, reporting/quote currency second, with an optional
    historical date. Calls are deduplicated so a portfolio needs at most one
    provider lookup per currency/date tuple.
    """

    base = _currency(base_currency) or "USD"
    holding_rows = list(holdings)
    transaction_rows = list(transactions)
    valued_at = as_of or datetime.now(timezone.utc)
    issues: list[dict[str, Any]] = []
    degraded_reasons: list[str] = []
    rate_evidence: dict[tuple[str, str, date | None], dict[str, Any]] = {}
    rate_errors: dict[tuple[str, str, date | None], str] = {}
    requirements: set[tuple[str, str, date | None]] = set()

    def require(source: str | None, requested_date: date | None) -> None:
        if source and source != base:
            requirements.add((source, base, requested_date))

    for holding in holding_rows:
        shares = _number(getattr(holding, "shares", 0.0))
        cost = shares * _number(getattr(holding, "cost_basis_per_share", 0.0))
        cost_currency = _currency(getattr(holding, "cost_basis_currency", None))
        purchase_date = _historical_date(getattr(holding, "purchase_date", None))
        if cost and cost_currency and (cost_currency == base or purchase_date is not None):
            require(cost_currency, purchase_date)

        quote = quotes.get(str(getattr(holding, "symbol", "") or ""), {}) or {}
        raw_price = quote.get("current_price")
        if shares and isinstance(raw_price, (int, float)):
            require(_currency(quote.get("currency")), None)

    for tx in transaction_rows:
        tx_type = str(getattr(tx, "type", "") or "").strip().lower()
        shares = _number(getattr(tx, "shares", 0.0))
        price = _number(getattr(tx, "price", 0.0))
        amount = shares * price if tx_type in _TRADE_TYPES else price if tx_type in _CASH_ONLY_TYPES else 0.0
        occurred_on = _historical_date(getattr(tx, "date", None))
        if amount and _currency(getattr(tx, "currency", None)) and (
            _currency(getattr(tx, "currency", None)) == base or occurred_on is not None
        ):
            require(_currency(getattr(tx, "currency", None)), occurred_on)
        if _number(getattr(tx, "fees", 0.0)) and _currency(getattr(tx, "fees_currency", None)) and (
            _currency(getattr(tx, "fees_currency", None)) == base or occurred_on is not None
        ):
            require(_currency(getattr(tx, "fees_currency", None)), occurred_on)

    async def fetch_rate(key: tuple[str, str, date | None]) -> tuple[tuple[str, str, date | None], dict[str, Any] | None, str | None]:
        source, target, requested_date = key
        try:
            return key, await resolve_rate(source, target, requested_date), None
        except Exception as exc:  # provider and unsupported-currency failures are data, not endpoint failures
            return key, None, str(exc) or exc.__class__.__name__

    if requirements:
        fetched = await asyncio.gather(*(fetch_rate(key) for key in sorted(requirements, key=lambda row: (row[0], row[1], row[2] or date.max))))
        for key, payload, error in fetched:
            if payload is not None:
                rate_evidence[key] = payload
                if payload.get("degraded"):
                    reason = str(payload.get("degraded_reason") or f"{key[0]}{key[1]} rate is degraded")
                    if reason not in degraded_reasons:
                        degraded_reasons.append(reason)
            elif error:
                rate_errors[key] = error

    def issue(
        code: str,
        scope: str,
        row_id: Any,
        source: str | None,
        requested_date: date | None,
        message: str,
    ) -> None:
        issues.append({
            "code": code,
            "scope": scope,
            "id": str(row_id or ""),
            "source_currency": source,
            "target_currency": base,
            "requested_date": requested_date,
            "message": message,
        })

    def convert(
        amount: float,
        source: str | None,
        requested_date: date | None,
        *,
        scope: str,
        row_id: Any,
        needs_historical_date: bool,
    ) -> tuple[float | None, dict[str, Any] | None]:
        if amount == 0:
            return 0.0, None
        if not source:
            issue("currency_unknown", scope, row_id, None, requested_date, "Currency is unknown; no parity rate was assumed")
            return None, None
        if source == base:
            rate_at = (
                datetime.combine(requested_date, time.min, tzinfo=timezone.utc)
                if requested_date is not None
                else valued_at
            )
            return amount, {
                "base_currency": source,
                "quote_currency": base,
                "rate": 1.0,
                "rate_at": rate_at,
                "requested_date": requested_date,
                "source": "identity",
                "source_symbol": f"{source}{base}",
                "freshness": "historical" if requested_date is not None else "current",
                "cache_status": "identity",
                "degraded": False,
                "degraded_reason": None,
            }
        if needs_historical_date and requested_date is None and source != base:
            issue("date_invalid", scope, row_id, source, None, "A valid date is required for historical FX conversion")
            return None, None
        key = (source, base, requested_date)
        evidence = rate_evidence.get(key)
        if evidence is None:
            message = rate_errors.get(key, f"No FX rate is available for {source}{base}")
            issue("rate_unavailable", scope, row_id, source, requested_date, message)
            return None, None
        return amount * _number(evidence.get("rate")), evidence

    holding_details: list[dict[str, Any]] = []
    known_value = 0.0
    known_day_change = 0.0
    values_complete = True
    sectors: dict[str, float] = {}
    markets: dict[str, float] = {}
    top_rows: list[dict[str, Any]] = []

    for holding in holding_rows:
        row_id = getattr(holding, "id", None)
        symbol = str(getattr(holding, "symbol", "") or "").strip().upper()
        shares = _number(getattr(holding, "shares", 0.0))
        unit_cost = _number(getattr(holding, "cost_basis_per_share", 0.0))
        cost_native = shares * unit_cost
        cost_currency = _currency(getattr(holding, "cost_basis_currency", None))
        purchase_date = _historical_date(getattr(holding, "purchase_date", None))
        cost_base, cost_rate = convert(
            cost_native,
            cost_currency,
            purchase_date,
            scope="holding_cost",
            row_id=row_id,
            needs_historical_date=True,
        )
        quote = quotes.get(symbol, {}) or {}
        raw_price = quote.get("current_price")
        market_currency = _currency(quote.get("currency"))
        market_native = shares * _number(raw_price) if isinstance(raw_price, (int, float)) else None
        if shares and not isinstance(raw_price, (int, float)):
            issue("quote_unavailable", "holding_market_value", row_id, market_currency, None, f"No current price is available for {symbol}")
            market_base = None
            market_rate = None
        else:
            market_base, market_rate = convert(
                market_native or 0.0,
                market_currency,
                None,
                scope="holding_market_value",
                row_id=row_id,
                needs_historical_date=False,
            )
        if market_base is None:
            values_complete = False
        else:
            known_value += market_base
            change_pct = _number(quote.get("change_pct"))
            known_day_change += market_base * (change_pct / 100.0)
            sector = str(quote.get("sector") or "Unknown")
            sectors[sector] = sectors.get(sector, 0.0) + market_base
            exchange = str(quote.get("exchange") or "Unknown").upper()
            market = str(quote.get("market") or exchange or "Unknown").upper()
            markets[market] = markets.get(market, 0.0) + market_base

        holding_details.append({
            "id": str(row_id or ""),
            "symbol": symbol,
            "_shares": shares,
            "_day_change_pct": _number(quote.get("change_pct")),
            "cost_basis_native": {"amount": cost_native, "currency": cost_currency},
            "cost_basis_base": cost_base,
            "cost_basis_fx": cost_rate,
            "cost_basis_method": "holding_record",
            "market_value_native": {"amount": market_native, "currency": market_currency},
            "market_value_base": market_base,
            "market_value_fx": market_rate,
            "unrealized_pnl_base": None,
        })

    transaction_details: list[dict[str, Any]] = []
    cash = _number(starting_cash)
    cash_complete = True
    known_fees = 0.0
    fees_complete = True
    dividend_income = 0.0
    dividends_complete = True
    converted_transactions: list[tuple[Any, float | None, float | None]] = []

    for tx in transaction_rows:
        row_id = getattr(tx, "id", None)
        tx_type = str(getattr(tx, "type", "") or "").strip().lower()
        shares = _number(getattr(tx, "shares", 0.0))
        price = _number(getattr(tx, "price", 0.0))
        amount_native = shares * price if tx_type in _TRADE_TYPES else price if tx_type in _CASH_ONLY_TYPES else 0.0
        occurred_on = _historical_date(getattr(tx, "date", None))
        tx_currency = _currency(getattr(tx, "currency", None))
        amount_base, amount_rate = convert(
            amount_native,
            tx_currency,
            occurred_on,
            scope="transaction_amount",
            row_id=row_id,
            needs_historical_date=True,
        )
        fees_native = _number(getattr(tx, "fees", 0.0))
        fees_currency = _currency(getattr(tx, "fees_currency", None))
        fees_base, fees_rate = convert(
            fees_native,
            fees_currency,
            occurred_on,
            scope="transaction_fee",
            row_id=row_id,
            needs_historical_date=True,
        )
        if fees_base is None:
            fees_complete = False
        else:
            known_fees += fees_base

        if amount_base is None or fees_base is None:
            cash_complete = False
            cash_delta_base = None
        elif tx_type == "buy":
            cash_delta_base = -(amount_base + fees_base)
        elif tx_type in {"sell", "dividend", "deposit"}:
            cash_delta_base = amount_base - fees_base
        elif tx_type == "withdrawal":
            cash_delta_base = -(amount_base + fees_base)
        else:
            cash_delta_base = 0.0
        if cash_delta_base is not None:
            cash += cash_delta_base

        if tx_type == "dividend":
            if occurred_on is None:
                dividends_complete = False
                issue("date_invalid", "dividend_income_ytd", row_id, tx_currency, None, "A valid date is required to classify dividend income by year")
            elif occurred_on.year == valued_at.year:
                if amount_base is None:
                    dividends_complete = False
                else:
                    dividend_income += amount_base

        unit_price_base = amount_base / shares if amount_base is not None and shares > 0 else None
        converted_transactions.append((tx, unit_price_base, fees_base))
        transaction_details.append({
            "id": str(row_id or ""),
            "type": tx_type,
            "symbol": str(getattr(tx, "symbol", "") or ""),
            "amount_native": {"amount": amount_native, "currency": tx_currency},
            "amount_base": amount_base,
            "amount_fx": amount_rate,
            "fees_native": {"amount": fees_native, "currency": fees_currency},
            "fees_base": fees_base,
            "fees_fx": fees_rate,
            "cash_delta_base": cash_delta_base,
        })

    realized = 0.0
    realized_complete = True
    positions: dict[str, list[float]] = {}
    trade_symbols: set[str] = set()
    incomplete_trade_symbols: set[str] = set()
    for tx, unit_price_base, fees_base in sorted(converted_transactions, key=lambda row: _tx_sort_key(row[0])):
        tx_type = str(getattr(tx, "type", "") or "").strip().lower()
        if tx_type not in _TRADE_TYPES:
            continue
        symbol = str(getattr(tx, "symbol", "") or "").strip().upper()
        shares = _number(getattr(tx, "shares", 0.0))
        if shares <= 0:
            continue
        trade_symbols.add(symbol)
        if _historical_date(getattr(tx, "date", None)) is None:
            realized_complete = False
            incomplete_trade_symbols.add(symbol)
            issue("date_invalid", "realized_pnl", getattr(tx, "id", None), _currency(getattr(tx, "currency", None)), None, "A valid date is required to replay realized P&L")
            continue
        if unit_price_base is None or fees_base is None:
            realized_complete = False
            incomplete_trade_symbols.add(symbol)
            continue
        quantity, average = positions.get(symbol, [0.0, 0.0])
        if tx_type == "buy":
            new_quantity = quantity + shares
            average = (quantity * average + shares * unit_price_base) / new_quantity if new_quantity > 0 else 0.0
            positions[symbol] = [new_quantity, average]
        else:
            realized += shares * (unit_price_base - average) - fees_base
            remaining = quantity - shares
            positions[symbol] = [remaining, average] if remaining > 1e-9 else [0.0, 0.0]

    # A holding's native weighted average is insufficient when one foreign lot
    # was enlarged on multiple dates. Prefer the dated ledger replay whenever
    # its open quantity reconciles with the holdings table; otherwise retain the
    # independently convertible holding record and expose the mismatch.
    holding_shares_by_symbol: dict[str, float] = {}
    for detail in holding_details:
        symbol = str(detail["symbol"])
        holding_shares_by_symbol[symbol] = holding_shares_by_symbol.get(symbol, 0.0) + _number(detail["_shares"])
    for symbol in trade_symbols - incomplete_trade_symbols:
        ledger_quantity, ledger_average = positions.get(symbol, [0.0, 0.0])
        holding_quantity = holding_shares_by_symbol.get(symbol, 0.0)
        if abs(ledger_quantity - holding_quantity) > 1e-7:
            issue(
                "ledger_holding_mismatch",
                "holding_cost",
                symbol,
                base,
                None,
                f"Open ledger quantity {ledger_quantity:g} does not reconcile with holding quantity {holding_quantity:g}",
            )
            continue
        for detail in holding_details:
            if detail["symbol"] != symbol:
                continue
            issues[:] = [
                row for row in issues
                if not (row["scope"] == "holding_cost" and row["id"] == detail["id"])
            ]
            detail["cost_basis_base"] = _number(detail["_shares"]) * ledger_average
            detail["cost_basis_fx"] = None
            detail["cost_basis_method"] = "ledger_replay"

    known_cost = 0.0
    costs_complete = True
    for detail in holding_details:
        cost_base = detail["cost_basis_base"]
        market_base = detail["market_value_base"]
        if cost_base is None:
            costs_complete = False
        else:
            known_cost += _number(cost_base)
        pnl_base = market_base - cost_base if market_base is not None and cost_base is not None else None
        detail["unrealized_pnl_base"] = pnl_base
        pnl_pct = pnl_base / cost_base * 100.0 if pnl_base is not None and cost_base and cost_base > 0 else None
        if pnl_pct is not None:
            top_rows.append({
                "symbol": detail["symbol"],
                "pnl_pct": pnl_pct,
                "day_change_pct": detail["_day_change_pct"],
            })
        detail.pop("_shares", None)
        detail.pop("_day_change_pct", None)

    total_cost = known_cost if costs_complete else None
    total_value = known_value if values_complete else None
    cash_balance = cash if cash_complete else None
    net_liquidation = total_value + cash_balance if total_value is not None and cash_balance is not None else None
    unrealized = total_value - total_cost if total_value is not None and total_cost is not None else None
    unrealized_pct = unrealized / total_cost * 100.0 if unrealized is not None and total_cost and total_cost > 0 else None
    day_change = known_day_change if values_complete else None
    day_change_pct = day_change / total_value * 100.0 if day_change is not None and total_value and total_value > 0 else None

    return {
        "base_currency": base,
        "status": "partial" if issues else "degraded" if degraded_reasons else "complete",
        "as_of": valued_at,
        "issues": issues,
        "degraded_reasons": degraded_reasons,
        "fx_rates": list(rate_evidence.values()),
        "known_totals": {
            "cost_basis": known_cost,
            "market_value": known_value,
            "cash_balance": cash,
            "fees": known_fees,
            "dividend_income": dividend_income,
        },
        "totals": {
            "total_cost": total_cost,
            "total_value": total_value,
            "cash_balance": cash_balance,
            "net_liquidation_value": net_liquidation,
            "unrealized_pnl": unrealized,
            "unrealized_pnl_pct": unrealized_pct,
            "realized_pnl": realized if realized_complete else None,
            "day_change": day_change,
            "day_change_pct": day_change_pct,
            "dividend_income_ytd": dividend_income if dividends_complete else None,
            "fees": known_fees if fees_complete else None,
        },
        "allocation_by_sector": (
            [{"name": key, "value": value} for key, value in sorted(sectors.items(), key=lambda row: row[1], reverse=True)]
            if values_complete else []
        ),
        "allocation_by_market": (
            [{"name": key, "value": value} for key, value in sorted(markets.items(), key=lambda row: row[1], reverse=True)]
            if values_complete else []
        ),
        "top_gainers": sorted(top_rows, key=lambda row: row["pnl_pct"], reverse=True)[:5] if costs_complete and values_complete else [],
        "top_losers": sorted(top_rows, key=lambda row: row["pnl_pct"])[:5] if costs_complete and values_complete else [],
        "holdings": holding_details,
        "transactions": transaction_details,
    }
