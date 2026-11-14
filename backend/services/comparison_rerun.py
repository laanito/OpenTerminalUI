"""One checked model attempt over frozen inputs, never fresh market collection."""
from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import math
import logging

from backend.services.comparison_briefing import (
    ComparisonBriefingResult, InvalidComparisonBriefing, unavailable_briefing, validate_comparison_briefing,
)
from backend.services.comparison_context_briefing import (
    ComparisonContextBriefingResult, unavailable_context_briefing, validate_context_briefing,
)
from backend.services.llm_client import get_llm_client
from backend.services.llm_profiles import LLMProfileIdentity
from backend.services.market_briefing_context_evidence import ComparisonContextEvidence
from backend.services.market_briefing_evidence import ComparisonBriefingEvidence


logger = logging.getLogger(__name__)

def saved_request(payload: dict) -> tuple[dict, int | None]:
    """Last actual dispatch, or a prepared rerun that never reached completion."""
    generation = payload["generation"]
    if generation.get("contract_version") != "comparison-capture-v1" or generation.get("protocol") != "openai_compatible_chat_completions":
        raise ValueError("Unsupported saved generation contract")
    attempts = generation.get("attempts", [])
    index = len(attempts) - 1 if attempts else None
    body = attempts[index].get("body") if index is not None else generation.get("prepared_request")
    if not isinstance(body, dict):
        raise ValueError("No recorded model request; refresh current data to start a new run")
    allowed = {"model", "messages", "temperature", "max_tokens", "stream", "response_format", "frequency_penalty"}
    if set(body) - allowed or body.get("stream") is not False or not isinstance(body.get("model"), str) or not body["model"]:
        raise ValueError("Unsupported saved model request")
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages or any(
        not isinstance(message, dict) or set(message) != {"role", "content"}
        or message["role"] not in {"system", "user", "assistant"} or not isinstance(message["content"], str)
        for message in messages
    ):
        raise ValueError("Unsupported saved messages")
    if type(body.get("max_tokens")) is not int or not 1 <= body["max_tokens"] <= 32768:
        raise ValueError("Unsupported saved token budget")
    for name in ("temperature", "frequency_penalty"):
        if name in body and (type(body[name]) not in (int, float) or not math.isfinite(body[name])):
            raise ValueError("Invalid saved generation parameter")
    if "response_format" in body and not isinstance(body["response_format"], dict):
        raise ValueError("Unsupported saved response format")
    return deepcopy(body), index


def checked_source(payload: dict):
    if payload.get("schema_version") != 1 or payload.get("mode") not in {"price", "context"}:
        raise ValueError("Unsupported saved capture format")
    raw = payload.get("result", {}).get("evidence")
    if raw is None:
        raise ValueError("No saved evidence; refresh current data to start a new run")
    model = ComparisonContextEvidence if payload["mode"] == "context" else ComparisonBriefingEvidence
    # Only construct a validation view. Stored/returned evidence stays verbatim.
    return model.model_validate(raw)


async def rerun_saved_inputs(payload, evidence, body, *, profile, on_phase=None):
    """Use the current Deep model with saved messages/schema/parameters unchanged."""
    attempts = []
    prepared = deepcopy(body)
    prepared["model"] = profile.model
    context = payload["mode"] == "context"
    unavailable = unavailable_context_briefing if context else unavailable_briefing
    validator = validate_context_briefing if context else validate_comparison_briefing
    result_type = ComparisonContextBriefingResult if context else ComparisonBriefingResult

    def phase(value):
        if on_phase is not None:
            on_phase(value)

    def record(request):
        attempts.append({"dispatched_at": datetime.now(timezone.utc).isoformat(), "body": request})

    if not profile.enabled:
        result = unavailable("disabled", evidence=evidence, profile=profile)
    else:
        failure = None
        try:
            async with asyncio.timeout(profile.timeout_seconds):
                phase("checking_model")
                client = get_llm_client(profile=profile)
                if not await client.health():
                    failure = "provider_unavailable"
                else:
                    phase("generating")
                    response = await client.chat_saved_request(prepared, on_request=record)
                    phase("validating")
                    parsed = validator(response, evidence)
        except TimeoutError:
            failure = "timeout"
        except InvalidComparisonBriefing:
            failure = "invalid_response"
        except Exception:
            # Never retain/log raw provider errors or unchecked completion text.
            failure = "provider_error"
        if failure:
            logger.warning("Saved-input comparison rerun failed (%s)", failure)
            result = unavailable(failure, evidence=evidence, profile=profile)
        else:
            fields = {name: getattr(parsed, name) for name in ("observations", "hypotheses", "limitations", "unknowns")}
            if context:
                fields["possible_context"] = parsed.possible_context
            result = result_type(
                status="complete", engine="llm", model=profile.model,
                model_profile=LLMProfileIdentity(**profile.public_identity()),
                generated_at=datetime.now(timezone.utc), evidence=evidence, **fields,
            )
    output = result.model_dump(mode="json")
    output["evidence"] = deepcopy(payload["result"]["evidence"])
    output["scope_notice"] = payload["result"]["scope_notice"]
    return output, {
        "contract_version": "comparison-capture-v1", "protocol": "openai_compatible_chat_completions",
        "profile": profile.public_identity(), "enabled": profile.enabled,
        "timeout_seconds": profile.timeout_seconds,
        "structured_output": prepared.get("response_format", {}).get("type", "none"),
        "prepared_request": prepared if not attempts else None, "attempts": attempts,
    }
