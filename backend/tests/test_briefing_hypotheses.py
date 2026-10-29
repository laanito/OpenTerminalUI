"""Interpretation structure and observation anchors are checked, not causal truth."""
import copy
import json

import pytest

from backend.services import comparison_briefing as price
from backend.services import comparison_context_briefing as context
from backend.tests.test_comparison_briefing import _Client, _configure, _packet, _valid
from backend.tests.test_comparison_context_briefing import packet, valid, configure


@pytest.mark.parametrize("with_context", [False, True])
@pytest.mark.parametrize("mutation", [
    lambda r: r.pop("hypotheses"),
    lambda r: r.update(hypotheses=[]),
    lambda r: r["hypotheses"][0].pop("alternative"),
    lambda r: r["hypotheses"][0].update(what_would_help=""),
    lambda r: r["hypotheses"][0].update(mechanism="x" * 601),
    lambda r: r["hypotheses"][0].update(confidence="verified"),
    lambda r: r["hypotheses"][0].update(citation_ids=["SCOPE"]),
    lambda r: r["hypotheses"][0].update(citation_ids=["P6"]),
    lambda r: r["hypotheses"][0].update(citation_ids=["P1", "P1"]),
])
def test_incomplete_or_unanchored_interpretations_fail_closed(with_context, mutation):
    evidence = packet() if with_context else _packet()
    response = valid(evidence) if with_context else _valid(evidence)
    mutation(response)
    validate = context.validate_context_briefing if with_context else price.validate_comparison_briefing
    with pytest.raises(price.InvalidComparisonBriefing):
        validate(json.dumps(response), evidence)


@pytest.mark.parametrize("refs", [["C1"], ["C1G1"], ["C1G1H1"], ["P1", "C1"], ["P1", "C1S1"]])
def test_context_hypotheses_require_exact_usable_inputs_and_linked_pair(refs):
    evidence = packet()
    response = valid(evidence)
    response["hypotheses"][0]["citation_ids"] = refs
    with pytest.raises(price.InvalidComparisonBriefing, match="observation anchors"):
        context.validate_context_briefing(json.dumps(response), evidence)


def test_context_hypothesis_can_anchor_multiple_macro_inputs_without_claiming_validation_of_reasoning():
    evidence = packet()
    response = valid(evidence)
    response["hypotheses"] = [{
        "interpretation": "A combination of price weakness and these macro conditions could warrant examining financial conditions.",
        "mechanism": "If policy tightened alongside weaker employment, financing pressure and growth concerns could weigh on demand for risky assets.",
        "alternative": "Instrument-specific developments could dominate; these single macro observations do not establish changes or surprises.",
        "what_would_help": "Comparable prior observations, release timestamps and expectations would help assess timing; dated instrument-specific reports could test the competing account.",
        "citation_ids": ["P1", "C2S1", "C2S2", "C2S3"],
    }]
    parsed = context.validate_context_briefing(json.dumps(response), evidence)
    assert parsed.hypotheses[0].citation_ids == response["hypotheses"][0]["citation_ids"]
    # This acceptance checks the contract and anchors, not whether the mechanism is true.


@pytest.mark.asyncio
@pytest.mark.parametrize("with_context", [False, True])
async def test_bad_hypothesis_is_repaired_once_and_only_validated_reasoning_is_published(monkeypatch, with_context):
    evidence = packet() if with_context else _packet()
    response = valid(evidence) if with_context else _valid(evidence)
    bad = copy.deepcopy(response)
    bad["hypotheses"][0]["citation_ids"] = ["SCOPE"]
    client = _Client(json.dumps(bad), json.dumps(response))
    if with_context:
        configure(monkeypatch, client)
        result = await context.generate_context_briefing(evidence)
    else:
        _configure(monkeypatch, client)
        result = await price.generate_comparison_briefing(evidence)
    assert result.status == "complete"
    assert len(client.calls) == 2
    assert "hypotheses.0.citation_ids" in client.calls[1][0][-1]["content"]
    assert result.hypotheses[0].model_dump() == response["hypotheses"][0]


@pytest.mark.asyncio
async def test_failed_repair_discards_all_hypotheses(monkeypatch):
    evidence = _packet()
    response = _valid(evidence)
    response["hypotheses"][0]["citation_ids"] = ["SCOPE"]
    _configure(monkeypatch, _Client(json.dumps(response)))
    result = await price.generate_comparison_briefing(evidence)
    assert result.failure.code == "invalid_response"
    assert result.hypotheses == result.observations == []
    assert result.evidence == evidence
