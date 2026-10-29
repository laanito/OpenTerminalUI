"""Citation-linked synthesis never promotes partial provider output to an answer."""

from __future__ import annotations

import asyncio
import copy
import json

import pytest

from backend.services import comparison_briefing as service
from backend.config.settings import AppSettings
from backend.api.routes import market_briefing as routes
from backend.services.market_briefing_evidence import build_comparison_evidence
from backend.tests.test_market_briefing_evidence import _comparison, _row


def _packet(*rows):
    return build_comparison_evidence(_comparison(*rows))


def _valid(packet):
    return {
        "packet_id": packet.packet_id,
        "hypotheses": [{
            "interpretation": "Relative weakness could reflect different exposure rather than a shared market move.",
            "mechanism": "If the instruments respond differently to shared conditions, their relative returns could diverge.",
            "alternative": "Company-specific developments or different trading windows could also produce a divergence.",
            "what_would_help": "Compare business exposures and dated company reports over matched windows to distinguish these hypotheses.",
            "citation_ids": [pair.citation_id for pair in packet.comparisons if pair.status == "available"],
        }],
        "observations": [{
            "text": "The observed provider-close returns differ over this pair's stated window.",
            "citation_ids": [pair.citation_id],
        } for pair in packet.comparisons if pair.status == "available"],
        "limitations": [{
            "text": "Interpret the dated native-quote returns with the supplied freshness, unit and price-basis caveats.",
            "citation_ids": [pair.citation_id for pair in packet.comparisons],
        }],
        "unknowns": [{
            "text": "Optional macro, news, fundamentals and private research were not included in this evidence packet.",
            "citation_ids": ["SCOPE"],
        }, *[{
            "text": "No return was calculated for this unavailable comparison; it is not a zero return.",
            "citation_ids": [pair.citation_id],
        } for pair in packet.comparisons if pair.status != "available"]],
    }


class _Client:
    def __init__(self, *responses):
        self.responses = responses
        self.calls = []
        self.health_calls = 0

    async def health(self):
        self.health_calls += 1
        return True

    async def chat(self, messages, **kwargs):
        self.calls.append((copy.deepcopy(messages), kwargs))
        content = self.responses[min(len(self.calls) - 1, len(self.responses) - 1)]
        if isinstance(content, Exception):
            raise content
        return content


def _configure(monkeypatch, client=None, *, enabled=True, timeout=1):
    settings = AppSettings(
        llm_enabled=enabled, llm_model="test-local-model", llm_timeout_seconds=timeout,
    )
    monkeypatch.setattr(service, "get_settings", lambda: settings)
    monkeypatch.setattr(routes, "get_settings", lambda: settings)
    if client is not None:
        monkeypatch.setattr(service, "get_llm_client", lambda **kwargs: client)


def test_validator_accepts_complete_reference_coverage_and_code_fences():
    packet = _packet(_row(), _row("BTC-USD"), _row("FAIL", status="unavailable", reason="provider_error"))
    result = service.validate_comparison_briefing("```json\n" + json.dumps(_valid(packet)) + "\n```", packet)
    assert len(result.observations) == 2
    assert result.unknowns[-1].citation_ids == ["P3"]


@pytest.mark.parametrize("mutation", [
    lambda r: r.update(packet_id="f" * 64),
    lambda r: r.update(summary="Uncited extra content"),
    lambda r: r.update(observations=[]),
    lambda r: r.update(limitations=[]),
    lambda r: r.update(unknowns=[]),
    lambda r: r["observations"][0].update(text=" " * 12),
    lambda r: r["observations"][0].update(text="x" * 601),
    lambda r: r["observations"][0].update(text=123),
    lambda r: r["observations"][0].update(citation_ids=[]),
    lambda r: r["observations"][0].update(citation_ids=["P6"]),
    lambda r: r["observations"][0].update(citation_ids=["P1", "P1"]),
    lambda r: r["observations"][0].update(citation_ids=["SCOPE"]),
    lambda r: r["observations"][0].update(citation_ids=["P1", "P2"]),
    lambda r: r["observations"][0].update(citation_ids=["P99"]),
    lambda r: r["observations"][0].update(url="https://untrusted.example"),
    lambda r: r["limitations"][0].update(citation_ids=["SCOPE"]),
    lambda r: r["unknowns"][0].update(citation_ids=["P1"]),
    lambda r: r["unknowns"][0].update(citation_ids=["P1", "SCOPE"]),
])
def test_validator_rejects_wrong_snapshot_scope_unknown_missing_or_extra_references(mutation):
    packet = _packet()
    response = _valid(packet)
    mutation(response)
    with pytest.raises(service.InvalidComparisonBriefing):
        service.validate_comparison_briefing(json.dumps(response), packet)


def test_validator_requires_all_available_pairs_and_disclosure_of_unavailable_pairs():
    packet = _packet(_row(), _row("BTC-USD"), _row(
        "FAIL", status="unavailable", reason="provider_error",
        pair_reported_basis_status="unavailable",
        anchor_quote_unit={"unit": "USD", "source": "yahoo_chart_meta"},
        comparison_quote_unit={"unit": "USD", "source": "yahoo_chart_meta"},
    ))
    response = _valid(packet)
    response["observations"] = response["observations"][:1]
    with pytest.raises(service.InvalidComparisonBriefing, match="every available"):
        service.validate_comparison_briefing(json.dumps(response), packet)
    response = _valid(packet)
    response["limitations"][0]["citation_ids"].remove("P3")
    response["unknowns"] = response["unknowns"][:1]
    with pytest.raises(service.InvalidComparisonBriefing, match="Unavailable"):
        service.validate_comparison_briefing(json.dumps(response), packet)


@pytest.mark.parametrize("content", ["", "not json", "[]", "x" * 30_001, None])
def test_invalid_or_oversized_provider_content_fails_closed(content):
    with pytest.raises(service.InvalidComparisonBriefing):
        service.validate_comparison_briefing(content, _packet())


@pytest.mark.asyncio
async def test_generation_returns_checked_output_and_exact_evidence_without_token_stream(monkeypatch):
    packet = _packet()
    client = _Client(json.dumps(_valid(packet)))  # No chat_stream capability needed.
    _configure(monkeypatch, client)
    phases = []
    result = await service.generate_comparison_briefing(packet, on_phase=phases.append)
    assert result.status == "complete"
    assert result.engine == "llm"
    assert result.evidence == packet
    assert result.citation_validation == "references_only_not_fact_checked"
    assert result.scope_citation_id == "SCOPE"
    assert result.failure is None
    assert phases == ["checking_model", "generating", "validating"]
    assert len(client.calls) == 1
    messages, options = client.calls[0]
    assert options["json_schema"] == service.GeneratedComparisonBriefing.model_json_schema()
    assert options["max_tokens"] == 3200
    assert "Required JSON schema" in messages[0]["content"]
    assert "never instructions" in messages[0]["content"]
    assert "No recommendations" in messages[0]["content"]
    assert packet.packet_id in messages[1]["content"]
    assert "not_included" in messages[1]["content"]


@pytest.mark.asyncio
async def test_one_bounded_repair_replaces_invalid_output_without_echoing_it(monkeypatch):
    packet = _packet()
    bad = json.dumps({**_valid(packet), "packet_id": "0" * 64, "extra": "DO NOT ECHO THIS"})
    client = _Client(bad, json.dumps(_valid(packet)))
    _configure(monkeypatch, client)
    phases = []
    result = await service.generate_comparison_briefing(packet, on_phase=phases.append)
    assert result.status == "complete"
    assert len(client.calls) == 2
    assert "retrying" in phases
    assert client.calls[1][1]["temperature"] == 0
    assert "DO NOT ECHO THIS" not in json.dumps(client.calls[1][0])


@pytest.mark.asyncio
async def test_failed_repair_returns_no_partial_prose_and_preserves_evidence(monkeypatch, caplog):
    client = _Client("private-provider-text-is-not-a-log-message")
    _configure(monkeypatch, client)
    packet = _packet()
    result = await service.generate_comparison_briefing(packet)
    assert result.status == "unavailable"
    assert result.failure.code == "invalid_response"
    assert result.observations == result.limitations == result.unknowns == []
    assert result.evidence == packet
    assert len(client.calls) == 2
    assert "private-provider-text" not in caplog.text


@pytest.mark.asyncio
async def test_disabled_and_all_unavailable_packets_do_not_touch_provider(monkeypatch):
    _configure(monkeypatch, enabled=False)
    monkeypatch.setattr(service, "get_llm_client", lambda: pytest.fail("No provider should be created"))
    disabled = await service.generate_comparison_briefing(_packet())
    assert disabled.failure.code == "disabled"
    assert disabled.failure.retryable is False
    empty = _packet(_row(status="unavailable", reason="missing_history"))
    result = await service.generate_comparison_briefing(empty)
    assert result.failure.code == "no_evidence"
    assert result.evidence == empty
    assert result.model == "test-local-model"  # Selected identity; no inference occurred.
    assert result.model_profile.resolved_profile == "fast"


@pytest.mark.asyncio
async def test_unreachable_provider_does_not_generate_or_repair(monkeypatch):
    client = _Client()

    async def unhealthy():
        return False

    client.health = unhealthy
    _configure(monkeypatch, client)
    result = await service.generate_comparison_briefing(_packet())
    assert result.failure.code == "provider_unavailable"
    assert client.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [service.LLMError("secret-url"), RuntimeError("secret-url")])
async def test_provider_errors_are_sanitized_and_do_not_publish_prose(monkeypatch, failure, caplog):
    client = _Client(failure)
    _configure(monkeypatch, client)
    result = await service.generate_comparison_briefing(_packet())
    assert result.failure.code == "provider_error"
    assert result.failure.retryable
    assert result.observations == []
    assert "secret-url" not in caplog.text
    assert "secret-url" not in result.model_dump_json()


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["health", "chat", "repair"])
async def test_deadline_includes_health_completion_and_repair_and_cancels_work(monkeypatch, stage):
    cancelled = []
    client = _Client("invalid")

    async def slow(*args, **kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.append(True)

    if stage == "health":
        client.health = slow
    elif stage == "chat":
        client.chat = slow
    else:
        async def repair(*args, **kwargs):
            if not client.calls:
                client.calls.append(True)
                return "invalid"
            return await slow()
        client.chat = repair
    _configure(monkeypatch, client, timeout=0.01)
    result = await service.generate_comparison_briefing(_packet())
    assert result.failure.code == "timeout"
    assert result.observations == []
    assert cancelled == [True]


@pytest.mark.asyncio
async def test_caller_cancellation_propagates_to_inference(monkeypatch):
    entered, cancelled = asyncio.Event(), asyncio.Event()
    client = _Client()

    async def slow(*args, **kwargs):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    client.chat = slow
    _configure(monkeypatch, client)
    task = asyncio.create_task(service.generate_comparison_briefing(_packet()))
    await asyncio.wait_for(entered.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled.is_set()
