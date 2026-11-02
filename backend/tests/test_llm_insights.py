"""Tests for the shared Gemma-backed LLM insight helper."""

from __future__ import annotations

import asyncio
import json

import pytest
from backend.config.settings import AppSettings

from backend.services import llm_insights


def _settings(enabled: bool = True, timeout: float = 240.0) -> AppSettings:
    return AppSettings(
        llm_enabled=enabled,
        llm_model="google/gemma-4-26b-a4b",
        llm_timeout_seconds=timeout,
    )


class _FakeClient:
    def __init__(self, content: str) -> None:
        self._content = content

    async def health(self) -> bool:
        return True

    async def chat(self, messages, **kwargs) -> str:  # noqa: ANN001
        return self._content


def test_run_insight_unavailable_when_disabled(monkeypatch) -> None:
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(False))
    result = asyncio.run(llm_insights.run_insight("system", "user"))
    assert result["engine"] == "unavailable"
    assert result["sections"] == []
    assert result["summary"]
    assert result["failure"]["code"] == "disabled"
    assert result["failure"]["retryable"] is False


def test_run_insight_parses_model_output(monkeypatch) -> None:
    content = (
        '{"summary":"Solid fundamentals with rising revenue.","sections":['
        '{"title":"Bull Case","tone":"positive","points":["Growing revenue","Strong ROE"]},'
        '{"title":"Bear Case","tone":"negative","points":["Stretched valuation"]}]}'
    )
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(True))
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: _FakeClient(content))
    result = asyncio.run(llm_insights.run_insight("system", "user"))
    assert result["engine"] == "llm"
    assert result["summary"] == "Solid fundamentals with rising revenue."
    assert len(result["sections"]) == 2
    assert result["sections"][0]["tone"] == "positive"
    assert result["sections"][0]["points"] == ["Growing revenue", "Strong ROE"]


def test_run_insight_streams_tokens_but_publishes_only_validated_result(monkeypatch) -> None:
    chunks = [
        '{"summary":"Streaming works.","sections":[',
        '{"title":"Evidence","tone":"positive","points":["Observed"]},',
        '{"title":"Risk","tone":"negative","points":["Limited"]}]}',
    ]

    class _StreamingClient:
        async def health(self) -> bool:
            return True

        async def chat_stream(self, messages, **kwargs):  # noqa: ANN001
            assert kwargs["json_schema"] == llm_insights.INSIGHT_SCHEMA
            for chunk in chunks:
                yield chunk

        async def chat(self, messages, **kwargs) -> str:  # noqa: ANN001
            raise AssertionError("valid streaming output must not restart completion")

    received: list[str] = []
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(True))
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: _StreamingClient())

    result = asyncio.run(
        llm_insights.run_insight("system", "user", on_token=received.append)
    )

    assert received == chunks
    assert result["engine"] == "llm"
    assert result["summary"] == "Streaming works."
    assert len(result["sections"]) == 2


def test_run_insight_falls_back_when_structured_stream_is_invalid(monkeypatch) -> None:
    valid = (
        '{"summary":"Stable fallback.","sections":['
        '{"title":"Evidence","tone":"neutral","points":["Observed"]},'
        '{"title":"Risk","tone":"negative","points":["Limited"]}]}'
    )

    class _InvalidStreamClient:
        chat_calls = 0

        async def health(self) -> bool:
            return True

        async def chat_stream(self, messages, **kwargs):  # noqa: ANN001
            yield "not structured json"

        async def chat(self, messages, **kwargs) -> str:  # noqa: ANN001
            self.chat_calls += 1
            return valid

    client = _InvalidStreamClient()
    received: list[str] = []
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(True))
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: client)

    result = asyncio.run(
        llm_insights.run_insight("system", "user", on_token=received.append)
    )

    assert received == ["not structured json"]
    assert client.chat_calls == 1
    assert result["summary"] == "Stable fallback."


def test_run_insight_falls_back_when_provider_stream_is_interrupted(monkeypatch) -> None:
    valid = (
        '{"summary":"Recovered.","sections":['
        '{"title":"Evidence","tone":"neutral","points":["Observed"]},'
        '{"title":"Risk","tone":"negative","points":["Limited"]}]}'
    )

    class _InterruptedStreamClient:
        async def health(self) -> bool:
            return True

        async def chat_stream(self, messages, **kwargs):  # noqa: ANN001
            yield '{"summary":"unfinished'
            raise llm_insights.LLMError("provider disconnected")

        async def chat(self, messages, **kwargs) -> str:  # noqa: ANN001
            return valid

    received: list[str] = []
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(True))
    monkeypatch.setattr(
        llm_insights,
        "get_llm_client",
        lambda **kwargs: _InterruptedStreamClient(),
    )

    result = asyncio.run(
        llm_insights.run_insight("system", "user", on_token=received.append)
    )

    assert received == ['{"summary":"unfinished']
    assert result["summary"] == "Recovered."


def test_run_insight_bounds_streaming_provider_operation(monkeypatch) -> None:
    class _SlowStreamingClient:
        async def health(self) -> bool:
            return True

        async def chat_stream(self, messages, **kwargs):  # noqa: ANN001
            await asyncio.sleep(0.05)
            yield "too late"

        async def chat(self, messages, **kwargs) -> str:  # noqa: ANN001
            raise AssertionError("the expired lifecycle must not start a fallback")

    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(True, timeout=0.001))
    monkeypatch.setattr(
        llm_insights,
        "get_llm_client",
        lambda **kwargs: _SlowStreamingClient(),
    )

    result = asyncio.run(
        llm_insights.run_insight("system", "user", on_token=lambda _token: None)
    )

    assert result["engine"] == "unavailable"
    assert result["failure"]["code"] == "timeout"


def test_run_insight_falls_back_on_unparseable_output(monkeypatch) -> None:
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(True))
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: _FakeClient("not json at all"))
    result = asyncio.run(llm_insights.run_insight("system", "user"))
    assert result["engine"] == "unavailable"
    assert result["failure"]["code"] == "invalid_response"


def test_run_insight_retries_malformed_structured_output_once(monkeypatch) -> None:
    valid = (
        '{"summary":"Grounded retry.","sections":['
        '{"title":"Posture","tone":"neutral","points":["Mixed evidence"]},'
        '{"title":"Risks","tone":"negative","points":["Data is limited"]}]}'
    )

    class _FlakyStructuredClient:
        def __init__(self) -> None:
            self.responses = ['{"summary":"truncated"', valid]
            self.calls = 0

        async def health(self) -> bool:
            return True

        async def chat(self, messages, **kwargs) -> str:  # noqa: ANN001
            response = self.responses[self.calls]
            self.calls += 1
            return response

    client = _FlakyStructuredClient()
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(True))
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: client)

    result = asyncio.run(llm_insights.run_insight("system", "user"))

    assert client.calls == 2
    assert result["engine"] == "llm"
    assert result["summary"] == "Grounded retry."


def test_run_insight_bounds_the_whole_provider_operation(monkeypatch) -> None:
    class _SlowClient(_FakeClient):
        async def chat(self, messages, **kwargs) -> str:  # noqa: ANN001
            await asyncio.sleep(0.05)
            return self._content

    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(True, timeout=0.001))
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: _SlowClient("{}"))

    result = asyncio.run(llm_insights.run_insight("system", "user"))

    assert result["engine"] == "unavailable"
    assert result["failure"]["code"] == "timeout"


def test_run_insight_rejects_schema_incomplete_sections_after_one_repair(monkeypatch) -> None:
    content = '{"summary":"Too little evidence","sections":[{"title":"Only","tone":"neutral","points":["One"]}]}'
    client = _FakeClient(content)
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(True))
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: client)

    result = asyncio.run(llm_insights.run_insight("system", "user"))

    assert result["engine"] == "unavailable"
    assert result["failure"]["code"] == "invalid_response"


def test_run_insight_rejects_values_outside_the_published_schema(monkeypatch) -> None:
    content = (
        '{"summary":"Summary","sections":['
        '{"title":"' + ("x" * 161) + '","tone":"neutral","points":["One"]},'
        '{"title":"Risk","tone":"negative","points":["Two"]}]}'
    )
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(True))
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: _FakeClient(content))

    result = asyncio.run(llm_insights.run_insight("system", "user"))

    assert result["engine"] == "unavailable"
    assert result["failure"]["code"] == "invalid_response"


def _insight_object():
    return {"summary": "Observed facts are limited.", "sections": [
        {"title": "Evidence", "tone": "neutral", "points": ["Observed"]},
        {"title": "Risk", "tone": "negative", "points": ["Limited"]},
    ]}


@pytest.mark.parametrize("point,diagnostic", [
    ("private-model-text-" + "x" * 2001, "received 2020"),
    ("   ", "received 0"),
    ({"private-model-text": "hidden"}, "received dict"),
    (12, "received int"),
])
def test_repair_gets_safe_exact_point_feedback(monkeypatch, caplog, point, diagnostic):
    invalid = _insight_object()
    invalid["sections"][0]["points"] = [point]

    class Client(_FakeClient):
        calls = []

        async def chat(self, messages, **kwargs):
            self.calls.append(messages)
            return json.dumps(invalid if len(self.calls) == 1 else _insight_object())

    client = Client("")
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings())
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: client)
    result = asyncio.run(llm_insights.run_insight("system", "original private evidence"))

    assert result["engine"] == "llm"
    assert len(client.calls) == 2
    assert client.calls[1][:2] == client.calls[0]
    feedback = client.calls[1][-1]
    assert feedback["role"] == "system"
    assert "sections[0].points[0]" in feedback["content"]
    assert diagnostic in feedback["content"]
    assert "2000 characters" in feedback["content"]
    assert "private-model-text" not in feedback["content"] + caplog.text
    assert "original private evidence" not in caplog.text


def test_invalid_stream_feedback_reaches_first_completion(monkeypatch):
    invalid = _insight_object()
    invalid["sections"][1]["points"] = ["x" * 2001]

    class Client(_FakeClient):
        calls = []

        async def chat_stream(self, messages, **kwargs):
            yield json.dumps(invalid)

        async def chat(self, messages, **kwargs):
            self.calls.append(messages)
            assert "sections[1].points[0]" in messages[-1]["content"]
            assert "received 2001" in messages[-1]["content"]
            return json.dumps(_insight_object())

    client = Client("")
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings())
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: client)
    result = asyncio.run(llm_insights.run_insight("system", "facts", on_token=lambda _: None))
    assert result["engine"] == "llm"
    assert len(client.calls) == 1


@pytest.mark.parametrize("tone", [{"value": "neutral"}, ["neutral"]])
def test_malformed_tone_remains_bounded_and_logs_final_field(monkeypatch, caplog, tone):
    invalid = _insight_object()
    invalid["sections"][0]["tone"] = tone

    class Client(_FakeClient):
        calls = 0

        async def chat(self, messages, **kwargs):
            self.calls += 1
            return self._content

    client = Client(json.dumps(invalid))
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings())
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: client)
    result = asyncio.run(llm_insights.run_insight("system", "facts"))
    assert client.calls == 2
    assert result["failure"]["code"] == "invalid_response"
    assert "invalid after bounded repair: sections[0].tone" in caplog.text


@pytest.mark.parametrize("length", [220, 221, 500, 2000])
def test_longer_points_are_preserved_without_silent_truncation(length):
    raw = _insight_object()
    raw["sections"][0]["points"] = ["x" * length]
    assert llm_insights._validate_insight(raw)[1][0]["points"] == ["x" * length]


def test_over_safety_ceiling_points_are_rejected_without_truncation():
    raw = _insight_object()
    raw["sections"][0]["points"] = ["x" * 2001]
    with pytest.raises(llm_insights.InvalidInsightResponse, match="received 2001"):
        llm_insights._validate_insight(raw)


@pytest.mark.parametrize("streaming", [False, True])
def test_longer_valid_analysis_does_not_trigger_repair(monkeypatch, streaming):
    raw = _insight_object()
    raw["summary"] = "s" * 1000
    raw["sections"][0]["title"] = "t" * 80
    raw["sections"][0]["points"] = ["p" * 900]

    class Client(_FakeClient):
        calls = 0

        async def chat_stream(self, messages, **kwargs):
            assert "writing preferences, not hard limits" in messages[0]["content"]
            yield self._content

        async def chat(self, messages, **kwargs):
            self.calls += 1
            assert "writing preferences, not hard limits" in messages[0]["content"]
            return self._content

    client = Client(json.dumps(raw))
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings())
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: client)
    result = asyncio.run(llm_insights.run_insight(
        "system", "facts", on_token=(lambda _: None) if streaming else None,
    ))
    assert result["engine"] == "llm"
    assert result["summary"] == raw["summary"]
    assert result["sections"] == raw["sections"]
    assert client.calls == (0 if streaming else 1)


def test_total_text_safety_ceiling_is_independent_of_individual_points():
    raw = {"summary": "s", "sections": [
        {"title": "t", "tone": "neutral", "points": ["x" * 799] * 5}
        for _ in range(4)
    ]}
    raw["sections"][0]["points"][0] = "x" * 814
    assert llm_insights._validate_insight(raw)[0] == "s"  # Exactly 16,000 chars.
    raw["sections"][0]["points"][0] += "x"
    with pytest.raises(llm_insights.InvalidInsightResponse, match="received at least 16001"):
        llm_insights._validate_insight(raw)


def test_raw_response_safety_ceiling_also_bounds_whitespace_and_unknown_fields():
    content = json.dumps(_insight_object())
    padded = content + " " * (64000 - len(content))
    assert llm_insights._parse_insight(padded)[0] == _insight_object()["summary"]
    with pytest.raises(llm_insights.InvalidInsightResponse, match="received 64001"):
        llm_insights._parse_insight(padded + " ")


def test_oversized_stream_is_closed_before_bounded_completion(monkeypatch):
    class Client(_FakeClient):
        closed = False
        calls = 0

        async def chat_stream(self, messages, **kwargs):
            try:
                yield " " * 64000
                yield "x"
                raise AssertionError("must stop consuming the oversized stream")
            finally:
                self.closed = True

        async def chat(self, messages, **kwargs):
            assert self.closed
            self.calls += 1
            assert "JSON response must contain at most 64000" in messages[-1]["content"]
            return self._content

    client = Client(json.dumps(_insight_object()))
    received = []
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings())
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: client)
    result = asyncio.run(llm_insights.run_insight("system", "facts", on_token=received.append))
    assert result["engine"] == "llm"
    assert client.calls == 1
    assert received == [" " * 64000]
