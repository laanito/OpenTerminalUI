"""SEC context collection is selected, bounded and independent of synthesis."""
import asyncio
from datetime import date
from types import SimpleNamespace

import pytest

from backend.api.routes import market_briefing as routes
from backend.core.sec_edgar_client import get_sec_edgar_client
from backend.services import market_briefing_context_collection as collection
from backend.services.filing_briefing_evidence import build_filing_evidence
from backend.services.market_briefing_context_evidence import BriefingContextOptions, build_context_evidence
from backend.tests.test_market_briefing_context_evidence import NOW, prices
from backend.tests.test_market_briefing_evidence import _Fetcher, _client, _row


class SEC:
    configured = True

    def __init__(self):
        self.mappings, self.fetched = [], []

    async def ticker_ciks(self, symbol):
        self.mappings.append(symbol)
        return {'AAPL': [320193], 'SPY': [884394], 'QQQ': [1067839]}.get(symbol, [])

    async def company_facts(self, cik):
        self.fetched.append(cik)
        return raw(cik)


def raw(cik=320193):
    return {'cik': cik, 'facts': {'us-gaap': {'Revenues': {'units': {'USD': [
        {'start': '2026-06-01', 'end': '2026-08-31', 'filed': filed,
         'accn': f'{cik:010d}-26-{index:06d}', 'form': '10-Q', 'val': 100}
        for index, filed in enumerate(['2026-09-02', '2026-09-15'], 1)
    ]}}}}}


async def collect(client, price=None, options=None):
    return await collection.collect_context_evidence(
        price or prices(), options or BriefingContextOptions(fundamentals=True),
        user='owner', economic_service=SimpleNamespace(), sec_client=client,
    )


@pytest.mark.asyncio
async def test_one_symbol_fetch_across_distinct_windows_with_unique_outer_references():
    client = SEC()
    price = prices(_row(), _row('QQQ', start_date='2026-09-04'))
    packet = await collect(client, price)
    assert sorted(client.mappings) == ['AAPL', 'QQQ', 'SPY']
    assert sorted(client.fetched) == [320193, 884394, 1067839]
    assert packet.schema_version == '2' and packet.price == price
    assert 'fundamentals' not in packet.always_excluded and 'sec_filing_checks' in packet.always_excluded
    first, second = packet.sections
    assert first.pair_citation_id == 'P1' and second.pair_citation_id == 'P2'
    a, b = first.assets[0], second.assets[0]
    assert a.snapshot.symbol == b.snapshot.symbol == 'AAPL'
    assert a.snapshot.matched_fact_count == 2 and b.snapshot.matched_fact_count == 1
    assert a.snapshot.filed_start == date(2026, 9, 1)
    assert b.snapshot.filed_start == date(2026, 9, 4)
    assert a.group_citations == {'F1': 'C1A1F1'} and b.group_citations == {'F1': 'C2A1F1'}
    assert a.snapshot.groups[0].citation_id == b.snapshot.groups[0].citation_id == 'F1'
    assert a.snapshot.packet_id != b.snapshot.packet_id
    a.snapshot.groups.clear()
    assert b.snapshot.groups  # Separate retained projections, no shared mutable packet.


@pytest.mark.asyncio
async def test_unselected_and_missing_price_scope_do_not_initialize_sec(monkeypatch):
    monkeypatch.setattr(collection, 'get_sec_edgar_client', lambda: pytest.fail('SEC is unrequested'))
    packet = await collect(None, options=BriefingContextOptions())
    assert packet.schema_version == '1' and packet.sections == []
    assert packet.requested.model_dump() == {'news': False, 'macro_regions': [], 'technical': False}
    price = prices(_row('FAIL', status='unavailable', reason='provider_error'))
    packet = await collect(None, price)
    assert packet.sections[0].status == 'no_price_window' and packet.sections[0].assets == []


@pytest.mark.asyncio
@pytest.mark.parametrize('mode,reason', [('config', 'configuration_required'), ('mapping', 'ambiguous_ticker'),
    ('provider', 'provider_error'), ('identity', 'invalid_response'), ('empty', None)])
async def test_failure_scopes_are_isolated_and_never_expose_exception_text(monkeypatch, caplog, mode, reason):
    client = SEC()
    if mode == 'config':
        client.configured = False
    elif mode == 'mapping':
        async def ambiguous(symbol): return [1, 2] if symbol == 'AAPL' else []
        client.ticker_ciks = ambiguous
    else:
        async def fetch(cik):
            if mode == 'provider': raise RuntimeError('secret-provider-url-and-token')
            if mode == 'identity': return raw(42)
            return {'cik': cik, 'facts': {}}
        client.company_facts = fetch
    packet = await collect(client)
    asset = packet.sections[0].assets[0]
    assert asset.reason == reason
    assert asset.status == ('empty' if mode == 'empty' else 'unavailable')
    assert 'secret-provider-url-and-token' not in caplog.text + packet.model_dump_json()
    if mode in {'config', 'mapping'}: assert client.fetched == []


@pytest.mark.asyncio
async def test_not_covered_crypto_keeps_available_anchor():
    client = SEC()
    packet = await collect(client, prices(_row('BTC-USD')))
    assert packet.sections[0].status == 'partial'
    assert packet.sections[0].assets[0].status == 'available'
    assert packet.sections[0].assets[1].reason == 'not_covered'
    assert client.fetched == [320193]


@pytest.mark.asyncio
@pytest.mark.parametrize('budget', ['SOURCE_TIMEOUT_SECONDS', 'CONTEXT_TIMEOUT_SECONDS'])
async def test_timeouts_cancel_sec_work_and_preserve_completed_asset(monkeypatch, budget):
    client, cleaned = SEC(), []
    async def slow(cik):
        if cik == 320193: return raw(cik)
        try: await asyncio.Event().wait()
        finally: cleaned.append(cik)
    client.company_facts = slow
    monkeypatch.setattr(collection, budget, .02)
    packet = await collect(client)
    assert packet.sections[0].assets[0].status == 'available'
    assert packet.sections[0].assets[1].reason == 'timed_out'
    assert cleaned == [884394]


@pytest.mark.asyncio
async def test_caller_cancellation_joins_bounded_sec_fanout():
    client = SEC()
    entered, cleaned = asyncio.Event(), []
    active = 0
    async def slow(symbol):
        nonlocal active
        active += 1
        if active == collection.MAX_CONCURRENT_SOURCES: entered.set()
        try: await asyncio.Event().wait()
        finally:
            active -= 1
            cleaned.append(symbol)
    client.ticker_ciks = slow
    task = asyncio.create_task(collect(client, prices(*[_row(s) for s in ['SPY', 'QQQ', 'BTC-USD', 'GLD', 'EEM', 'XLK']])))
    await asyncio.wait_for(entered.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    assert active == 0 and len(cleaned) == collection.MAX_CONCURRENT_SOURCES


def test_projection_rejects_unselected_foreign_pair_symbol_and_window():
    snapshot = build_filing_evidence(raw(), symbol='AAPL', cik=320193,
        start=date(2026, 9, 1), end=date(2026, 9, 30), retrieved_at=NOW)
    for key in [('P7', 'AAPL'), ('P1', 'MSFT')]:
        with pytest.raises(ValueError):
            build_context_evidence(prices(), BriefingContextOptions(fundamentals=True), prepared_at=NOW, filings={key: snapshot})
    with pytest.raises(ValueError):
        build_context_evidence(prices(), BriefingContextOptions(), prepared_at=NOW, filings={('P1', 'AAPL'): snapshot})
    with pytest.raises(ValueError):
        build_context_evidence(prices(_row(start_date='2026-09-04')), BriefingContextOptions(fundamentals=True),
                               prepared_at=NOW, filings={('P1', 'AAPL'): snapshot})


def test_evidence_endpoint_is_authenticated_and_skips_model(monkeypatch):
    client = SEC()
    async def price(*args): return prices()
    monkeypatch.setattr(routes, 'prepare_comparison_briefing_evidence', price)
    monkeypatch.setattr(routes, 'generate_context_briefing', lambda *a, **k: pytest.fail('No model on evidence route'))
    with _client(_Fetcher()) as app:
        app.app.dependency_overrides[get_sec_edgar_client] = lambda: client
        response = app.post('/api/market-context/briefing-context-evidence', json={
            'anchor': 'aapl', 'comparisons': ['spy'], 'context': {'fundamentals': True}})
    assert response.status_code == 200, response.text
    assert response.json()['schema_version'] == '2'
    assert response.json()['sections'][0]['assets'][0]['group_citations'] == {'F1': 'C1A1F1'}
    with _client(_Fetcher(), authenticated=False) as app:
        app.app.dependency_overrides[get_sec_edgar_client] = lambda: pytest.fail('Must authenticate first')
        response = app.post('/api/market-context/briefing-context-evidence', json={
            'anchor': 'AAPL', 'comparisons': ['SPY'], 'context': {'fundamentals': True}})
    assert response.status_code == 401


@pytest.mark.parametrize('path', ['/briefing-context', '/briefing-context/stream'])
def test_synthesis_rejects_fundamentals_before_fetch_or_stream_headers(monkeypatch, path):
    monkeypatch.setattr(routes, 'collect_context_evidence', lambda *a, **k: pytest.fail('Not enabled for synthesis yet'))
    with _client(_Fetcher()) as app:
        response = app.post('/api/market-context' + path, json={
            'anchor': 'AAPL', 'comparisons': ['SPY'], 'context': {'fundamentals': True}})
    assert response.status_code == 422
    assert 'evidence-only' in response.text


@pytest.mark.asyncio
async def test_internal_synthesis_also_rejects_unsupported_envelope_before_model(monkeypatch):
    from backend.services import comparison_context_briefing as synthesis
    packet = await collect(SEC())
    monkeypatch.setattr(synthesis, 'get_settings', lambda: pytest.fail('No model setup for unsupported envelope'))
    with pytest.raises(ValueError, match='evidence-only'):
        await synthesis.generate_context_briefing(packet)
