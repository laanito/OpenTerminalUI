"""LLMClient prompt/response handling — the provider-agnostic bits, no network.

Focus: when a caller asks for a json_schema, the client must carry the required
shape IN THE PROMPT, because some OpenAI-compatible servers (notably Ollama's
gpt-oss reasoning models) ignore `response_format` and return prose otherwise —
which silently makes a feature look "unavailable".
"""
from __future__ import annotations

import json

import pytest

from backend.services import llm_client as llm_client_mod
from backend.services.llm_client import LLMClient, parse_json_response, _TRUNCATION_RETRY_MAX_TOKENS


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


class _FakeResp:
    def __init__(self, payload: dict) -> None:
        self._payload = payload
        self.headers = {"content-type": "application/json"}

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


class _FakeAsyncClient:
    """Serves queued responses and records each request payload."""

    posts: list[dict] = []
    queue: list[_FakeResp] = []

    def __init__(self, *a, **k) -> None:  # noqa: D401 - matches httpx.AsyncClient(...)
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):  # noqa: A002
        _FakeAsyncClient.posts.append(json)
        return _FakeAsyncClient.queue.pop(0)


def _choice(content: str, finish: str) -> dict:
    return {"choices": [{"message": {"content": content}, "finish_reason": finish}]}


@pytest.mark.asyncio
async def test_truncated_structured_call_retries_with_bigger_budget(monkeypatch) -> None:
    # First attempt truncates on the token cap with empty content (reasoning model
    # burned the budget); the client should retry once with a roomier budget.
    _FakeAsyncClient.posts = []
    _FakeAsyncClient.queue = [
        _FakeResp(_choice("", "length")),
        _FakeResp(_choice('{"label":"Bullish"}', "stop")),
    ]
    monkeypatch.setattr(llm_client_mod.httpx, "AsyncClient", _FakeAsyncClient)

    out = await _client("json").chat(
        [{"role": "user", "content": "hi"}], max_tokens=900, json_schema=_SCHEMA
    )
    assert out == '{"label":"Bullish"}'
    assert len(_FakeAsyncClient.posts) == 2
    assert _FakeAsyncClient.posts[0]["max_tokens"] == 900
    assert _FakeAsyncClient.posts[1]["max_tokens"] == _TRUNCATION_RETRY_MAX_TOKENS


@pytest.mark.asyncio
async def test_no_retry_for_plain_text_call(monkeypatch) -> None:
    # Without a json_schema, a length finish is just a long answer — no retry.
    _FakeAsyncClient.posts = []
    _FakeAsyncClient.queue = [_FakeResp(_choice("some long prose", "length"))]
    monkeypatch.setattr(llm_client_mod.httpx, "AsyncClient", _FakeAsyncClient)

    out = await _client().chat([{"role": "user", "content": "hi"}], max_tokens=900)
    assert out == "some long prose"
    assert len(_FakeAsyncClient.posts) == 1  # no retry
