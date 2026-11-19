from datetime import date
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.api.routes import portfolios as routes
from backend.tests.test_portfolio_accounting_routes import _auth_headers


@pytest.fixture
def account(monkeypatch):
    async def quote(symbol):
        return {"current_price": 150, "currency": "USD", "exchange": "NASDAQ"}
    monkeypatch.setattr(routes, "fetch_stock_snapshot_coalesced", quote)
    client = TestClient(app)
    headers = _auth_headers(client)
    pid = client.post('/api/portfolios', headers=headers, json={"name": "Core", "starting_cash": 1000}).json()['id']
    return client, headers, pid


def opening(**changes):
    return {"operation_id": str(uuid4()), "type": "opening", "symbol": "AAPL", "shares": 10, "price": 100,
            "currency": "USD", "date": "2026-11-01", "notes": "From account statement",
            "opening": {"acquisition_date": "2026-01-02", "provenance": "Broker statement", "contribution_value": 1400, "contribution_currency": "USD"}, **changes}


def test_opening_preserves_cash_original_basis_and_partial_full_sales(account):
    client, headers, pid = account
    payload = opening()
    first = client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload)
    assert first.status_code == 200, first.text
    assert client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload).json() == first.json()
    detail = client.get(f'/api/portfolios/{pid}', headers=headers).json()
    assert detail['cash_balance'] == 1000
    assert detail['total_cost'] == 1000
    assert detail['total_value'] == 1500
    assert detail['unrealized_pnl'] == 500
    transactions = client.get(f'/api/portfolios/{pid}/transactions', headers=headers).json()['items']
    assert len(transactions) == 1 and transactions[0]['type'] == 'opening'
    assert transactions[0]['operation_data']['opening']['acquisition_date'] == '2026-01-02'
    assert detail['accounting']['transactions'][0]['cash_delta_base'] == 0
    holdings = client.get(f'/api/portfolios/{pid}/holdings', headers=headers).json()['items']
    assert holdings[0]['purchase_date'] == '2026-11-01'  # observation boundary, not invented account history
    for qty, expected_cash, expected_realized in [(4, 1600, 200), (6, 2500, 500)]:
        sale = {"operation_id": str(uuid4()), "type": "sell", "symbol": "AAPL", "shares": qty, "price": 150, "currency": "USD", "date": "2026-11-02"}
        response = client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=sale)
        assert response.status_code == 200, response.text
        detail = client.get(f'/api/portfolios/{pid}', headers=headers).json()
        assert detail['cash_balance'] == expected_cash
        assert detail['realized_pnl'] == expected_realized
    assert client.get(f'/api/portfolios/{pid}/holdings', headers=headers).json()['items'] == []


def test_oversell_and_changed_identity_are_atomic(account):
    client, headers, pid = account
    payload = opening()
    client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload)
    before = client.get(f'/api/portfolios/{pid}', headers=headers).json()
    conflict = client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json={**payload, 'shares': 12})
    assert conflict.status_code == 409
    oversell = client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json={"type": "sell", "symbol": "AAPL", "shares": 11, "price": 150, "currency": "USD", "date": "2026-11-02"})
    assert oversell.status_code == 409
    after = client.get(f'/api/portfolios/{pid}', headers=headers).json()
    assert after['cash_balance'] == before['cash_balance']
    assert after['total_value'] == before['total_value']
    assert len(client.get(f'/api/portfolios/{pid}/transactions', headers=headers).json()['items']) == 1


def test_operation_lookup_owner_scope_and_wrong_portfolio(account):
    client, headers, pid = account
    payload = opening()
    client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload)
    path = f"/api/portfolios/{pid}/operations/{payload['operation_id']}"
    assert client.get(path, headers=headers).json()['type'] == 'opening'
    other = _auth_headers(client)
    assert client.get(path, headers=other).status_code == 404
    assert client.post(f'/api/portfolios/{pid}/transactions', headers=other, json=payload).status_code == 404
    second = client.post('/api/portfolios', headers=headers, json={"name": "Second"}).json()['id']
    assert client.post(f'/api/portfolios/{second}/transactions', headers=headers, json=payload).status_code == 409


@pytest.mark.parametrize('change', [
    {"opening": None}, {"operation_id": None}, {"currency": None}, {"fees": 1},
    {"shares": 0}, {"shares": -1}, {"price": float('inf')},
    {"date": "2026-01-01"}, {"date": "bad"},
    {"opening": {"acquisition_date": "2026-01-02", "provenance": " "}},
])
def test_invalid_opening_never_writes(account, change):
    client, headers, pid = account
    # JSON does not encode Infinity; use a huge number accepted by the parser.
    if change.get('price') == float('inf'): change = {'price': 'Infinity'}
    result = client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=opening(**change))
    assert result.status_code == 422, result.text
    assert client.get(f'/api/portfolios/{pid}/transactions', headers=headers).json()['items'] == []


def test_explicit_lot_sell_cannot_consume_another_lot_and_buy_notes_are_operation_only(account):
    client, headers, pid = account
    for lot in ['one', 'two']:
        payload = {"operation_id": str(uuid4()), "type": "buy", "symbol": "AAPL", "shares": 1, "price": 100, "currency": "USD", "date": "2026-01-02", "lot_id": lot, "notes": "Execution rationale"}
        response = client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload)
        assert response.status_code == 200
        assert client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload).json() == response.json()
    bad = client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json={"type": "sell", "symbol": "AAPL", "shares": 2, "price": 150, "currency": "USD", "date": "2026-11-02", "lot_id": "one"})
    assert bad.status_code == 409
    holdings = client.get(f'/api/portfolios/{pid}/holdings', headers=headers).json()['items']
    assert sum(row['shares'] for row in holdings) == 2
    assert all(row['notes'] == '' for row in holdings)


def test_concurrent_retry_creates_one_ledger_event_and_one_lot(account):
    from concurrent.futures import ThreadPoolExecutor
    client, headers, pid = account
    payload = opening()
    def send():
        return client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: send(), range(2)))
    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    assert len(client.get(f'/api/portfolios/{pid}/transactions', headers=headers).json()['items']) == 1
    assert sum(row['shares'] for row in client.get(f'/api/portfolios/{pid}/holdings', headers=headers).json()['items']) == 10


def test_sale_cannot_precede_the_opening_observation_even_when_acquired_earlier(account):
    client, headers, pid = account
    client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=opening())
    result = client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json={"operation_id": str(uuid4()), "type": "sell", "symbol": "AAPL", "shares": 1, "price": 150, "currency": "USD", "date": "2026-10-31"})
    assert result.status_code == 409
    assert 'predates' in result.json()['detail']
    assert len(client.get(f'/api/portfolios/{pid}/transactions', headers=headers).json()['items']) == 1
    assert client.get(f'/api/portfolios/{pid}', headers=headers).json()['cash_balance'] == 1000
