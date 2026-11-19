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


def unknown_opening(**changes):
    return opening(price=None, currency=None, opening={"basis_status": "unknown", "provenance": "Transferred position; cost records pending"}, **changes)


def evidence_path(pid, payload):
    return f"/api/portfolios/{pid}/transactions/{payload['operation_id']}/opening-evidence"


def repair_payload(**changes):
    return {"repair_id": str(uuid4()), "expected_revision": 0, "price": 80, "currency": "USD",
            "opening": {"basis_status": "known", "acquisition_date": "2026-01-02", "provenance": "Recovered broker statement", "contribution_value": 1400, "contribution_currency": "USD"},
            "reason": "Recovered original records", **changes}


def test_unknown_basis_stored_null_market_cash_available_and_repair_is_audited(account):
    from backend.shared.db import SessionLocal
    from backend.models.core import PortfolioHoldingORM, PortfolioTransactionORM
    client, headers, pid = account
    payload = unknown_opening()
    assert client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload).status_code == 200
    with SessionLocal() as db:
        assert db.get(PortfolioTransactionORM, payload['operation_id']).price is None
        assert db.query(PortfolioHoldingORM).filter_by(portfolio_id=pid).one().cost_basis_per_share is None
    before = client.get(f'/api/portfolios/{pid}', headers=headers).json()
    assert before['cash_balance'] == 1000 and before['total_value'] == 1500
    assert before['total_cost'] is None and before['unrealized_pnl'] is None
    assert before['realized_pnl'] == 0  # no sale is not an unknown realized gain
    path = evidence_path(pid, payload)
    original = client.get(path, headers=headers).json()
    assert original['evidence_revision'] == 0 and original['opening']['acquisition_date'] is None
    report = client.get('/api/portfolios/report?reporting_currency=USD', headers=headers).json()
    assert report['positions'][0]['lots'][0]['opening_transaction_id'] == payload['operation_id']
    repair = repair_payload()
    result = client.patch(path, headers=headers, json=repair)
    assert result.status_code == 200, result.text
    assert client.patch(path, headers=headers, json=repair).json() == result.json()
    assert client.patch(path, headers=headers, json={**repair, 'price': 81}).status_code == 409
    assert client.patch(path, headers=headers, json=repair_payload()).status_code == 409
    after = client.get(f'/api/portfolios/{pid}', headers=headers).json()
    assert after['cash_balance'] == 1000 and after['total_value'] == 1500 and after['total_cost'] == 800
    current = client.get(path, headers=headers).json()
    assert current['shares'] == 10 and current['observed_date'] == original['observed_date']
    assert current['evidence_history'][0]['price'] is None
    assert current['evidence_history'][0]['opening'] == original['opening']
    assert current['applied_repairs'][0]['repair_id'] == repair['repair_id']
    assert 'request_hash' not in current['applied_repairs'][0]
    # An uncertain original submission retry must never revert a repaired receipt.
    assert client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload).status_code == 200
    assert client.get(path, headers=headers).json()['price'] == 80
    assert len(client.get(f'/api/portfolios/{pid}/transactions', headers=headers).json()['items']) == 1
    holding = client.get(f'/api/portfolios/{pid}/holdings', headers=headers).json()['items'][0]
    assert client.patch(f"/api/portfolios/{pid}/holdings/{holding['id']}/currency", headers=headers, json={'currency': 'EUR'}).status_code == 409
    assert client.patch(f"/api/portfolios/{pid}/transactions/{payload['operation_id']}/currency", headers=headers, json={'currency': 'EUR'}).status_code == 409


@pytest.mark.parametrize('change', [{'price': 0}, {'currency': 'USD'}, {'price': 0, 'currency': 'USD'}])
def test_unknown_basis_rejects_zero_or_currency_substitution(account, change):
    client, headers, pid = account
    payload = {**unknown_opening(), **change}
    assert client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload).status_code == 422


def test_known_zero_basis_is_distinct_from_unknown_and_old_retry_hash_survives(account):
    import hashlib
    import json
    from backend.shared.db import SessionLocal
    from backend.models.core import PortfolioTransactionORM
    client, headers, pid = account
    payload = opening(price=0)
    assert client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload).status_code == 200
    with SessionLocal() as db:
        row = db.get(PortfolioTransactionORM, payload['operation_id'])
        legacy = routes.PortfolioTransactionCreateRequest.model_validate(payload).model_dump(mode='json')
        legacy['opening'].pop('basis_status')
        row.operation_data = {**row.operation_data, 'request_hash': hashlib.sha256(json.dumps(legacy, sort_keys=True).encode()).hexdigest()}
        db.commit()
    detail = client.get(f'/api/portfolios/{pid}', headers=headers).json()
    assert detail['total_cost'] == 0 and detail['unrealized_pnl'] == 1500
    assert client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload).status_code == 200


def test_fully_sold_opening_can_be_repaired_without_recreating_holding(account):
    client, headers, pid = account
    payload = unknown_opening()
    client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload)
    sale = {"operation_id": str(uuid4()), "type": "sell", "symbol": "AAPL", "shares": 10, "price": 150, "currency": "USD", "date": "2026-11-02"}
    assert client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=sale).status_code == 200
    detail = client.get(f'/api/portfolios/{pid}', headers=headers).json()
    assert detail['realized_pnl'] is None and detail['cash_balance'] == 2500
    assert client.patch(evidence_path(pid, payload), headers=headers, json=repair_payload()).status_code == 200
    detail = client.get(f'/api/portfolios/{pid}', headers=headers).json()
    assert detail['realized_pnl'] == 700 and detail['cash_balance'] == 2500
    assert client.get(f'/api/portfolios/{pid}/holdings', headers=headers).json()['items'] == []


def test_opening_repair_owner_scope_nonopening_and_readonly_economics(account):
    client, headers, pid = account
    payload = opening()
    client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload)
    other = _auth_headers(client)
    path = evidence_path(pid, payload)
    for method in ['get', 'patch']:
        kwargs = {'json': repair_payload()} if method == 'patch' else {}
        assert getattr(client, method)(path, headers=other, **kwargs).status_code == 404
    assert client.patch(path, headers=headers, json=repair_payload(shares=99)).status_code == 422
    assert client.patch(path, headers=headers, json=repair_payload(opening={'basis_status': 'known', 'acquisition_date': '2026-11-02', 'provenance': 'Future acquisition'})).status_code == 422
    buy = {"operation_id": str(uuid4()), "type": "buy", "symbol": "AAPL", "shares": 1, "price": 100, "currency": "USD", "date": "2026-11-02"}
    client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=buy)
    path = evidence_path(pid, buy)
    assert client.get(path, headers=headers).status_code == 404
    assert client.patch(path, headers=headers, json=repair_payload()).status_code == 404


def test_concurrent_repairs_use_revision_and_retry_identity(account):
    from concurrent.futures import ThreadPoolExecutor
    client, headers, pid = account
    payload = unknown_opening()
    client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload)
    path = evidence_path(pid, payload)
    same = repair_payload()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: client.patch(path, headers=headers, json=same), range(2)))
    assert [result.status_code for result in results] == [200, 200]
    assert len(client.get(path, headers=headers).json()['evidence_history']) == 1
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: client.patch(path, headers=headers, json=repair_payload(expected_revision=1)), range(2)))
    assert sorted(result.status_code for result in results) == [200, 409]
    # Replaying an earlier success returns its original revision, without undoing later repairs.
    assert client.patch(path, headers=headers, json=same).json()['evidence_revision'] == 1
    assert client.get(path, headers=headers).json()['evidence_revision'] == 2


def test_mixed_lot_basis_is_not_overwritten_but_entry_valuation_can_be_repaired(account):
    client, headers, pid = account
    payload = opening(lot_id='shared')
    client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload)
    buy = {"type": "buy", "symbol": "AAPL", "shares": 1, "price": 120, "currency": "USD", "date": "2026-11-02", "lot_id": "shared"}
    assert client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=buy).status_code == 200
    path = evidence_path(pid, payload)
    assert client.patch(path, headers=headers, json=repair_payload()).status_code == 409
    contribution = repair_payload(price=100)
    contribution['opening']['contribution_value'] = 1500
    assert client.patch(path, headers=headers, json=contribution).status_code == 200
    holding = client.get(f'/api/portfolios/{pid}/holdings', headers=headers).json()['items'][0]
    assert holding['shares'] == 11 and holding['cost_basis_per_share'] == pytest.approx(1120 / 11)
    assert client.get(path, headers=headers).json()['opening']['contribution_value'] == 1500


def test_unknown_basis_exports_and_compatibility_cost_consumers_do_not_invent_zero(account):
    from backend.models.core import PortfolioHoldingORM
    from backend.reports.generator import rows_for_data_type
    from backend.services.legacy_holdings import manager_holdings_as_legacy, require_documented_cost
    from backend.shared.db import SessionLocal
    from fastapi import HTTPException
    client, headers, pid = account
    client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=unknown_opening())
    with SessionLocal() as db:
        row = db.query(PortfolioHoldingORM).filter_by(portfolio_id=pid).one()
        # Preserve shares/symbols for price-only consumers; cost-weighted adapters explicitly reject.
        adapted = manager_holdings_as_legacy([row])
        assert adapted[0].quantity == 10 and adapted[0].ticker == 'AAPL' and adapted[0].avg_buy_price is None
        with pytest.raises(HTTPException) as unavailable:
            require_documented_cost(adapted)
        assert unavailable.value.status_code == 503
        owner = db.get(routes.PortfolioORM, pid).user_id
        exported = rows_for_data_type(db, 'positions', owner)
        assert exported[0]['avg_buy_price'] is None and exported[0]['cost_basis_currency'] is None


def test_identical_lot_ids_on_different_symbols_keep_their_own_opening_links(account):
    client, headers, pid = account
    first, second = opening(lot_id='external'), opening(symbol='MSFT', lot_id='external')
    for payload in [first, second]:
        assert client.post(f'/api/portfolios/{pid}/transactions', headers=headers, json=payload).status_code == 200
    report = client.get('/api/portfolios/report?reporting_currency=USD', headers=headers).json()
    links = {row['symbol']: row['lots'][0]['opening_transaction_id'] for row in report['positions']}
    assert links == {'AAPL': first['operation_id'], 'MSFT': second['operation_id']}
