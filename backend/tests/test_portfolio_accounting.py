"""Deterministic contracts for base-currency portfolio accounting."""
from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from backend.services.portfolio_accounting import calculate_portfolio_accounting


def _holding(
    symbol: str,
    shares: float,
    cost: float,
    currency: str | None,
    purchase_date: str = "2026-01-02",
    row_id: str = "h1",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=row_id,
        symbol=symbol,
        shares=shares,
        cost_basis_per_share=cost,
        cost_basis_currency=currency,
        purchase_date=purchase_date,
    )


def _tx(
    type_: str,
    *,
    symbol: str = "",
    shares: float = 0,
    price: float = 0,
    currency: str | None = None,
    fees: float = 0,
    fees_currency: str | None = None,
    occurred_on: str = "2026-01-02",
    row_id: str = "t1",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=row_id,
        type=type_,
        symbol=symbol,
        shares=shares,
        price=price,
        currency=currency,
        fees=fees,
        fees_currency=fees_currency,
        date=occurred_on,
        created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
    )


def _resolver(rates: dict[tuple[str, str, date | None], float], *, degraded: bool = False):
    calls: list[tuple[str, str, date | None]] = []

    async def resolve(source: str, target: str, requested_date: date | None):
        key = (source, target, requested_date)
        calls.append(key)
        if key not in rates:
            raise RuntimeError(f"missing deterministic rate for {key}")
        return {
            "base_currency": source,
            "quote_currency": target,
            "rate": rates[key],
            "rate_at": datetime(2026, 1, 2, tzinfo=timezone.utc),
            "requested_date": requested_date,
            "source": "test",
            "source_symbol": f"{source}{target}",
            "freshness": "stale" if degraded else "historical",
            "cache_status": "stale" if degraded else "fresh",
            "degraded": degraded,
            "degraded_reason": "deterministic stale rate" if degraded else None,
        }

    resolve.calls = calls  # type: ignore[attr-defined]
    return resolve


@pytest.mark.asyncio
async def test_mixed_currency_totals_reconcile_in_portfolio_base() -> None:
    historical = date(2026, 1, 2)
    resolve = _resolver({
        ("EUR", "USD", historical): 1.2,
        ("EUR", "USD", None): 1.3,
        ("GBP", "USD", historical): 1.4,
    })
    holding = _holding("SAP.DE", 2, 100, "EUR")
    transactions = [
        _tx("deposit", price=500, currency="USD", row_id="deposit"),
        _tx(
            "buy",
            symbol="SAP.DE",
            shares=2,
            price=100,
            currency="EUR",
            fees=1,
            fees_currency="GBP",
            row_id="buy",
        ),
    ]

    result = await calculate_portfolio_accounting(
        base_currency="USD",
        starting_cash=1000,
        holdings=[holding],
        transactions=transactions,
        quotes={"SAP.DE": {"current_price": 120, "currency": "EUR", "change_pct": 2, "sector": "Tech", "exchange": "XETRA"}},
        resolve_rate=resolve,
        as_of=datetime(2026, 4, 1, tzinfo=timezone.utc),
    )

    assert result["status"] == "complete"
    assert result["totals"] == pytest.approx({
        "total_cost": 240,
        "total_value": 312,
        "cash_balance": 1258.6,
        "net_liquidation_value": 1570.6,
        "unrealized_pnl": 72,
        "unrealized_pnl_pct": 30,
        "realized_pnl": 0,
        "day_change": 6.24,
        "day_change_pct": 2,
        "dividend_income_ytd": 0,
        "fees": 1.4,
    })
    assert result["holdings"][0]["cost_basis_native"] == {"amount": 200, "currency": "EUR"}
    assert result["holdings"][0]["market_value_native"] == {"amount": 240, "currency": "EUR"}
    assert result["transactions"][1]["cash_delta_base"] == pytest.approx(-241.4)
    assert len(resolve.calls) == 3  # identical holding/buy historical EUR lookup is deduplicated


@pytest.mark.asyncio
async def test_realized_gain_replays_dated_base_currency_prices() -> None:
    buy_date = date(2026, 1, 2)
    sell_date = date(2026, 2, 3)
    resolve = _resolver({
        ("EUR", "USD", buy_date): 1.1,
        ("EUR", "USD", sell_date): 1.2,
    })
    transactions = [
        _tx("buy", symbol="SAP.DE", shares=10, price=100, currency="EUR", occurred_on=str(buy_date), row_id="buy"),
        _tx(
            "sell",
            symbol="SAP.DE",
            shares=5,
            price=120,
            currency="EUR",
            fees=2,
            fees_currency="USD",
            occurred_on=str(sell_date),
            row_id="sell",
        ),
    ]

    result = await calculate_portfolio_accounting(
        base_currency="USD",
        starting_cash=2000,
        holdings=[],
        transactions=transactions,
        quotes={},
        resolve_rate=resolve,
    )

    assert result["totals"]["realized_pnl"] == pytest.approx(168)
    assert result["totals"]["cash_balance"] == pytest.approx(1618)


@pytest.mark.asyncio
async def test_unknown_currency_withholds_only_dependent_totals() -> None:
    result = await calculate_portfolio_accounting(
        base_currency="USD",
        starting_cash=1000,
        holdings=[_holding("AAPL", 1, 100, None)],
        transactions=[_tx("deposit", price=500, currency=None)],
        quotes={"AAPL": {"current_price": 120, "currency": "USD", "change_pct": 1}},
        resolve_rate=_resolver({}),
    )

    assert result["status"] == "partial"
    assert result["totals"]["total_value"] == 120
    assert result["totals"]["total_cost"] is None
    assert result["totals"]["cash_balance"] is None
    assert result["totals"]["net_liquidation_value"] is None
    assert result["known_totals"]["cash_balance"] == 1000
    assert {row["code"] for row in result["issues"]} == {"currency_unknown"}


@pytest.mark.asyncio
async def test_missing_current_quote_or_rate_never_becomes_zero_or_parity() -> None:
    async def unavailable(_source: str, _target: str, _requested_date: date | None):
        raise RuntimeError("provider unavailable")

    result = await calculate_portfolio_accounting(
        base_currency="USD",
        starting_cash=0,
        holdings=[
            _holding("SAP.DE", 1, 100, "EUR", row_id="missing-rate"),
            _holding("AAPL", 1, 50, "USD", row_id="missing-quote"),
        ],
        transactions=[],
        quotes={
            "SAP.DE": {"current_price": 120, "currency": "EUR"},
            "AAPL": {"currency": "USD"},
        },
        resolve_rate=unavailable,
    )

    assert result["status"] == "partial"
    assert result["totals"]["total_value"] is None
    assert result["known_totals"]["market_value"] == 0
    assert {row["code"] for row in result["issues"]} == {"rate_unavailable", "quote_unavailable"}


@pytest.mark.asyncio
async def test_stale_traceable_rates_produce_degraded_values() -> None:
    historical = date(2026, 1, 2)
    resolve = _resolver({
        ("EUR", "USD", historical): 1.2,
        ("EUR", "USD", None): 1.3,
    }, degraded=True)
    result = await calculate_portfolio_accounting(
        base_currency="USD",
        starting_cash=0,
        holdings=[_holding("SAP.DE", 1, 100, "EUR")],
        transactions=[],
        quotes={"SAP.DE": {"current_price": 120, "currency": "EUR"}},
        resolve_rate=resolve,
    )

    assert result["status"] == "degraded"
    assert result["totals"]["total_value"] == pytest.approx(156)
    assert result["issues"] == []
    assert result["degraded_reasons"] == ["deterministic stale rate"]


@pytest.mark.asyncio
async def test_dividend_income_is_ytd_while_cash_replays_full_ledger() -> None:
    transactions = [
        _tx("dividend", price=40, currency="USD", occurred_on="2025-12-31", row_id="prior"),
        _tx("dividend", price=60, currency="USD", occurred_on="2026-02-01", row_id="current"),
    ]
    result = await calculate_portfolio_accounting(
        base_currency="USD",
        starting_cash=100,
        holdings=[],
        transactions=transactions,
        quotes={},
        resolve_rate=_resolver({}),
        as_of=datetime(2026, 9, 11, tzinfo=timezone.utc),
    )

    assert result["totals"]["cash_balance"] == 200
    assert result["totals"]["dividend_income_ytd"] == 60


@pytest.mark.asyncio
async def test_open_cost_basis_replays_multi_date_foreign_buys() -> None:
    first = date(2026, 1, 2)
    second = date(2026, 2, 3)
    resolve = _resolver({
        ("EUR", "USD", first): 1.1,
        ("EUR", "USD", second): 1.2,
        ("EUR", "USD", None): 1.3,
    })
    transactions = [
        _tx("buy", symbol="SAP.DE", shares=10, price=100, currency="EUR", occurred_on=str(first), row_id="first"),
        _tx("buy", symbol="SAP.DE", shares=10, price=200, currency="EUR", occurred_on=str(second), row_id="second"),
    ]

    result = await calculate_portfolio_accounting(
        base_currency="USD",
        starting_cash=5000,
        # The stored weighted native average (150 EUR at the first date) would
        # convert to 3300 USD and lose the second acquisition's FX evidence.
        holdings=[_holding("SAP.DE", 20, 150, "EUR", purchase_date=str(first))],
        transactions=transactions,
        quotes={"SAP.DE": {"current_price": 200, "currency": "EUR"}},
        resolve_rate=resolve,
    )

    assert result["totals"]["total_cost"] == pytest.approx(3500)
    assert result["holdings"][0]["cost_basis_base"] == pytest.approx(3500)
    assert result["holdings"][0]["cost_basis_method"] == "ledger_replay"
    assert result["totals"]["unrealized_pnl"] == pytest.approx(1700)


@pytest.mark.asyncio
async def test_complete_ledger_can_recover_unknown_holding_cost_currency() -> None:
    acquired = date(2026, 1, 2)
    result = await calculate_portfolio_accounting(
        base_currency="USD",
        starting_cash=1000,
        holdings=[_holding("SAP.DE", 1, 100, None, purchase_date="")],
        transactions=[_tx("buy", symbol="SAP.DE", shares=1, price=100, currency="EUR", occurred_on=str(acquired))],
        quotes={"SAP.DE": {"current_price": 110, "currency": "EUR"}},
        resolve_rate=_resolver({
            ("EUR", "USD", acquired): 1.2,
            ("EUR", "USD", None): 1.3,
        }),
    )

    assert result["status"] == "complete"
    assert result["totals"]["total_cost"] == 120
    assert result["holdings"][0]["cost_basis_method"] == "ledger_replay"
    assert result["issues"] == []


@pytest.mark.asyncio
async def test_foreign_withdrawal_and_separate_fee_currency_keep_debit_signs() -> None:
    occurred_on = date(2026, 3, 4)
    result = await calculate_portfolio_accounting(
        base_currency="USD",
        starting_cash=1000,
        holdings=[],
        transactions=[_tx(
            "withdrawal",
            price=100,
            currency="EUR",
            fees=2,
            fees_currency="GBP",
            occurred_on=str(occurred_on),
        )],
        quotes={},
        resolve_rate=_resolver({
            ("EUR", "USD", occurred_on): 1.2,
            ("GBP", "USD", occurred_on): 1.4,
        }),
    )

    assert result["transactions"][0]["cash_delta_base"] == pytest.approx(-122.8)
    assert result["totals"]["cash_balance"] == pytest.approx(877.2)
    assert result["totals"]["fees"] == pytest.approx(2.8)
