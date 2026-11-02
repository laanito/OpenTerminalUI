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


def _insight_text(raw: Any, field: str, limit: int) -> str:
    # Diagnostics must never echo provider text or private research into logs
    # or the repair instruction. Paths and type/length metadata are sufficient.
    if not isinstance(raw, str):
        raise InvalidInsightResponse(f"{field} must be a string (received {type(raw).__name__})")
    text = raw.strip()
    if not text or len(text) > limit:
        raise InvalidInsightResponse(
            f"{field} must contain 1–{limit} characters after trimming (received {len(text)})"
        )
    return text


def _validate_insight(raw: Any) -> tuple[str, list[dict[str, Any]]]:
    if not isinstance(raw, dict):
        raise InvalidInsightResponse("Insight response is not an object")
    summary = _insight_text(raw.get("summary"), "summary", 600)
    raw_sections = raw.get("sections")
    if (
        not isinstance(raw_sections, list)
        or not 2 <= len(raw_sections) <= 4
    ):
        raise InvalidInsightResponse("sections must be an array containing 2–4 sections")
    sections: list[dict[str, Any]] = []
    for section_index, node in enumerate(raw_sections):
        path = f"sections[{section_index}]"
        if not isinstance(node, dict):
            raise InvalidInsightResponse(f"{path} must be an object")
        title = _insight_text(node.get("title"), f"{path}.title", 48)
        tone = node.get("tone")
        points = node.get("points")
        if not isinstance(tone, str) or tone not in _VALID_TONES:
            raise InvalidInsightResponse(f"{path}.tone must be positive, negative or neutral")
        if not isinstance(points, list) or not 1 <= len(points) <= 5:
            raise InvalidInsightResponse(f"{path}.points must be an array containing 1–5 strings")
        clean_points: list[str] = []
        for point_index, point in enumerate(points):
            clean_points.append(_insight_text(point, f"{path}.points[{point_index}]", 220))
        sections.append({"title": title, "tone": tone, "points": clean_points})
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

    def repair_messages(error: InvalidInsightResponse) -> list[dict[str, str]]:
        return [*messages, {
            "role": "system",
            "content": (
                f"The previous response failed validation: {error}. "
                "Regenerate the complete insight as one JSON object using only the original evidence. "
                "Use a nonempty summary of at most 600 characters, 2–4 sections, titles of at most "
                "48 characters, tone positive/negative/neutral, and 1–5 nonempty string points per "
                "section, each at most 220 characters. Shorten wording where necessary while "
                "preserving meaning and uncertainty. Do not include this feedback or invent facts."
            ),
        }]

    async def complete_and_validate(
        stream_error: InvalidInsightResponse | None = None,
    ) -> tuple[str, list[dict[str, Any]]]:
        content = await client.chat(
            repair_messages(stream_error) if stream_error else messages,
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
                repair_messages(exc),
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
                        str(exc) if isinstance(exc, InvalidInsightResponse) else type(exc).__name__,
                    )
                    summary, sections = await complete_and_validate(
                        exc if isinstance(exc, InvalidInsightResponse) else None
                    )
    except asyncio.TimeoutError as exc:
        logger.warning("LLM insight unavailable after bounded generation (%s)", type(exc).__name__)
        return unavailable("timeout", retryable=True)
    except InvalidInsightResponse as exc:
        logger.warning("LLM insight invalid after bounded repair: %s", exc)
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
