from __future__ import annotations

import asyncio

from backend.api.routes import ai_insights


def test_collection_briefing_passes_only_allowlisted_terminal_facts(monkeypatch) -> None:
    captured: dict[str, str] = {}

    async def fake_run(system_prompt: str, user_content: str, **kwargs):  # noqa: ANN001
        captured["system"] = system_prompt
        captured["user"] = user_content
        return {"engine": "llm", "model": "test", "summary": "ok", "sections": []}

    monkeypatch.setattr(ai_insights, "run_insight", fake_run)

    result = asyncio.run(
        ai_insights.collection_briefing(
            {
                "symbols": ["SPY", "QQQ"],
                "scope": "global markets",
                "facts": [
                    {"symbol": "SPY", "label": "S&P 500", "price": 6500, "change": 12, "change_pct": 0.18},
                    {"symbol": "IGNORED", "label": "Not in scope", "price": 999},
                ],
            }
        )
    )

    assert result["engine"] == "llm"
    assert "using only the observations supplied" in captured["system"]
    assert '"symbol": "SPY"' in captured["user"]
    assert "IGNORED" not in captured["user"]


def test_collection_briefing_marks_missing_observations_explicitly(monkeypatch) -> None:
    captured: dict[str, str] = {}

    async def fake_run(system_prompt: str, user_content: str, **kwargs):  # noqa: ANN001
        captured["user"] = user_content
        return {"engine": "unavailable", "model": "test", "summary": "none", "sections": []}

    monkeypatch.setattr(ai_insights, "run_insight", fake_run)

    asyncio.run(ai_insights.collection_briefing({"symbols": ["SPY"], "scope": "collection"}))

    assert "No current observations were supplied." in captured["user"]
