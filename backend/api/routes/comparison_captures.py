"""Explicit capture and offline retrieval; legacy generation remains ephemeral."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import logging
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.deps import get_db, get_unified_fetcher
from backend.api.routes import market_briefing as briefings
from backend.auth.deps import get_current_user
from backend.config.settings import get_settings
from backend.core.sec_edgar_client import get_sec_edgar_client
from backend.models import User
from backend.models.comparison_capture import ComparisonCaptureORM
from backend.services.comparison_briefing import ComparisonBriefingResult
from backend.services.comparison_context_briefing import ComparisonContextBriefingResult
from backend.services.economic_data import get_economic_data_service
from backend.services.llm_profiles import LLMProfileIdentity, resolve_llm_profile
from backend.services.market_briefing_context_evidence import BriefingContextOptions

router = APIRouter(prefix="/api/market-context/briefing-captures", tags=["market-context"])
logger = logging.getLogger(__name__)
MAX_CAPTURE_BYTES = 4_000_000


class ComparisonCaptureRequest(briefings.ComparisonBriefingEvidenceRequest):
    context: BriefingContextOptions | None = None


class CapturedModelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dispatched_at: AwareDatetime
    # Exact JSON body dispatched by LLMClient, never its headers or endpoint.
    body: dict


class CapturedGeneration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contract_version: Literal["comparison-capture-v1"] = "comparison-capture-v1"
    protocol: Literal["openai_compatible_chat_completions"] = "openai_compatible_chat_completions"
    profile: LLMProfileIdentity
    enabled: bool
    timeout_seconds: float
    structured_output: str
    attempts: list[CapturedModelRequest]


class CaptureSummary(BaseModel):
    id: str
    captured_at: AwareDatetime
    mode: Literal["price", "context"]
    status: Literal["complete", "unavailable"]
    anchor: str
    comparisons: list[str]
    period: Literal["1M", "3M", "6M"]
    content_hash: str
    retention: Literal["retained_no_automatic_expiry"] = "retained_no_automatic_expiry"


class PriceCaptureContent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    mode: Literal["price"]
    selection: ComparisonCaptureRequest
    generation: CapturedGeneration
    result: ComparisonBriefingResult


class ContextCaptureContent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    mode: Literal["context"]
    selection: ComparisonCaptureRequest
    generation: CapturedGeneration
    result: ComparisonContextBriefingResult


CaptureContent = Annotated[PriceCaptureContent | ContextCaptureContent, Field(discriminator="mode")]


class CaptureDetail(CaptureSummary):
    content: CaptureContent


def _summary(row):
    selection = row.payload["selection"]
    captured_at = row.captured_at
    if captured_at.tzinfo is None:  # SQLite DateTime drops timezone information.
        captured_at = captured_at.replace(tzinfo=timezone.utc)
    return CaptureSummary(
        id=row.id, captured_at=captured_at, mode=row.mode, status=row.status,
        anchor=selection["anchor"], comparisons=selection["comparisons"], period=selection["period"],
        content_hash=row.content_hash,
    )


def _owned(db, user_id, capture_id):
    row = db.scalar(select(ComparisonCaptureORM).where(
        ComparisonCaptureORM.id == capture_id, ComparisonCaptureORM.user_id == user_id,
    ))
    if row is None:
        raise HTTPException(status_code=404, detail="Comparison capture not found")
    return row


@router.post("", response_model=CaptureDetail, status_code=201, responses={
    413: {"description": "Capture exceeds the storage limit; nothing was saved."},
    503: {"description": "Capture could not be saved; do not assume it is retained."},
})
async def create_capture(
    payload: ComparisonCaptureRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    fetcher=Depends(get_unified_fetcher),
    economic_service=Depends(get_economic_data_service),
    sec_client=Depends(get_sec_edgar_client),
) -> CaptureDetail:
    """Generate from fresh server-fetched selections and explicitly retain the run.

    Stores complete bounded evidence, checked answer or typed failure, and exact
    model request bodies (including client format/token retries and repair).
    No browser-supplied result/provenance is accepted. No indexing or automatic
    expiry. Existing briefing endpoints remain ephemeral. No captured-input rerun
    is exposed yet; another POST fetches new evidence and creates a new capture.
    """
    normalized = briefings._normalized_payload(payload)
    selection = ComparisonCaptureRequest(**normalized.model_dump(), context=payload.context)
    profile = resolve_llm_profile(get_settings(), "comparison_briefing")
    attempts = []

    def record(body):
        attempts.append(CapturedModelRequest(dispatched_at=datetime.now(timezone.utc), body=body))

    selected = payload.context
    with_context = selected is not None and bool(selected.news or selected.macro_regions or selected.technical or selected.fundamentals)
    if with_context:
        request = briefings.ComparisonContextBriefingRequest(**normalized.model_dump(), context=selected)
        result = await briefings._run_context_briefing(
            request, user, fetcher, economic_service, profile=profile, on_request=record,
            **({"sec_client": sec_client} if selected.fundamentals else {}),
        )
        content_type, mode = ContextCaptureContent, "context"
    else:
        result = await briefings._run_briefing(normalized, user, fetcher, profile=profile, on_request=record)
        content_type, mode = PriceCaptureContent, "price"
    content = content_type(
        mode=mode, selection=selection,
        generation=CapturedGeneration(
            profile=LLMProfileIdentity(**profile.public_identity()), enabled=profile.enabled,
            timeout_seconds=profile.timeout_seconds, structured_output=profile.structured_output, attempts=attempts,
        ),
        result=result,
    )
    serialized = json.dumps(content.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    if len(serialized.encode("utf-8")) > MAX_CAPTURE_BYTES:
        raise HTTPException(status_code=413, detail="Comparison capture exceeds the storage limit; nothing was saved")
    row = ComparisonCaptureORM(
        id=str(uuid4()), user_id=user.id, captured_at=datetime.now(timezone.utc), mode=mode,
        status=result.status, content_hash=hashlib.sha256(serialized.encode("utf-8")).hexdigest(),
        payload=json.loads(serialized),
    )
    try:
        db.add(row)
        db.commit()
        db.refresh(row)
    except Exception as exc:
        db.rollback()
        logger.warning("Comparison capture storage failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Comparison capture could not be saved; do not assume it is retained") from exc
    return CaptureDetail(**_summary(row).model_dump(), content=content)


@router.get("", response_model=list[CaptureSummary])
def list_captures(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10000),
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """List this owner's captures without fetching sources or calling a model."""
    rows = db.scalars(select(ComparisonCaptureORM).where(ComparisonCaptureORM.user_id == user.id).order_by(
        ComparisonCaptureORM.captured_at.desc(), ComparisonCaptureORM.id.desc(),
    ).offset(offset).limit(limit)).all()
    return [_summary(row) for row in rows]


@router.get("/{capture_id}", response_model=CaptureDetail)
def get_capture(capture_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Reopen the original evidence/result, without refreshing or inference."""
    row = _owned(db, user.id, capture_id)
    # Saved JSON is the authority. Revalidating through today's generation
    # models could add defaults or strip fields as those models evolve.
    return JSONResponse({**_summary(row).model_dump(mode="json"), "content": row.payload})


@router.delete("/{capture_id}", status_code=204)
def delete_capture(capture_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Explicitly delete the owner's self-contained capture and embedded evidence."""
    db.delete(_owned(db, user.id, capture_id))
    db.commit()
    return Response(status_code=204)
