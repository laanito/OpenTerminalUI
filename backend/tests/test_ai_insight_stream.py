from __future__ import annotations

import json

import pytest

from backend.api.routes import ai_insights


@pytest.mark.asyncio
async def test_insight_stream_dispatches_kind_and_emits_ndjson(monkeypatch) -> None:
    captured = {}

    async def fake_risk(payload, *, on_token):
        captured.update(payload)
        on_token('{"summary":"done"}')
        return {"engine": "llm", "model": "test", "summary": "done", "sections": []}

    monkeypatch.setattr(ai_insights, "_risk_insights", fake_risk)
    response = await ai_insights.insight_stream(
        ai_insights.InsightStreamRequest(kind="risk", payload={"scope": "portfolio"})
    )
    chunks = [chunk async for chunk in response.body_iterator]
    events = [json.loads(line) for chunk in chunks for line in str(chunk).splitlines()]

    assert response.media_type == "application/x-ndjson"
    assert captured == {"scope": "portfolio"}
    assert [event["type"] for event in events] == ["start", "progress", "delta", "result"]
    assert events[2]["received_chars"] == len(events[2]["text"])
    assert events[-1]["result"]["summary"] == "done"
