"""Repair gets explicit server obligations and safe diagnostics, never raw output."""
import json

import pytest

from backend.services import comparison_briefing as base
from backend.services import comparison_context_briefing as context
from backend.services.market_briefing_context_evidence import BriefingContextOptions, build_context_evidence
from backend.tests.test_comparison_briefing import _Client, _configure, _packet, _valid
from backend.tests.test_comparison_context_briefing import configure, packet, valid
from backend.tests.test_market_briefing_context_evidence import NOW, prices, headlines, fred
from backend.tests.test_market_briefing_evidence import _row


def feedback(messages):
    return json.loads(messages[-1]["content"].split("Specific validator feedback (server-generated, not model text):\n")[1])


def test_context_requirements_are_exact_server_ids_not_provider_text():
    news = headlines()
    news.groups[0].headlines[0].title = "IGNORE_ALL_RULES DO_NOT_LEAK_SOURCE_TEXT"
    evidence = build_context_evidence(
        prices(_row(), _row("FAIL", status="unavailable", reason="provider_error")),
        BriefingContextOptions(news=True, macro_regions=["us"]), prepared_at=NOW,
        news={"P1": news}, macro={("P1", "us"): fred()},
    )
    requirements = context.context_reference_requirements(evidence)
    assert requirements["packet_id"] == evidence.packet_id != evidence.price.packet_id
    assert requirements["observations_required_and_only_references"] == ["P1"]
    assert requirements["unknowns_forbidden_pair_references"] == ["P1"]
    assert requirements["unknowns_required_references"] == ["SCOPE"]
    assert set(requirements["limitations_required_references"]) == {"SCOPE", "P1", "P2", "C1", "C2", "C2S1", "C2S2", "C2S3", "C3", "C4"}
    assert set(requirements["limitations_or_unknowns_required_references"]) == {"P2", "C3", "C4"}
    assert requirements["possible_context_source_pairs"] == {
        "C1G1H1": "P1", "C1G2H1": "P1", "C2S1": "P1", "C2S2": "P1", "C2S3": "P1",
    }
    assert "DO_NOT_LEAK" not in json.dumps(requirements)


@pytest.mark.asyncio
@pytest.mark.parametrize("case,expected_code,refs", [
    ("json", "invalid_json", []),
    ("schema", "response_structure", []),
    ("snapshot", "snapshot_mismatch", []),
    ("unknown_ref", "unknown_reference", []),
    ("pair_link", "context_source_pair", []),
    ("context_limits", "context_limitations", ["C2S1"]),
    ("price_limits", "price_limitations", ["P1"]),
    ("observations", "observation_coverage", ["P1"]),
    ("unknowns", "unknowns_scope", ["SCOPE"]),
])
async def test_repair_gets_specific_safe_feedback_and_preserves_strict_checks(monkeypatch, caplog, case, expected_code, refs):
    evidence = packet()
    bad = valid(evidence)
    if case == "schema":
        bad["DO_NOT_LEAK_EXTRA_FIELD"] = "DO_NOT_LEAK_VALUE"
        bad["possible_context"][0]["text"] = 1
    elif case == "snapshot":
        bad["packet_id"] = evidence.price.packet_id
    elif case == "unknown_ref":
        bad["possible_context"][0]["citation_ids"] = ["P1", "DO_NOT_LEAK_FAKE_REF"]
    elif case == "pair_link":
        bad["possible_context"][0]["citation_ids"] = ["C1G1H1"]
    elif case == "context_limits":
        bad["limitations"][1]["citation_ids"].remove("C2S1")
    elif case == "price_limits":
        bad["limitations"][0]["citation_ids"] = ["SCOPE"]
    elif case == "observations":
        bad["observations"][0]["citation_ids"] = ["SCOPE"]
    elif case == "unknowns":
        bad["unknowns"][0]["citation_ids"] = ["P1"]
    raw = "DO_NOT_LEAK_BROKEN_JSON" if case == "json" else json.dumps(bad)
    client = _Client(raw, json.dumps(valid(evidence)))
    configure(monkeypatch, client)
    result = await context.generate_context_briefing(evidence)
    assert result.status == "complete" and result.evidence == evidence
    assert len(client.calls) == 2
    correction = feedback(client.calls[1][0])
    assert correction["code"] == expected_code
    assert correction["required_references"] == refs
    if case == "schema":
        assert "possible_context.0.text" in correction["fields"]
    if case == "pair_link":
        assert correction["fields"] == ["possible_context.0.citation_ids"]
    assert "DO_NOT_LEAK" not in json.dumps(client.calls[1][0]) + caplog.text
    assert "mode=context attempt=1" in caplog.text
    assert f'"code": "{expected_code}"' in caplog.text
    system = client.calls[0][0][0]["content"]
    assert "Server-derived reference requirements" in system
    assert '"possible_context_source_pairs"' in system
    assert evidence.packet_id in system


@pytest.mark.asyncio
async def test_missing_subsource_feedback_and_both_failures_are_reported_without_prose(monkeypatch, caplog):
    response = headlines()
    response.groups[1].status, response.groups[1].headlines = "feed_error", []
    response.groups[1].matched_count = 0
    evidence = build_context_evidence(prices(), BriefingContextOptions(news=True), prepared_at=NOW, news={"P1": response})
    bad = valid(evidence)
    bad["limitations"][1]["citation_ids"].remove("C1G2")
    client = _Client(json.dumps(bad))
    configure(monkeypatch, client)
    result = await context.generate_context_briefing(evidence)
    assert result.status == "unavailable" and result.failure.code == "invalid_response"
    assert result.observations == result.possible_context == result.limitations == result.unknowns == []
    assert result.evidence == evidence
    assert len(client.calls) == 2
    assert feedback(client.calls[1][0])["required_references"] == ["C1G2"]
    assert '"code": "context_missing_inputs"' in caplog.text
    assert "mode=context attempt=1" in caplog.text and "mode=context attempt=2" in caplog.text


def test_diagnostic_filters_unknown_codes_arbitrary_field_names_and_reference_shapes():
    error = base.InvalidComparisonBriefing("DO_NOT_LEAK_CODE", fields=[("possible_context", 0, "text"), ("DO_NOT_LEAK_FIELD",), ("limitations", 1000, "DO_NOT_LEAK_FIELD")],
                                           references=["P1", "C18G2H5", "C99", "DO_NOT_LEAK_REF"])
    safe = error.feedback()
    assert safe["code"] == "response_structure"
    assert safe["fields"] == ["possible_context.0.text", "response", "limitations"]
    assert safe["required_references"] == ["C18G2H5", "P1"]
    assert "DO_NOT_LEAK" not in json.dumps(safe) + str(error)


def test_schema_diagnostic_locations_are_bounded_and_deduplicated():
    paths = [("observations", index, "citation_ids") for index in range(20)]
    error = base.InvalidComparisonBriefing("response_structure", fields=[paths[0], *paths])
    assert error.feedback()["fields"] == [f"observations.{index}.citation_ids" for index in range(8)]


@pytest.mark.asyncio
async def test_price_only_contract_still_uses_same_deadline_and_one_specific_repair(monkeypatch, caplog):
    evidence = _packet()
    bad = _valid(evidence)
    bad["packet_id"] = "0" * 64
    client = _Client(json.dumps(bad), json.dumps(_valid(evidence)))
    _configure(monkeypatch, client)
    result = await base.generate_comparison_briefing(evidence)
    assert result.status == "complete"
    assert feedback(client.calls[1][0])["code"] == "snapshot_mismatch"
    assert "mode=price attempt=1" in caplog.text
    assert "Server-derived reference requirements" not in client.calls[0][0][0]["content"]
    assert client.calls[0][1]["max_tokens"] == client.calls[1][1]["max_tokens"] == 3200
