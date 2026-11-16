from __future__ import annotations

import asyncio
import json
from datetime import date, datetime, timezone
from types import SimpleNamespace as NS
from uuid import uuid4

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.api.routes.portfolios import PortfolioHistoryResponse
from backend.main import app
from backend.services import portfolio_history as history
from backend.services.portfolio_accounting import calculate_portfolio_accounting

END = date(2026, 11, 16)


def tx(kind, day, symbol="", shares=0, price=0, currency="USD", fees=0, fees_currency=None):
    return NS(id=str(uuid4()), type=kind, date=day, symbol=symbol, shares=shares, price=price,
              currency=currency, fees=fees, fees_currency=fees_currency, created_at=day)


def portfolio(cash=1000):
    return NS(id="p", currency="USD", benchmark_symbol="S&P500", starting_cash=cash,
              created_at=datetime(2026, 1, 1, tzinfo=timezone.utc))


@pytest.fixture
def market(monkeypatch):
    fetched = []

    async def quote(symbol):
        return {"currency": "EUR" if symbol == "EUR.ST" else "USD"}

    async def prices(symbol, **kwargs):
        fetched.append(symbol)
        dates = pd.date_range("2026-10-15", END, tz="UTC")
        values = [120 if day.date() >= date(2026, 11, 10) else 100 for day in dates]
        if symbol == "B": values = [50] * len(dates)
        if symbol == "^GSPC":
            dates = dates[dates.weekday < 5]
            values = [200] * len(dates)
        return pd.Series(values, index=dates, dtype=float)

    async def rate(source, target, requested_date=None):
        value = {"USD": 1, "EUR": 2, "GBP": 3}.get(source)
        if value is None: raise ValueError("FX unavailable")
        return {"rate": value, "rate_at": requested_date, "requested_date": requested_date,
                "source_symbol": source + target, "degraded": False}

    async def rates(source, target, dates):
        return {day.isoformat(): await rate(source, target, day) for day in dates}

    monkeypatch.setattr(history, "fetch_stock_snapshot_coalesced", quote)
    monkeypatch.setattr(history.portfolio_analytics_service, "_close_series", prices)
    monkeypatch.setattr(history.forex_service, "get_valuation_rate", rate)
    monkeypatch.setattr(history.forex_service, "get_historical_valuation_rates", rates)
    return fetched


def run(rows, holdings, cash=1000):
    return asyncio.run(history.reconstruct_portfolio_history(portfolio(cash), holdings, rows, today=END))


def test_replays_thirty_days_without_resetting_for_latest_purchase(market):
    rows = [tx("buy", "2026-10-01", "A", 2, 100), tx("sell", "2026-11-10", "A", 1, 120),
            tx("deposit", "2026-11-12", price=500), tx("buy", "2026-11-15", "B", 1, 50),
            tx("dividend", "2026-11-16", "A", price=10, fees=1, fees_currency="USD")]
    holdings = [NS(symbol="A", shares=1), NS(symbol="B", shares=1)]
    result = run(rows, holdings)
    curve = {point["date"]: point for point in result["equity_curve"]}
    assert len(curve) == 30
    assert list(curve)[0] == "2026-10-18"
    assert curve["2026-11-10"]["net_liquidation_value"] == 1040
    assert curve["2026-11-12"]["net_liquidation_value"] == 1540
    assert curve["2026-11-12"]["portfolio"] == pytest.approx(104)
    assert curve["2026-11-15"]["holdings_value"] == 170
    assert curve["2026-11-15"]["portfolio"] == pytest.approx(104)
    assert curve["2026-11-15"]["benchmark_as_of"] == "2026-11-13"
    assert curve["2026-11-16"]["net_liquidation_value"] == 1549
    assert curve["2026-11-16"]["portfolio"] == pytest.approx(104 * 1549 / 1540)
    assert result["status"] == "degraded"
    validated = PortfolioHistoryResponse.model_validate(result)
    json.dumps(validated.model_dump(mode="json"), allow_nan=False)
    accounting = asyncio.run(calculate_portfolio_accounting(
        base_currency="USD", starting_cash=1000, holdings=[NS(symbol="A", shares=1), NS(symbol="B", shares=1)],
        transactions=rows, quotes={"A": {"current_price": 120, "currency": "USD"}, "B": {"current_price": 50, "currency": "USD"}},
        resolve_rate=history.forex_service.get_valuation_rate,
    ))
    assert curve["2026-11-16"]["net_liquidation_value"] == accounting["totals"]["net_liquidation_value"]


def test_closed_positions_withdrawals_and_separate_fee_currency(market):
    rows = [tx("buy", "2026-10-01", "EUR.ST", 2, 100, "EUR", 1, "GBP"),
            tx("sell", "2026-11-10", "EUR.ST", 2, 120, "EUR"),
            tx("withdrawal", "2026-11-11", price=100)]
    curve = run(rows, [])["equity_curve"]
    assert curve[0]["cash_balance"] == 597
    assert curve[0]["holdings_value"] == 400
    assert curve[-1]["cash_balance"] == 977
    assert curve[-1]["holdings_value"] == 0
    assert curve[-1]["net_liquidation_value"] == 977
    assert curve[-1]["portfolio"] == pytest.approx(1077 / 997 * 100)
    assert "EUR.ST" in market


@pytest.mark.parametrize("rows,holdings,code", [
    ([tx("buy", "2026-10-01", "A", 2, 100)], [NS(symbol="A", shares=3)], "ledger_holdings_mismatch"),
    ([tx("sell", "2026-11-01", "A", 1, 100)], [], "ledger_position_negative"),
    ([tx("deposit", "invalid", price=100)], [], "ledger_date_or_value_invalid"),
    ([tx("deposit", "2026-10-01", price=float("nan"))], [], "ledger_date_or_value_invalid"),
    ([tx("deposit", "2026-10-01", price=100, currency=None)], [], "ledger_fx_or_currency_unavailable"),
])
def test_gaps_fail_explicitly_without_writes_or_partial_curves(market, rows, holdings, code):
    result = run(rows, holdings)
    assert result["status"] == "partial"
    assert result["equity_curve"] == []
    assert result["issues"][0]["code"] == code


def test_zero_and_negative_nav_remain_values_without_invented_return_index(market):
    result = run([tx("buy", "2026-11-01", "A", 2, 100)], [NS(symbol="A", shares=2)], cash=0)
    assert len(result["equity_curve"]) == 30
    assert result["equity_curve"][-1]["cash_balance"] == -200
    assert any("Negative ledger cash" in reason for reason in result["degraded_reasons"])
    assert result["equity_curve"][0]["portfolio"] is None


@pytest.mark.parametrize("source", ["future", "empty", "error"])
def test_missing_benchmark_does_not_hide_nav_or_use_future_close(market, monkeypatch, source):
    original = history.portfolio_analytics_service._close_series
    async def prices(symbol, **kwargs):
        if symbol == "^GSPC":
            if source == "error":
                raise RuntimeError("Provider unavailable")
            if source == "empty":
                return pd.Series(dtype="float64")
            return pd.Series([200.0], index=pd.DatetimeIndex(["2026-11-17"], tz="UTC"))
        return await original(symbol, **kwargs)
    monkeypatch.setattr(history.portfolio_analytics_service, "_close_series", prices)
    result = run([], [])
    assert len(result["equity_curve"]) == 30
    assert all(point["benchmark"] is None for point in result["equity_curve"])
    assert all(point["net_liquidation_value"] == 1000 for point in result["equity_curve"])


def test_missing_security_prices_never_use_future_or_stale_close(market, monkeypatch):
    async def prices(symbol, **kwargs):
        return pd.Series([100.0], index=pd.DatetimeIndex(["2026-09-01"], tz="UTC"))
    monkeypatch.setattr(history.portfolio_analytics_service, "_close_series", prices)
    result = run([tx("buy", "2026-10-01", "A", 1, 100)], [NS(symbol="A", shares=1)])
    assert result["status"] == "partial"
    assert result["issues"][0]["code"] == "ledger_price_or_fx_unavailable"


def test_authenticated_primary_history_is_owner_scoped(market):
    client = TestClient(app)
    def login():
        email, password = f"history-{uuid4().hex}@example.com", "history-test-123456"
        client.post("/api/auth/register", json={"email": email, "password": password})
        token = client.post("/api/auth/login", json={"email": email, "password": password}).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}
    headers = login()
    assert client.get("/api/portfolios/primary/analytics/history", headers=headers).status_code == 404
    pid = client.post("/api/portfolios", headers=headers, json={"name": "History", "starting_cash": 500}).json()["id"]
    url = f"/api/portfolios/{pid}/analytics/history"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=login()).status_code == 404
    assert market == []
    response = client.get("/api/portfolios/primary/analytics/history", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["portfolio_id"] == pid
    assert response.json()["methodology"] == history.METHOD


def test_daily_fx_moves_nav_even_when_native_close_is_carried(market, monkeypatch):
    async def rates(source, target, dates):
        return {day.isoformat(): {"rate": (2.1 if day >= date(2026, 11, 15) else 2) if source == "EUR" else 1,
                                 "rate_at": day, "requested_date": day, "degraded": False} for day in dates}
    original = history.portfolio_analytics_service._close_series
    async def prices(symbol, **kwargs):
        result = await original(symbol, **kwargs)
        return result.loc[result.index.weekday < 5]
    monkeypatch.setattr(history.forex_service, "get_historical_valuation_rates", rates)
    monkeypatch.setattr(history.portfolio_analytics_service, "_close_series", prices)
    result = run([tx("buy", "2026-10-01", "EUR.ST", 1, 100, "EUR")], [NS(symbol="EUR.ST", shares=1)])
    curve = {point["date"]: point for point in result["equity_curve"]}
    assert curve["2026-11-14"]["holdings_value"] == 240
    assert curve["2026-11-15"]["holdings_value"] == 252
    assert curve["2026-11-15"]["price_dates"]["EUR.ST"] == "2026-11-13"


def test_closed_before_window_symbols_need_no_prices_and_future_trades_are_excluded(market):
    result = run([tx("buy", "2026-09-01", "OLD", 1, 100), tx("sell", "2026-09-02", "OLD", 1, 110),
                  tx("buy", "2026-11-17", "FUTURE", 1, 100)], [])
    assert len(result["equity_curve"]) == 30
    assert result["equity_curve"][0]["cash_balance"] == 1010
    assert "OLD" not in market and "FUTURE" not in market


def test_new_portfolio_does_not_invent_days_before_its_creation(market):
    p = portfolio()
    p.created_at = datetime(2026, 11, 15, tzinfo=timezone.utc)
    result = asyncio.run(history.reconstruct_portfolio_history(p, [], [], today=END))
    assert [point["date"] for point in result["equity_curve"]] == ["2026-11-15", "2026-11-16"]


def test_security_missing_quote_currency_does_not_assume_reporting_currency(market, monkeypatch):
    async def quote(symbol):
        return {}
    monkeypatch.setattr(history, "fetch_stock_snapshot_coalesced", quote)
    result = run([tx("buy", "2026-10-01", "A", 1, 100)], [NS(symbol="A", shares=1)])
    assert result["status"] == "partial"
    assert result["issues"][0]["code"] == "ledger_price_or_fx_unavailable"


def test_legacy_unmatched_sale_is_excluded_with_its_proceeds_and_fees(market):
    orphan = tx("sell", "2026-07-27", "BTC-USD", 2, 60000, currency=None, fees=150, fees_currency=None)
    buy = tx("buy", "2026-10-01", "A", 1, 100)
    result = run([orphan, buy], [NS(symbol="A", shares=1)])
    control = run([buy], [NS(symbol="A", shares=1)])
    assert result["status"] == "degraded"
    assert result["equity_curve"] == control["equity_curve"]
    assert result["equity_curve"][-1]["cash_balance"] == 900
    assert result["excluded_transactions"] == [{"id": orphan.id, "symbol": "BTC-USD", "date": "2026-07-27", "shares": 2, "reason": "legacy_unmatched_sale"}]
    assert any("cash can differ" in reason for reason in result["degraded_reasons"])
    assert "BTC-USD" not in market
    assert orphan.shares == 2 and orphan.fees == 150
    PortfolioHistoryResponse.model_validate(result)


def test_legacy_exclusion_retains_matched_sales_and_discloses_opening_adjustment(market):
    rows = [tx("sell", "2026-07-27", "A", 1, 100), tx("buy", "2026-09-01", "A", 2, 100),
            tx("sell", "2026-10-01", "A", 1, 110)]
    result = run(rows, [NS(symbol="A", shares=1)])
    assert len(result["excluded_transactions"]) == 1
    assert result["equity_curve"][-1]["cash_balance"] == 910
    assert result["equity_curve"][-1]["holdings_value"] == 120
    mismatch = run(rows, [NS(symbol="A", shares=2)])
    assert mismatch["status"] == "degraded"
    assert mismatch["opening_position_adjustments"][0]["quantity_delta"] == 1
    assert mismatch["equity_curve"][-1]["holdings_value"] == 240


def test_unmatched_sale_on_window_boundary_is_not_ignored(market):
    result = run([tx("sell", "2026-10-18", "A", 1, 100)], [])
    assert result["status"] == "partial"
    assert result["excluded_transactions"] == []


@pytest.mark.parametrize("current_quantity,delta", [(3, 2), (0.5, -0.5)])
def test_legacy_opening_balance_anchors_current_holdings_and_preserves_window_trades(market, current_quantity, delta):
    rows = [tx("sell", "2026-07-01", "A", 1, 100), tx("buy", "2026-09-01", "A", 2, 100),
            tx("sell", "2026-11-10", "A", 1, 120)]
    result = run(rows, [NS(symbol="A", shares=current_quantity)])
    assert result["status"] == "degraded"
    assert len(result["equity_curve"]) == 30
    adjustment = result["opening_position_adjustments"][0]
    assert adjustment["ledger_quantity"] == 2
    assert adjustment["quantity_delta"] == delta
    assert adjustment["opening_quantity"] == current_quantity + 1
    assert result["equity_curve"][0]["holdings_value"] == (current_quantity + 1) * 100
    assert result["equity_curve"][-1]["holdings_value"] == current_quantity * 120
    assert result["equity_curve"][-1]["cash_balance"] == 920
    assert result["equity_curve"][-1]["external_flow"] == 0
    PortfolioHistoryResponse.model_validate(result)


def test_old_imported_holding_without_a_buy_can_seed_the_opening_inventory(market):
    holding = NS(symbol="A", shares=1, purchase_date="2026-01-01")
    result = run([], [holding])
    assert len(result["equity_curve"]) == 30
    assert result["equity_curve"][0]["holdings_value"] == 100
    assert result["equity_curve"][-1]["holdings_value"] == 120
    assert result["equity_curve"][-1]["cash_balance"] == 1000
    assert result["opening_position_adjustments"][0]["opening_quantity"] == 1
    assert holding.shares == 1


def test_legacy_opening_balance_supports_recorded_in_window_sale_of_imported_shares(market):
    rows = [tx("sell", "2026-07-01", "A", 1, 100), tx("sell", "2026-11-10", "A", 1, 120)]
    result = run(rows, [NS(symbol="A", shares=1)])
    assert len(result["excluded_transactions"]) == 1
    assert result["opening_position_adjustments"][0]["opening_quantity"] == 2
    assert result["equity_curve"][0]["holdings_value"] == 200
    assert result["equity_curve"][-1]["cash_balance"] == 1120
    assert result["equity_curve"][-1]["holdings_value"] == 120


def test_legacy_anchor_cannot_invent_a_negative_opening_balance_or_hide_a_recent_oversell(market):
    rows = [tx("sell", "2026-07-01", "A", 1, 100), tx("buy", "2026-11-10", "A", 2, 100)]
    result = run(rows, [NS(symbol="A", shares=1)])
    assert result["status"] == "partial"
    assert result["issues"][0]["code"] == "ledger_holdings_mismatch"
    rows = [tx("sell", "2026-07-01", "A", 1, 100), tx("sell", "2026-11-01", "A", 2, 100),
            tx("buy", "2026-11-10", "A", 2, 100)]
    result = run(rows, [])
    assert result["status"] == "partial"
    assert result["issues"][0]["code"] == "ledger_position_negative"


def test_multiple_legacy_symbols_with_unrecorded_adds_and_removals_keep_thirty_days(market):
    rows = [tx("sell", "2026-07-01", symbol, 1, 100, currency=None)
            for symbol in ["A", "A", "A", "A", "B", "B", "C", "C"]]
    rows += [tx("buy", "2026-09-01", "A", 2, 100), tx("buy", "2026-09-01", "B", 3, 50),
             tx("buy", "2026-09-01", "C", 4, 100), tx("sell", "2026-11-10", "A", 1, 120),
             tx("buy", "2026-11-15", "A", 0.5, 120)]
    result = run(rows, [NS(symbol="A", shares=3), NS(symbol="B", shares=1)])
    assert len(result["equity_curve"]) == 30
    assert len(result["excluded_transactions"]) == 8
    adjustments = {row["symbol"]: row for row in result["opening_position_adjustments"]}
    assert adjustments["A"]["opening_quantity"] == 3.5
    assert adjustments["B"]["opening_quantity"] == 1
    assert adjustments["C"]["opening_quantity"] == 0
    assert result["equity_curve"][-1]["holdings_value"] == 410
    assert result["equity_curve"][-1]["cash_balance"] == 310
    assert "C" not in market
