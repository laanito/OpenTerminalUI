"""LLMClient prompt/response handling — the provider-agnostic bits, no network.

Focus: when a caller asks for a json_schema, the client must carry the required
shape IN THE PROMPT, because some OpenAI-compatible servers (notably Ollama's
gpt-oss reasoning models) ignore `response_format` and return prose otherwise —
which silently makes a feature look "unavailable".
"""
from __future__ import annotations

import json

from backend.services.llm_client import LLMClient, parse_json_response


_SCHEMA = {
    "type": "object",
    "properties": {"label": {"type": "string"}},
    "required": ["label"],
}


def _client(structured_output: str = "auto") -> LLMClient:
    return LLMClient(
        base_url="http://x/v1",
        model="test-model",
        api_key="",
        structured_output=structured_output,
    )


def msgs_ref() -> list[dict[str, str]]:
    return [{"role": "system", "content": "be terse"}, {"role": "user", "content": "hi"}]


def test_augment_injects_schema_directive() -> None:
    out = _client()._augment_messages(msgs_ref(), _SCHEMA)  # noqa: SLF001
    # Original messages preserved, directive appended as a trailing system msg.
    assert out[:2] == msgs_ref()
    assert out[-1]["role"] == "system"
    assert "ONLY a single JSON object" in out[-1]["content"]
    # The actual schema travels in the prompt so ignoring-providers still comply.
    assert json.dumps(_SCHEMA, separators=(",", ":")) in out[-1]["content"]


def test_no_directive_without_schema() -> None:
    c = _client()
    assert c._augment_messages(msgs_ref(), None) == msgs_ref()  # noqa: SLF001


def test_no_directive_when_structured_output_none() -> None:
    c = _client(structured_output="none")
    assert c._augment_messages(msgs_ref(), _SCHEMA) == msgs_ref()  # noqa: SLF001


def test_augment_does_not_mutate_caller_list() -> None:
    c = _client()
    original = msgs_ref()
    _ = c._augment_messages(original, _SCHEMA)  # noqa: SLF001
    assert original == msgs_ref()  # caller's list is not mutated


def test_response_format_ladder_variants() -> None:
    c_auto = _client("auto")
    ladder = c_auto._response_format_ladder(_SCHEMA)  # noqa: SLF001
    assert [rf and rf["type"] for rf in ladder] == ["json_schema", "json_object", None]
    assert c_auto._response_format_ladder(None) == [None]  # noqa: SLF001
    assert _client("json")._response_format_ladder(_SCHEMA)[0]["type"] == "json_object"  # noqa: SLF001
    assert _client("none")._response_format_ladder(_SCHEMA) == [None]  # noqa: SLF001


def test_parse_json_tolerates_prose_and_fences() -> None:
    assert parse_json_response('```json\n{"label":"Bullish"}\n```') == {"label": "Bullish"}
    assert parse_json_response('Here you go: {"label":"Bearish"} — hope that helps') == {"label": "Bearish"}
