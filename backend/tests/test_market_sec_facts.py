"""SEC facts are filed evidence, not inferred revisions or archived vintages."""

from __future__ import annotations

import asyncio
from datetime import date
from types import SimpleNamespace

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes.market_sec_facts import router
from backend.auth.deps import get_current_user
from backend.core.sec_edgar_client import SecEdgarClient, get_sec_edgar_client
from backend.services.sec_filing_evidence import (
    CANDIDATE_DISPLAY_LIMIT, DISCLOSURES_PER_CANDIDATE_LIMIT, DISPLAY_LIMIT,
    disclosure_difference_candidates, filed_facts,
)


def _row(accession: str, value: float = 100.0, **changes: object) -> dict:
    return {"start": "2025-01-01", "end": "2025-03-31", "filed": "2025-05-02",
            "accn": accession, "form": "10-Q", "val": value, **changes}


def _facts(rows: list[dict]) -> dict:
    return {"cik": 320193, "facts": {"us-gaap": {"Revenues": {"units": {"USD": rows}}}}}


def test_normalization_keeps_accessions_distinct_and_rejects_unusable_rows() -> None:
    rows = [_row("0000320193-25-000001"), _row("0000320193-25-000002", 120),
            _row("0000320193-25-000001"), _row("bad"),
            _row("0000320193-25-000003", filed="2025-03-01"),
            _row("0000320193-25-000004", form="8-K"),
            _row("0000320193-25-000005", val=float("nan")),
            _row("0000320193-25-000006", filed="2024-05-02")]
    records, matched, examined = filed_facts(_facts(rows), date(2025, 1, 1), date(2025, 12, 31))
    assert (matched, examined) == (2, 8)
    assert {item["accession"] for item in records} == {"0000320193-25-000001", "0000320193-25-000002"}
    assert {item["value"] for item in records} == {100, 120}
    assert all(item["taxonomy"] == "us-gaap" and item["unit"] == "USD" for item in records)


def test_normalization_does_not_merge_concepts_and_bounds_output() -> None:
    rows = [_row(f"0000320193-25-{index:06d}", float(index)) for index in range(60)]
    payload = _facts(rows)
    payload["facts"]["us-gaap"]["RevenueFromContractWithCustomerExcludingAssessedTax"] = {
        "units": {"USD": [_row("0000320193-25-000001", 999)]}}
    payload["facts"]["custom"] = {"Revenues": {"units": {"USD": [_row("0000320193-25-000100")]}}}
    records, matched, examined = filed_facts(payload, date(2025, 1, 1), date(2025, 12, 31))
    assert (len(records), matched, examined) == (DISPLAY_LIMIT, 61, 61)
    payload["facts"]["us-gaap"]["Revenues"]["units"]["USD"] = rows[:1]
    small, matched, _ = filed_facts(payload, date(2025, 1, 1), date(2025, 12, 31))
    assert matched == 2
    assert len({item["concept"] for item in small}) == 2


def test_exact_period_differences_keep_accessions_without_inventing_revisions() -> None:
    rows = [
        _row("0000320193-25-000001", 100),
        _row("0000320193-25-000002", 100, filed="2025-08-01"),
        _row("0000320193-25-000003", 120, filed="2025-11-01", form="10-Q/A"),
        _row("0000320193-25-000003", 125, filed="2025-11-01", form="10-Q/A"),
        _row("0000320193-25-000004", 200, start="2025-04-01", end="2025-06-30", filed="2025-11-01"),
    ]
    payload = _facts(rows)
    candidates, count = disclosure_difference_candidates(payload, date(2025, 1, 1), date(2025, 12, 31))
    assert count == 1
    candidate = candidates[0]
    assert (candidate["concept"], candidate["unit"]) == ("Revenues", "USD")
    assert (candidate["period_start"], candidate["period_end"]) == (date(2025, 1, 1), date(2025, 3, 31))
    assert candidate["distinct_accession_count"] == 3
    assert candidate["distinct_value_count"] == 3
    assert candidate["within_accession_conflict"] is True
    assert [row["value"] for row in candidate["disclosures"]] == [100, 100, 120, 125]


def test_difference_candidates_use_all_matches_before_bounded_display() -> None:
    rows = [_row(f"0000320193-25-{index:06d}", index) for index in range(60)]
    candidates, count = disclosure_difference_candidates(_facts(rows), date(2025, 1, 1), date(2025, 12, 31))
    assert (count, len(candidates)) == (1, 1)
    assert candidates[0]["disclosure_count"] == 60
    assert len(candidates[0]["disclosures"]) == DISCLOSURES_PER_CANDIDATE_LIMIT
    assert CANDIDATE_DISPLAY_LIMIT == 20


def test_difference_candidate_group_cap_reports_full_count() -> None:
    rows = []
    for day in range(1, 26):
        period = date(2025, 1, day).isoformat()
        rows.extend([
            _row(f"0000320193-25-{day * 2:06d}", 1, start=period, end=period),
            _row(f"0000320193-25-{day * 2 + 1:06d}", 2, start=period, end=period),
        ])
    candidates, count = disclosure_difference_candidates(_facts(rows), date(2025, 1, 1), date(2025, 12, 31))
    assert count == 25
    assert len(candidates) == CANDIDATE_DISPLAY_LIMIT
    assert candidates[0]["period_start"] == date(2025, 1, 25)


def test_client_requires_user_agent_without_network_and_uses_exact_ticker() -> None:
    calls: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.path.endswith("company_tickers.json"):
            return httpx.Response(200, json={"0": {"ticker": "AAPL", "cik_str": 320193},
                                             "1": {"ticker": "AAP", "cik_str": 42}})
        return httpx.Response(200, json=_facts([_row("0000320193-25-000001")]))

    transport = httpx.MockTransport(respond)
    disabled = SecEdgarClient(user_agent="", transport=transport, pace_seconds=0)
    assert not disabled.configured
    try:
        asyncio.run(disabled.ticker_ciks("AAPL"))
        assert False, "expected configuration gate"
    except RuntimeError:
        pass
    assert calls == []
    client = SecEdgarClient(user_agent="OpenTerminalUI test@example.com", transport=transport, pace_seconds=0)

    async def exercise() -> None:
        assert await client.ticker_ciks("AAPL") == [320193]
        assert await client.ticker_ciks("AAP") == [42]
        assert await client.ticker_ciks("AA") == []
        assert (await client.company_facts(320193))["cik"] == 320193
        await client.company_facts(320193)

    asyncio.run(exercise())
    assert len(calls) == 2
    assert all(call.headers["User-Agent"] == "OpenTerminalUI test@example.com" for call in calls)
    assert calls[1].url.path == "/api/xbrl/companyfacts/CIK0000320193.json"


def _app(client: SecEdgarClient) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="owner")
    app.dependency_overrides[get_sec_edgar_client] = lambda: client
    return TestClient(app)


def _post(client: TestClient, symbol: str = "AAPL") -> httpx.Response:
    return client.post("/api/market-context/sec-filed-facts", json={
        "symbol": symbol, "filed_start": "2025-01-01", "filed_end": "2025-12-31"})


def test_route_statuses_and_accession_contract() -> None:
    assert _post(_app(SecEdgarClient(user_agent=""))).json()["status"] == "configuration_required"

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("company_tickers.json"):
            return httpx.Response(200, json={"0": {"ticker": "AAPL", "cik_str": 320193},
                                             "1": {"ticker": "DUPE", "cik_str": 1},
                                             "2": {"ticker": "DUPE", "cik_str": 2}})
        return httpx.Response(200, json=_facts([
            _row("0000320193-25-000001"),
            _row("0000320193-25-000002", 120, filed="2025-08-01"),
        ]))

    client = _app(SecEdgarClient(user_agent="test@example.com", transport=httpx.MockTransport(respond), pace_seconds=0))
    found = _post(client)
    assert found.status_code == 200, found.text
    assert found.json()["status"] == "available"
    assert found.json()["evidence_scope"] == "sec_current_companyfacts_accession_tagged"
    assert found.json()["facts"][0]["accession"] == "0000320193-25-000002"
    assert found.json()["difference_basis"] == "same_concept_unit_exact_period_values_not_verified_revisions"
    assert found.json()["candidate_group_count"] == 1
    assert found.json()["difference_candidates"][0]["distinct_value_count"] == 2
    assert [item["accession"] for item in found.json()["difference_candidates"][0]["disclosures"]] == [
        "0000320193-25-000001", "0000320193-25-000002",
    ]
    empty = client.post("/api/market-context/sec-filed-facts", json={
        "symbol": "AAPL", "filed_start": "2024-01-01", "filed_end": "2024-12-31"})
    assert empty.json()["status"] == "no_matching_facts"
    assert empty.json()["cik"] == 320193
    assert _post(client, "UNKNOWN").json()["status"] == "not_covered"
    assert _post(client, "DUPE").json()["status"] == "ambiguous_ticker"
    assert client.post("/api/market-context/sec-filed-facts", json={"symbol": "AAPL",
        "filed_start": "2020-01-01", "filed_end": "2025-01-01"}).status_code == 422


def test_route_reports_provider_failure_without_leaking_upstream_url() -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(503, text="secret-upstream-url"))
    response = _post(_app(SecEdgarClient(user_agent="test@example.com", transport=transport, pace_seconds=0)))
    assert response.status_code == 200
    assert response.json()["status"] == "provider_error"
    assert "secret-upstream-url" not in response.text
