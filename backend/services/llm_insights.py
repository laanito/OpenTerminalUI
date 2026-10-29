"""Shared insight helper backed by a resolved generation profile.

Several read-heavy screens (stock briefing, backtest explainer, risk insights)
need the same thing: hand the model some structured data, get back a concise,
sectioned analysis. This module centralises that so every feature uses one
profile-resolved LLM client, one schema, and an explicit unavailable path.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from backend.config.settings import get_settings
from backend.services.llm_profiles import ResolvedLLMProfile, resolve_llm_profile
from backend.services.llm_client import (
    LLMError,
    get_llm_client,
    parse_json_response,
)

_VALID_TONES = {"positive", "negative", "neutral"}
logger = logging.getLogger(__name__)


class InvalidInsightResponse(LLMError):
    """The provider answered, but the insight did not satisfy our contract."""


# Unified structured-output schema shared by every insight endpoint so a single
# frontend card can render all of them.
INSIGHT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "maxLength": 600},
        "sections": {
            "type": "array",
            "minItems": 2,
            "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "maxLength": 48},
                    "tone": {"type": "string", "enum": ["positive", "negative", "neutral"]},
                    "points": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 5,
                        "items": {"type": "string", "maxLength": 220},
                    },
                },
                "required": ["title", "tone", "points"],
            },
        },
    },
    "required": ["summary", "sections"],
}


def _validate_insight(raw: Any) -> tuple[str, list[dict[str, Any]]]:
    if not isinstance(raw, dict):
        raise InvalidInsightResponse("Insight response is not an object")
    raw_summary = raw.get("summary")
    if not isinstance(raw_summary, str):
        raise InvalidInsightResponse("Insight summary is not a string")
    summary = raw_summary.strip()
    raw_sections = raw.get("sections")
    if (
        not summary
        or len(summary) > 600
        or not isinstance(raw_sections, list)
        or not 2 <= len(raw_sections) <= 4
    ):
        raise InvalidInsightResponse("Insight response does not satisfy the required schema")
    sections: list[dict[str, Any]] = []
    for node in raw_sections:
        if not isinstance(node, dict):
            raise InvalidInsightResponse("Insight section is not an object")
        title = node.get("title")
        tone = node.get("tone")
        points = node.get("points")
        if not isinstance(title, str) or not title.strip() or len(title.strip()) > 48:
            raise InvalidInsightResponse("Insight section title is invalid")
        if tone not in _VALID_TONES:
            raise InvalidInsightResponse("Insight section tone is invalid")
        if not isinstance(points, list) or not 1 <= len(points) <= 5:
            raise InvalidInsightResponse("Insight section points are invalid")
        clean_points: list[str] = []
        for point in points:
            if not isinstance(point, str) or not point.strip() or len(point.strip()) > 220:
                raise InvalidInsightResponse("Insight section point is invalid")
            clean_points.append(point.strip())
        sections.append({"title": title.strip(), "tone": tone, "points": clean_points})
    return summary, sections


def _parse_insight(content: str) -> tuple[str, list[dict[str, Any]]]:
    try:
        parsed = parse_json_response(content)
    except LLMError as exc:
        raise InvalidInsightResponse(str(exc)) from exc
    return _validate_insight(parsed)


async def run_insight(
    system_prompt: str,
    user_content: str,
    *,
    max_tokens: int = 900,
    unavailable_summary: str = "AI analysis is unavailable — start your local LLM (e.g. Ollama) to enable it.",
    on_token: Callable[[str], None] | None = None,
    profile: ResolvedLLMProfile | None = None,
) -> dict[str, Any]:
    """Produce a `{summary, sections}` insight, falling back gracefully.

    Returns ``engine: "llm"`` when the model answered, ``"unavailable"``
    when LLM is off/unreachable or the response could not be used.
    """
    profile = profile or resolve_llm_profile(get_settings(), "stock_briefing")
    model = profile.model
    generated_at = datetime.now(timezone.utc).isoformat()
    base = {
        "engine": "unavailable",
        "model": model,
        "model_profile": profile.public_identity(),
        "summary": unavailable_summary,
        "sections": [],
        "generated_at": generated_at,
    }

    def unavailable(code: str, *, retryable: bool) -> dict[str, Any]:
        return {
            **base,
            "failure": {
                "code": code,
                "message": unavailable_summary,
                "retryable": retryable,
            },
        }

    if not profile.enabled:
        return unavailable("disabled", retryable=False)
    client = get_llm_client(profile=profile)

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    async def complete_and_validate() -> tuple[str, list[dict[str, Any]]]:
        content = await client.chat(
            messages,
            temperature=0.3,
            max_tokens=max_tokens,
            json_schema=INSIGHT_SCHEMA,
            frequency_penalty=0.3,
        )
        try:
            return _parse_insight(content)
        except InvalidInsightResponse as exc:
            logger.warning(
                "LLM insight returned malformed structured output; retrying once: %s",
                exc,
            )
            content = await client.chat(
                messages,
                temperature=0.0,
                max_tokens=max_tokens,
                json_schema=INSIGHT_SCHEMA,
                frequency_penalty=0.0,
            )
            return _parse_insight(content)

    try:
        # The client may make more than one provider request while stepping down
        # its structured-output ladder. Bound the whole operation, including one
        # retry for providers that intermittently return malformed JSON despite
        # accepting response_format. Health shares the selected profile budget.
        async with asyncio.timeout(profile.timeout_seconds):
            try:
                healthy = await client.health()
            except asyncio.TimeoutError:
                raise
            except Exception as exc:
                logger.warning("LLM health check failed (%s)", type(exc).__name__)
                healthy = False
            if not healthy:
                return unavailable("provider_unavailable", retryable=True)
            if on_token is None:
                summary, sections = await complete_and_validate()
            else:
                chunks: list[str] = []
                try:
                    async for chunk in client.chat_stream(
                        messages,
                        temperature=0.3,
                        max_tokens=max_tokens,
                        json_schema=INSIGHT_SCHEMA,
                        frequency_penalty=0.3,
                    ):
                        chunks.append(chunk)
                        on_token(chunk)
                    if not chunks:
                        raise LLMError("LLM stream returned no response text")
                    summary, sections = _parse_insight("".join(chunks))
                except (LLMError, InvalidInsightResponse) as exc:
                    # Streaming capability and structured-stream fidelity vary by
                    # provider. Fall back inside the same server-owned deadline;
                    # only the final validated result is published as an insight.
                    logger.warning(
                        "LLM structured stream unavailable; using bounded completion: %s",
                        type(exc).__name__,
                    )
                    summary, sections = await complete_and_validate()
    except asyncio.TimeoutError as exc:
        logger.warning("LLM insight unavailable after bounded generation (%s)", type(exc).__name__)
        return unavailable("timeout", retryable=True)
    except InvalidInsightResponse as exc:
        logger.warning("LLM insight invalid after bounded repair (%s)", type(exc).__name__)
        return unavailable("invalid_response", retryable=True)
    except LLMError as exc:
        logger.warning("LLM insight unavailable after bounded generation (%s)", type(exc).__name__)
        return unavailable("provider_error", retryable=True)

    return {
        "engine": "llm",
        "model": model,
        "model_profile": profile.public_identity(),
        "summary": summary,
        "sections": sections,
        "generated_at": generated_at,
    }
