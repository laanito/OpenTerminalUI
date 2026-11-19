"""Consolidated reporting preserves scope, native dates and per-metric gaps."""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace as Row

import pytest

from backend.services.portfolio_reporting import consolidate_portfolios
from backend.tests.test_portfolio_accounting import _holding, _resolver, _tx

AS_OF = datetime(2026, 11, 19, tzinfo=timezone.utc)


def portfolio(id="p1", currency="USD", cash=0):
    return Row(id=id, name=id, currency=currency, starting_cash=cash, created_at=datetime(2026, 1, 1, tzinfo=timezone.utc))


def holding(portfolio_id="p1", symbol="AAPL", shares=1, cost=100, currency="USD", id="h1", day="2026-01-02"):
    row = _holding(symbol, shares, cost, currency, purchase_date=day, row_id=id)
    row.portfolio_id = portfolio_id
    row.lot_id = "original-" + id
    row.notes = "Original research"
    return row


def tx(portfolio_id="p1", **kwargs):
    row = _tx(**kwargs)
    row.portfolio_id = portfolio_id
    return row


async def report(portfolios=None, holdings=None, transactions=None, quotes=None, resolve=None, currency="USD"):
    return await consolidate_portfolios(
        portfolios=portfolios if portfolios is not None else [portfolio()],
        holdings=holdings or [], transactions=transactions or [],
        quotes=quotes or {}, reporting_currency=currency,
        resolve_rate=resolve or _resolver({}), as_of=AS_OF,
    )


@pytest.mark.asyncio
async def test_native_dated_revaluation_preserves_lots_and_deduplicates_rates():
    resolver = _resolver({
        ("EUR", "USD", date(2026, 1, 1)): 1.05,
        ("EUR", "USD", date(2026, 1, 2)): 1.1,
        ("EUR", "USD", date(2026, 2, 2)): 1.2,
        ("EUR", "USD", None): 1.3,
        ("GBP", "USD", date(2026, 2, 2)): 1.4,
    })
    result = await report(
        portfolios=[portfolio(cash=1000), portfolio("p2", "EUR", 1000)],
        holdings=[holding(symbol="SAP.DE", currency="EUR"), holding("p2", "SAP.DE", 2, 100, "EUR", "h2", "2026-02-02")],
        transactions=[
            tx(type_="buy", symbol="SAP.DE", shares=1, price=100, currency="EUR", row_id="buy1"),
            tx("p2", type_="buy", symbol="SAP.DE", shares=2, price=100, currency="EUR", fees=2, fees_currency="GBP", occurred_on="2026-02-02", row_id="buy2"),
        ],
        quotes={"SAP.DE": {"current_price": 120, "currency": "EUR", "exchange": "XETRA"}}, resolve=resolver,
    )
    assert result["status"] == "complete"
    metrics = result["metrics"]
    assert metrics["market_value"]["value"] == pytest.approx(468)
    assert metrics["cost_basis"]["value"] == pytest.approx(350)
    assert metrics["unrealized_pnl"]["value"] == pytest.approx(118)
    assert metrics["cash_balance"]["value"] == pytest.approx(1697.2)
    assert metrics["net_liquidation_value"]["value"] == pytest.approx(2165.2)
    assert metrics["fees"]["value"] == pytest.approx(2.8)
    position, = result["positions"]
    assert position["shares"] == 3
    assert position["portfolio_ids"] == ["p1", "p2"]
    assert [lot["lot_id"] for lot in position["lots"]] == ["original-h1", "original-h2"]
    assert position["lots"][1]["accounting"]["cost_basis_base"] == pytest.approx(240)
    assert result["portfolios"][1]["opening_cash"]["boundary_date"] == date(2026, 1, 1)
    assert result["portfolios"][1]["opening_cash"]["native"] == {"amount": 1000, "currency": "EUR"}
    assert len(resolver.calls) == len(set(resolver.calls)) == 5
    # Asking for EUR recomputes native historical cost, not USD P&L / today's FX.
    eur = await report(holdings=[holding(symbol="SAP.DE", currency="EUR")], quotes={"SAP.DE": {"current_price": 120, "currency": "EUR", "exchange": "XETRA"}}, currency="EUR")
    assert eur["metrics"]["unrealized_pnl"]["value"] == 20
    assert 118 / 1.3 != pytest.approx(3 * 20)


@pytest.mark.asyncio
async def test_ledger_replay_does_not_mix_cost_across_accounts():
    result = await report(
        portfolios=[portfolio(cash=1000), portfolio("p2", cash=1000)],
        holdings=[holding("p2", cost=200)],
        transactions=[
            tx(type_="buy", symbol="AAPL", shares=1, price=100, currency="USD"),
            tx(type_="sell", symbol="AAPL", shares=1, price=150, currency="USD", fees=5, fees_currency="USD", occurred_on="2026-02-01", row_id="sell"),
            tx("p2", type_="buy", symbol="AAPL", shares=1, price=200, currency="USD", row_id="buy2"),
        ], quotes={"AAPL": {"current_price": 250, "currency": "USD", "exchange": "NASDAQ"}},
    )
    assert result["metrics"]["realized_pnl"]["value"] == 45
    assert result["metrics"]["cost_basis"]["value"] == 200
    assert result["metrics"]["unrealized_pnl"]["value"] == 50
    assert result["metrics"]["net_liquidation_value"]["value"] == 2095


@pytest.mark.asyncio
async def test_unknown_cost_does_not_hide_known_value_or_become_zero():
    result = await report(holdings=[holding(), holding(id="unknown", currency=None)], quotes={"AAPL": {"current_price": 120, "currency": "USD", "exchange": "NASDAQ"}})
    assert result["status"] == "partial"
    assert result["metrics"]["market_value"]["value"] == 240
    assert result["metrics"]["cost_basis"]["value"] is None
    assert result["metrics"]["cost_basis"]["known_value"] == 100
    assert result["metrics"]["unrealized_pnl"] == {"value": None, "known_value": 20, "complete_items": 1, "total_items": 2, "unit": "lot", "status": "partial"}
    assert result["positions"][0]["metrics"]["cost_basis"]["complete_items"] == 1


@pytest.mark.asyncio
async def test_missing_quote_and_fx_preserve_known_components_and_independent_metrics():
    result = await report(
        portfolios=[portfolio(cash=500), portfolio("p2", "EUR", 100)],
        holdings=[holding(), holding("p2", "SAP.DE", currency="EUR", id="h2")],
        quotes={"AAPL": {"current_price": 120, "currency": "USD", "exchange": "NASDAQ"}},
    )
    assert result["status"] == "partial"
    assert result["metrics"]["market_value"]["value"] is None
    assert result["metrics"]["market_value"]["known_value"] == 120
    assert result["metrics"]["cash_balance"]["value"] is None
    assert result["metrics"]["cash_balance"]["known_value"] == 500
    assert result["metrics"]["net_liquidation_value"]["value"] is None
    assert result["metrics"]["net_liquidation_value"]["known_value"] == 620
    assert result["metrics"]["fees"]["value"] == 0
    assert any(issue["scope"] == "opening_cash" for issue in result["portfolios"][1]["accounting"]["issues"])


@pytest.mark.asyncio
async def test_variants_and_unresolved_units_are_never_merged():
    symbols = ["BTC-USD", "BTC-EUR", "SAP", "SAP.DE", "UNKNOWN", "UNKNOWN", "PENCE"]
    result = await report(
        holdings=[holding(symbol=symbol, id=str(i)) for i, symbol in enumerate(symbols)],
        quotes={**{symbol: {"current_price": 120, "currency": "USD", "exchange": "SAME"} for symbol in symbols[:4]},
                "UNKNOWN": {"current_price": 120, "currency": "USD"},
                "PENCE": {"current_price": 120, "currency": "GBp", "exchange": "LSE"}},
    )
    assert len(result["positions"]) == 7
    unresolved = [position for position in result["positions"] if position["identity_status"] == "unresolved"]
    assert len(unresolved) == 3
    pence = next(position for position in result["positions"] if position["symbol"] == "PENCE")
    assert pence["quote_unit"] == "GBp"
    assert pence["metrics"]["market_value"]["value"] is None
    assert all(position["identity_reason"] for position in unresolved)


@pytest.mark.asyncio
@pytest.mark.parametrize("price", [None, float("nan"), float("inf"), -1, True])
async def test_bad_quotes_are_missing_not_zero(price):
    result = await report(holdings=[holding()], quotes={"AAPL": {"current_price": price, "currency": "USD"}})
    assert result["metrics"]["market_value"]["value"] is None
    assert result["metrics"]["cost_basis"]["value"] == 100


@pytest.mark.asyncio
async def test_degraded_rate_keeps_value_and_evidence():
    resolve = _resolver({("EUR", "USD", date(2026, 1, 1)): 1.1}, degraded=True)
    result = await report(portfolios=[portfolio(currency="EUR", cash=100)], resolve=resolve)
    assert result["status"] == "degraded"
    assert result["metrics"]["cash_balance"]["value"] == pytest.approx(110)
    assert result["degraded_reasons"] == ["deterministic stale rate"]
    assert result["portfolios"][0]["opening_cash"]["fx"]["degraded"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("rate", [0, -1, float("nan"), float("inf")])
async def test_invalid_fx_cannot_become_a_converted_value(rate):
    resolve = _resolver({("EUR", "USD", None): rate})
    result = await report(holdings=[holding()], quotes={"AAPL": {"current_price": 120, "currency": "EUR"}}, resolve=resolve)
    assert result["metrics"]["market_value"]["value"] is None


@pytest.mark.asyncio
async def test_empty_report_is_known_zero_without_fabricated_portfolio():
    result = await report(portfolios=[])
    assert result["status"] == "complete"
    assert result["positions"] == result["portfolios"] == []
    assert all(metric["value"] == 0 and metric["total_items"] == 0 for metric in result["metrics"].values())


@pytest.mark.asyncio
async def test_missing_historical_fx_keeps_current_value_and_shares_failure_lookup():
    resolver = _resolver({("EUR", "USD", None): 1.3})
    result = await report(
        portfolios=[portfolio(), portfolio("p2")],
        holdings=[holding(symbol="SAP.DE", currency="EUR"), holding("p2", "SAP.DE", currency="EUR", id="h2")],
        transactions=[tx(type_="buy", symbol="SAP.DE", shares=1, price=100, currency="EUR")],
        quotes={"SAP.DE": {"current_price": 120, "currency": "EUR", "exchange": "XETRA"}}, resolve=resolver,
    )
    assert result["metrics"]["market_value"]["value"] == 312
    assert result["metrics"]["cost_basis"]["value"] is None
    assert result["metrics"]["unrealized_pnl"]["value"] is None
    assert resolver.calls.count(("EUR", "USD", date(2026, 1, 2))) == 1


@pytest.mark.asyncio
async def test_opening_cash_boundary_uses_utc_recording_day():
    row = portfolio(currency="EUR", cash=100)
    row.created_at = datetime(2026, 1, 2, 0, 30, tzinfo=timezone(timedelta(hours=2)))
    resolver = _resolver({("EUR", "USD", date(2026, 1, 1)): 1.1})
    result = await report(portfolios=[row], resolve=resolver)
    assert result["portfolios"][0]["opening_cash"]["boundary_date"] == date(2026, 1, 1)
    assert result["metrics"]["cash_balance"]["value"] == pytest.approx(110)
