"""Tests for the shared Gemma-backed LLM insight helper."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from backend.services import llm_insights


def _settings(enabled: bool = True, timeout: float = 240.0) -> SimpleNamespace:
    return SimpleNamespace(
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


def test_run_insight_parses_model_output(monkeypatch) -> None:
    content = (
        '{"summary":"Solid fundamentals with rising revenue.","sections":['
        '{"title":"Bull Case","tone":"positive","points":["Growing revenue","Strong ROE"]},'
        '{"title":"Bear Case","tone":"negative","points":["Stretched valuation"]}]}'
    )
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(True))
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda: _FakeClient(content))
    result = asyncio.run(llm_insights.run_insight("system", "user"))
    assert result["engine"] == "llm"
    assert result["summary"] == "Solid fundamentals with rising revenue."
    assert len(result["sections"]) == 2
    assert result["sections"][0]["tone"] == "positive"
    assert result["sections"][0]["points"] == ["Growing revenue", "Strong ROE"]


def test_run_insight_falls_back_on_unparseable_output(monkeypatch) -> None:
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(True))
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda: _FakeClient("not json at all"))
    result = asyncio.run(llm_insights.run_insight("system", "user"))
    assert result["engine"] == "unavailable"


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
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda: client)

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
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda: _SlowClient("{}"))

    result = asyncio.run(llm_insights.run_insight("system", "user"))

    assert result["engine"] == "unavailable"


def test_sanitize_sections_filters_invalid() -> None:
    raw = [
        {"title": "Good", "tone": "weird", "points": ["a", "b"]},
        {"title": "", "tone": "positive", "points": ["x"]},
        {"title": "NoPoints", "tone": "negative", "points": []},
        "garbage",
    ]
    out = llm_insights._sanitize_sections(raw)
    assert len(out) == 1
    assert out[0]["title"] == "Good"
    assert out[0]["tone"] == "neutral"
    assert out[0]["points"] == ["a", "b"]
