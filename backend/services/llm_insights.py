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
from contextlib import aclosing
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

# Safety ceilings, independent of the card's preferred writing style. A slightly
# longer explanation must not invalidate otherwise useful, structured analysis.
_MAX_SUMMARY_CHARS = 2_000
_MAX_TITLE_CHARS = 160
_MAX_POINT_CHARS = 2_000
_MAX_INSIGHT_CHARS = 16_000
_MAX_RESPONSE_CHARS = 64_000
_STYLE_GUIDANCE = (
    "Keep the insight readable and concise, with short section titles. Prefer a summary "
    "within 600 characters and focused bullet points around 220 characters. These are "
    "writing preferences, not hard limits: use more space when necessary to preserve "
    "meaning, evidence and uncertainty."
)


class InvalidInsightResponse(LLMError):
    """The provider answered, but the insight did not satisfy our contract."""


# Unified structured-output schema shared by every insight endpoint so a single
# frontend card can render all of them.
INSIGHT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "maxLength": _MAX_SUMMARY_CHARS},
        "sections": {
            "type": "array",
            "minItems": 2,
            "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "maxLength": _MAX_TITLE_CHARS},
                    "tone": {"type": "string", "enum": ["positive", "negative", "neutral"]},
                    "points": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 5,
                        "items": {"type": "string", "maxLength": _MAX_POINT_CHARS},
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
    summary = _insight_text(raw.get("summary"), "summary", _MAX_SUMMARY_CHARS)
    raw_sections = raw.get("sections")
    if (
        not isinstance(raw_sections, list)
        or not 2 <= len(raw_sections) <= 4
    ):
        raise InvalidInsightResponse("sections must be an array containing 2–4 sections")
    sections: list[dict[str, Any]] = []
    total_chars = len(summary)
    for section_index, node in enumerate(raw_sections):
        path = f"sections[{section_index}]"
        if not isinstance(node, dict):
            raise InvalidInsightResponse(f"{path} must be an object")
        title = _insight_text(node.get("title"), f"{path}.title", _MAX_TITLE_CHARS)
        tone = node.get("tone")
        points = node.get("points")
        if not isinstance(tone, str) or tone not in _VALID_TONES:
            raise InvalidInsightResponse(f"{path}.tone must be positive, negative or neutral")
        if not isinstance(points, list) or not 1 <= len(points) <= 5:
            raise InvalidInsightResponse(f"{path}.points must be an array containing 1–5 strings")
        clean_points: list[str] = []
        for point_index, point in enumerate(points):
            clean_points.append(_insight_text(point, f"{path}.points[{point_index}]", _MAX_POINT_CHARS))
        total_chars += len(title) + sum(map(len, clean_points))
        if total_chars > _MAX_INSIGHT_CHARS:
            raise InvalidInsightResponse(
                f"insight text must contain at most {_MAX_INSIGHT_CHARS} characters total "
                f"(received at least {total_chars})"
            )
        sections.append({"title": title, "tone": tone, "points": clean_points})
    return summary, sections


def _parse_insight(content: str) -> tuple[str, list[dict[str, Any]]]:
    if len(content) > _MAX_RESPONSE_CHARS:
        raise InvalidInsightResponse(
            f"JSON response must contain at most {_MAX_RESPONSE_CHARS} characters "
            f"(received {len(content)})"
        )
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
    validate_result: Callable[[str, list[dict[str, Any]]], None] | None = None,
) -> dict[str, Any]:
    """Produce a `{summary, sections}` insight, falling back gracefully.

    Returns ``engine: "llm"`` when the model answered, ``"unavailable"``
    when LLM is off/unreachable or the response could not be used.

    ``validate_result`` is a server-owned structural/reference check. It may
    raise InvalidInsightResponse with safe field/reference diagnostics only:
    these messages enter logs and bounded repair, never echo private/model text.
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
        {"role": "system", "content": f"{system_prompt}\n\n{_STYLE_GUIDANCE}"},
        {"role": "user", "content": user_content},
    ]

    def parse_result(content: str) -> tuple[str, list[dict[str, Any]]]:
        summary, sections = _parse_insight(content)
        if validate_result is not None:
            validate_result(summary, sections)
        return summary, sections

    def repair_messages(error: InvalidInsightResponse) -> list[dict[str, str]]:
        return [*messages, {
            "role": "system",
            "content": (
                f"The previous response failed validation: {error}. "
                "Regenerate the complete insight as one JSON object using only the original evidence. "
                f"Use a nonempty summary of at most {_MAX_SUMMARY_CHARS} characters, 2–4 sections, "
                f"titles of at most {_MAX_TITLE_CHARS} characters, tone positive/negative/neutral, "
                f"and 1–5 nonempty string points per section, each at most {_MAX_POINT_CHARS} "
                f"characters. Keep all insight text within {_MAX_INSIGHT_CHARS} characters total "
                f"and the JSON response within {_MAX_RESPONSE_CHARS} characters. "
                "These are safety ceilings, not writing targets. Shorten wording where necessary while "
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
            return parse_result(content)
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
            return parse_result(content)

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
                stream_chars = 0
                try:
                    async with aclosing(client.chat_stream(
                        messages,
                        temperature=0.3,
                        max_tokens=max_tokens,
                        json_schema=INSIGHT_SCHEMA,
                        frequency_penalty=0.3,
                    )) as stream:
                        async for chunk in stream:
                            stream_chars += len(chunk)
                            if stream_chars > _MAX_RESPONSE_CHARS:
                                raise InvalidInsightResponse(
                                    f"JSON response must contain at most {_MAX_RESPONSE_CHARS} characters "
                                    f"(received at least {stream_chars})"
                                )
                            chunks.append(chunk)
                            on_token(chunk)
                    if not chunks:
                        raise LLMError("LLM stream returned no response text")
                    summary, sections = parse_result("".join(chunks))
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
