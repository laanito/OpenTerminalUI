"""Authenticated comparison evidence, synthesis and cancellable progress."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from contextlib import aclosing
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.api.deps import get_unified_fetcher
from backend.api.routes.market_context import (
    MarketComparisonRequest,
    MarketComparisonResponse,
    _symbol,
    compare_market_context,
)
from backend.auth.deps import get_current_user
from backend.config.settings import get_settings
from backend.services.llm_profiles import ResolvedLLMProfile, resolve_llm_profile
from backend.models import User
from backend.services.comparison_briefing import (
    BriefingPhase, ComparisonBriefingResult, generate_comparison_briefing, unavailable_briefing,
)
from backend.services.insight_lifecycle import stream_insight_lifecycle
from backend.services.economic_data import EconomicDataService, get_economic_data_service
from backend.services.comparison_context_briefing import (
    ComparisonContextBriefingResult, generate_context_briefing, unavailable_context_briefing,
)
from backend.services.market_briefing_context_collection import CONTEXT_TIMEOUT_SECONDS, collect_context_evidence
from backend.services.market_briefing_context_evidence import BriefingContextOptions, ComparisonContextEvidence
from backend.services.market_briefing_evidence import (
    ComparisonBriefingEvidence,
    build_comparison_evidence,
)

router = APIRouter(prefix="/api/market-context", tags=["market-context"])
EVIDENCE_TIMEOUT_SECONDS = 45.0
logger = logging.getLogger(__name__)


class ComparisonBriefingEvidenceRequest(BaseModel):
    # Accept selections, not browser-supplied returns, prose or citation claims.
    model_config = ConfigDict(extra="forbid")
    anchor: str = Field(min_length=1, max_length=40, examples=["AAPL"])
    comparisons: list[str] = Field(min_length=1, max_length=6, examples=[["SPY", "BTC-USD"]])
    period: Literal["1M", "3M", "6M"] = "1M"


def _normalized_payload(payload: ComparisonBriefingEvidenceRequest) -> ComparisonBriefingEvidenceRequest:
    anchor = _symbol(payload.anchor)
    comparisons = list(dict.fromkeys(_symbol(symbol) for symbol in payload.comparisons))
    if anchor in comparisons:
        raise HTTPException(status_code=422, detail="Anchor cannot be a comparison symbol")
    return ComparisonBriefingEvidenceRequest(anchor=anchor, comparisons=comparisons, period=payload.period)


@router.post(
    "/briefing-evidence", response_model=ComparisonBriefingEvidence,
    responses={504: {"description": "Evidence preparation timed out; no packet was created."}},
)
async def prepare_comparison_briefing_evidence(
    payload: ComparisonBriefingEvidenceRequest,
    user: User = Depends(get_current_user),
    fetcher: Any = Depends(get_unified_fetcher),
) -> ComparisonBriefingEvidence:
    """Fetch a fresh comparison and project citable, bounded evidence only.

    This does not generate a briefing, persist a snapshot or reuse the browser's
    previous response. Optional provider panels and private notes are excluded.
    """
    normalized = _normalized_payload(payload)
    selection = MarketComparisonRequest(
        anchor=normalized.anchor, comparisons=normalized.comparisons, period=normalized.period,
        # This packet intentionally covers only native provider-close returns;
        # avoid optional FX fetches even if a page has a reporting currency set.
        reporting_currency=None,
    )
    try:
        async with asyncio.timeout(EVIDENCE_TIMEOUT_SECONDS):
            result = await compare_market_context(selection, user, fetcher)
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail={
            "code": "evidence_timed_out",
            "message": "Comparison evidence preparation timed out; no packet was created.",
        }) from exc
    return build_comparison_evidence(MarketComparisonResponse.model_validate(result))


async def _run_briefing(
    payload: ComparisonBriefingEvidenceRequest, user: User, fetcher: Any,
    on_phase: Callable[[BriefingPhase], None] | None = None,
    *, profile: ResolvedLLMProfile | None = None,
) -> ComparisonBriefingResult:
    profile = profile or resolve_llm_profile(get_settings(), "comparison_briefing")
    if on_phase is not None:
        on_phase("preparing_evidence")
    try:
        evidence = await prepare_comparison_briefing_evidence(payload, user, fetcher)
    except HTTPException as exc:
        if exc.status_code != 504:
            raise
        logger.warning("Comparison briefing evidence preparation reached its deadline")
        return unavailable_briefing("evidence_timed_out", profile=profile)
    except Exception as exc:
        logger.warning("Comparison briefing evidence preparation failed (%s)", type(exc).__name__)
        raise
    return await generate_comparison_briefing(evidence, on_phase=on_phase, profile=profile)


@router.post("/briefing", response_model=ComparisonBriefingResult)
async def create_comparison_briefing(
    payload: ComparisonBriefingEvidenceRequest,
    user: User = Depends(get_current_user),
    fetcher: Any = Depends(get_unified_fetcher),
) -> ComparisonBriefingResult:
    """Prepare fresh evidence and generate a citation-linked descriptive briefing.

    Structure, snapshot identity and references are validated, not the truth of
    model prose. Evidence and its mandatory caveats remain attached on failure.
    This invokes no optional provider panels and saves/indexes nothing.
    """
    return await _run_briefing(_normalized_payload(payload), user, fetcher)


@router.post(
    "/briefing/stream", response_class=StreamingResponse,
    responses={200: {"content": {"application/x-ndjson": {"schema": {
        "type": "string", "description": (
            "NDJSON lifecycle: start (with evidence/model deadline budgets), "
            "progress (preparing_evidence/checking_model/"
            "generating/validating/retrying), and one final result containing a "
            "ComparisonBriefingResult, or an unexpected error. No raw prose deltas."
        ),
    }}}}},
)
async def stream_comparison_briefing(
    payload: ComparisonBriefingEvidenceRequest,
    user: User = Depends(get_current_user),
    fetcher: Any = Depends(get_unified_fetcher),
) -> StreamingResponse:
    """Stream progress and a final checked response; disconnect cancels work.

    Uses completion requests, not provider token streaming, so providers without
    streaming support work too. Unvalidated model text never enters this stream.
    See the synchronous briefing endpoint for the final result schema.
    """
    normalized = _normalized_payload(payload)  # Reject invalid symbols before 200 headers.
    profile = resolve_llm_profile(get_settings(), "comparison_briefing")
    phase: BriefingPhase = "preparing_evidence"

    def set_phase(value: BriefingPhase) -> None:
        nonlocal phase
        phase = value

    async def operation() -> dict[str, Any]:
        result = await _run_briefing(normalized, user, fetcher, set_phase, profile=profile)
        return result.model_dump(mode="json")

    async def events():
        async with aclosing(stream_insight_lifecycle(operation)) as lifecycle:
            async for event in lifecycle:
                if event["type"] == "start":
                    event = {**event, "deadlines": {
                        "evidence_seconds": EVIDENCE_TIMEOUT_SECONDS,
                        "model_seconds": profile.timeout_seconds,
                    }}
                elif event["type"] == "progress":
                    event = {**event, "phase": phase}
                yield json.dumps(event, separators=(",", ":")) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson", headers={
        "Cache-Control": "no-store", "X-Accel-Buffering": "no",
    })


class ComparisonContextBriefingRequest(ComparisonBriefingEvidenceRequest):
    context: BriefingContextOptions

    @model_validator(mode="after")
    def selected_context(self):
        if not self.context.news and not self.context.macro_regions:
            raise ValueError("Select news or a macro region; use /briefing for price-only synthesis")
        return self


@router.post(
    "/briefing-context-evidence", response_model=ComparisonContextEvidence,
    responses={504: {"description": "Price evidence timed out; no context packet was created."}},
)
async def prepare_context_briefing_evidence(
    payload: ComparisonContextBriefingRequest,
    user: User = Depends(get_current_user),
    fetcher: Any = Depends(get_unified_fetcher),
    economic_service: EconomicDataService = Depends(get_economic_data_service),
) -> ComparisonContextEvidence:
    """Fresh price plus explicitly selected news/regions; no model, save or index.

    Price preparation has a 45s budget, selected context a further 40s with up
    to three concurrent source jobs and 12s per job. Partial context survives
    its deadline; all references resolve within this exact returned snapshot.
    """
    price_payload = _normalized_payload(payload)
    price = await prepare_comparison_briefing_evidence(price_payload, user, fetcher)
    return await collect_context_evidence(price, payload.context, user=user, economic_service=economic_service)


async def _run_context_briefing(payload, user, fetcher, economic_service, on_phase=None, *, profile=None):
    profile = profile or resolve_llm_profile(get_settings(), "comparison_briefing")
    if on_phase:
        on_phase("preparing_evidence")
    try:
        price = await prepare_comparison_briefing_evidence(_normalized_payload(payload), user, fetcher)
    except HTTPException as exc:
        if exc.status_code != 504:
            raise
        return unavailable_context_briefing("evidence_timed_out", profile=profile)
    if on_phase:
        on_phase("collecting_context")
    evidence = await collect_context_evidence(price, payload.context, user=user, economic_service=economic_service)
    return await generate_context_briefing(evidence, on_phase=on_phase, profile=profile)


@router.post("/briefing-context", response_model=ComparisonContextBriefingResult)
async def create_context_briefing(
    payload: ComparisonContextBriefingRequest,
    user: User = Depends(get_current_user),
    fetcher: Any = Depends(get_unified_fetcher),
    economic_service: EconomicDataService = Depends(get_economic_data_service),
) -> ComparisonContextBriefingResult:
    """Opt-in dated context synthesis. No causal verification or investment advice.

    The complete price/context snapshot and fixed scope notice survive model
    failure. Citation validation checks references and coverage, not prose truth.
    Unselected v2.2 endpoints retain their price-only contract.
    """
    _normalized_payload(payload)
    return await _run_context_briefing(payload, user, fetcher, economic_service)


@router.post(
    "/briefing-context/stream", response_class=StreamingResponse,
    responses={200: {"content": {"application/x-ndjson": {"schema": {
        "type": "string", "description": (
            "NDJSON start with price/context/model budgets, progress phases including "
            "collecting_context, and one checked ComparisonContextBriefingResult or error. "
            "No raw model deltas; disconnect cancels collection and synthesis."
        ),
    }}}}},
)
async def stream_context_briefing(
    payload: ComparisonContextBriefingRequest,
    user: User = Depends(get_current_user),
    fetcher: Any = Depends(get_unified_fetcher),
    economic_service: EconomicDataService = Depends(get_economic_data_service),
) -> StreamingResponse:
    """Cancellable completion-based context synthesis, without automatic replay."""
    _normalized_payload(payload)  # Reject malformed symbols before 200 headers.
    profile = resolve_llm_profile(get_settings(), "comparison_briefing")
    phase: BriefingPhase = "preparing_evidence"

    def set_phase(value: BriefingPhase):
        nonlocal phase
        phase = value

    async def operation():
        result = await _run_context_briefing(payload, user, fetcher, economic_service, set_phase, profile=profile)
        return result.model_dump(mode="json")

    async def events():
        async with aclosing(stream_insight_lifecycle(operation)) as lifecycle:
            async for event in lifecycle:
                if event["type"] == "start":
                    event = {**event, "deadlines": {
                        "evidence_seconds": EVIDENCE_TIMEOUT_SECONDS,
                        "context_seconds": CONTEXT_TIMEOUT_SECONDS,
                        "model_seconds": profile.timeout_seconds,
                    }}
                elif event["type"] == "progress":
                    event = {**event, "phase": phase}
                yield json.dumps(event, separators=(",", ":")) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson", headers={
        "Cache-Control": "no-store", "X-Accel-Buffering": "no",
    })
