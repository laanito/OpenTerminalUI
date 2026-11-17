"""Explicit capture and offline retrieval; legacy generation remains ephemeral."""
from __future__ import annotations

from datetime import datetime, timezone
from contextlib import aclosing
from copy import deepcopy
import hashlib
import json
import logging
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_serializer
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.deps import get_db, get_unified_fetcher
from backend.api.routes import market_briefing as briefings
from backend.auth.deps import get_current_user
from backend.config.settings import get_settings
from backend.core.sec_edgar_client import get_sec_edgar_client
from backend.models import User, NewsTextSnapshotORM
from backend.models.comparison_capture import ComparisonCaptureORM
from backend.services.comparison_briefing import ComparisonBriefingResult
from backend.services.comparison_context_briefing import ComparisonContextBriefingResult
from backend.services.economic_data import get_economic_data_service
from backend.services.llm_profiles import LLMProfileIdentity, resolve_llm_profile
from backend.services.insight_lifecycle import stream_insight_lifecycle
from backend.services.captured_headline_sentiment import SelectedHeadlines, select_headlines, assess_headlines
from backend.services.news_evidence import capture_text, append_assessment
from backend.api.routes.news_evidence import RetainedHeadline, retained_headlines
from backend.services.comparison_rerun import checked_source, saved_request, rerun_saved_inputs
from backend.services.market_briefing_context_evidence import BriefingContextOptions
from backend.services.sentiment_context_evidence import SelectedSentiment, build_sentiment_context
from backend.services.comparison_context_briefing import generate_context_briefing

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


class CaptureLineage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["saved_input_rerun", "fresh_refresh", "retained_sentiment_interpretation"]
    parent_id: str = Field(min_length=1, max_length=36)
    parent_content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_generated_at: AwareDatetime
    replay_request_index: int | None = Field(default=None, ge=0)
    model_policy: Literal["current_deep"] = "current_deep"


class FollowupRequest(BaseModel):
    # Select an owned source by path only; never accept replacement evidence,
    # prompts, model parameters or browser-supplied lineage.
    model_config = ConfigDict(extra="forbid")


class CapturedGeneration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contract_version: Literal["comparison-capture-v1"] = "comparison-capture-v1"
    protocol: Literal["openai_compatible_chat_completions"] = "openai_compatible_chat_completions"
    profile: LLMProfileIdentity
    enabled: bool
    timeout_seconds: float
    structured_output: str
    attempts: list[CapturedModelRequest]
    prepared_request: dict | None = None


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
    lineage: CaptureLineage | None = None


class PriceCaptureContent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    lineage: CaptureLineage | None = None
    mode: Literal["price"]
    selection: ComparisonCaptureRequest
    generation: CapturedGeneration
    result: ComparisonBriefingResult


class ContextCaptureContent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    lineage: CaptureLineage | None = None
    mode: Literal["context"]
    selection: ComparisonCaptureRequest
    generation: CapturedGeneration
    result: ComparisonContextBriefingResult
    sentiment_sources: list[RetainedHeadline] | None = None

    @model_serializer(mode="wrap")
    def preserve_legacy_shape(self, handler):
        result = handler(self)
        if self.sentiment_sources is None:
            result.pop("sentiment_sources", None)
        return result


CaptureContent = Annotated[PriceCaptureContent | ContextCaptureContent, Field(discriminator="mode")]


class CaptureDetail(CaptureSummary):
    content: CaptureContent


def _summary(row, selection=None, lineage=None):
    if selection is None:
        selection = row.payload["selection"]
        lineage = row.payload.get("lineage")
    captured_at = row.captured_at
    if captured_at.tzinfo is None:  # SQLite DateTime drops timezone information.
        captured_at = captured_at.replace(tzinfo=timezone.utc)
    return CaptureSummary(
        id=row.id, captured_at=captured_at, mode=row.mode, status=row.status,
        anchor=selection["anchor"], comparisons=selection["comparisons"], period=selection["period"],
        content_hash=row.content_hash, lineage=lineage,
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
    expiry. Existing briefing endpoints remain ephemeral. Another initial POST
    fetches fresh evidence; separate follow-up endpoints rerun saved inputs or
    refresh a saved selection into a new linked capture.
    """
    return await _capture_briefing(payload, user, db, fetcher, economic_service, sec_client)


async def _capture_briefing(payload, user, db, fetcher, economic_service, sec_client, *, profile=None, on_phase=None, lineage=None):
    normalized = briefings._normalized_payload(payload)
    selection = ComparisonCaptureRequest(**normalized.model_dump(), context=payload.context)
    profile = profile or resolve_llm_profile(get_settings(), "comparison_briefing")
    attempts = []

    def record(body):
        attempts.append(CapturedModelRequest(dispatched_at=datetime.now(timezone.utc), body=body))

    selected = payload.context
    with_context = selected is not None and bool(selected.news or selected.macro_regions or selected.technical or selected.fundamentals)
    if with_context:
        request = briefings.ComparisonContextBriefingRequest(**normalized.model_dump(), context=selected)
        result = await briefings._run_context_briefing(
            request, user, fetcher, economic_service, profile=profile, on_request=record, on_phase=on_phase,
            **({"sec_client": sec_client} if selected.fundamentals else {}),
        )
        content_type, mode = ContextCaptureContent, "context"
    else:
        result = await briefings._run_briefing(normalized, user, fetcher, profile=profile, on_request=record, on_phase=on_phase)
        content_type, mode = PriceCaptureContent, "price"
    content = content_type(
        mode=mode, selection=selection, lineage=lineage,
        generation=CapturedGeneration(
            profile=LLMProfileIdentity(**profile.public_identity()), enabled=profile.enabled,
            timeout_seconds=profile.timeout_seconds, structured_output=profile.structured_output, attempts=attempts,
        ),
        result=result,
    )
    row = _store_content(db, user.id, content.model_dump(mode="json"), on_phase=on_phase)
    return CaptureDetail(**_summary(row).model_dump(), content=content)


def _store_content(db, user_id, content, *, on_phase=None):
    serialized = json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    if len(serialized.encode("utf-8")) > MAX_CAPTURE_BYTES:
        raise HTTPException(status_code=413, detail="Comparison capture exceeds the storage limit; nothing was saved")
    row = ComparisonCaptureORM(
        id=str(uuid4()), user_id=user_id, captured_at=datetime.now(timezone.utc), mode=content["mode"],
        status=content["result"]["status"], content_hash=hashlib.sha256(serialized.encode("utf-8")).hexdigest(),
        payload=json.loads(serialized),
    )
    if on_phase is not None:
        on_phase("saving_capture")
    try:
        db.add(row)
        db.commit()
        db.refresh(row)
    except Exception as exc:
        db.rollback()
        logger.warning("Comparison capture storage failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Comparison capture could not be saved; do not assume it is retained") from exc
    return row


def _receipt(row):
    return {**_summary(row).model_dump(mode="json"), "content": row.payload}


@router.post("/stream", response_class=StreamingResponse, responses={200: {"content": {
    "application/x-ndjson": {"schema": {"type": "string", "description": (
        "NDJSON start with source/model budgets, progress including saving_capture, "
        "and one final CaptureDetail only after commit, or a safe error. "
        "Disconnect cancels collection and synthesis; an interrupted acknowledgement "
        "can leave a completed capture, so list saved records before retrying."
    )}}
}}})
async def stream_capture(
    payload: ComparisonCaptureRequest,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
    fetcher=Depends(get_unified_fetcher), economic_service=Depends(get_economic_data_service),
    sec_client=Depends(get_sec_edgar_client),
):
    """Explicitly generate and retain with progress; existing ephemeral APIs remain unchanged."""
    normalized = briefings._normalized_payload(payload)  # Validate before 200 headers.
    selection = ComparisonCaptureRequest(**normalized.model_dump(), context=payload.context)
    profile = resolve_llm_profile(get_settings(), "comparison_briefing")
    return _stream_run(lambda phase: _capture_briefing(selection, user, db, fetcher, economic_service, sec_client,
                                                       profile=profile, on_phase=phase), profile)


def _stream_run(run, profile):
    phase = "preparing_evidence"
    failure = None

    def set_phase(value):
        nonlocal phase
        phase = value

    async def operation():
        nonlocal failure
        try:
            saved = await run(set_phase)
            return saved.model_dump(mode="json") if hasattr(saved, "model_dump") else saved
        except HTTPException as exc:
            if exc.status_code == 413:
                failure = {"code": "capture_too_large", "message": "Capture exceeds the storage limit; nothing was saved."}
            elif exc.status_code == 503:
                failure = {"code": "capture_not_confirmed", "message": "Saving could not be confirmed. Refresh saved briefings before retrying."}
            raise

    async def events():
        async with aclosing(stream_insight_lifecycle(operation)) as lifecycle:
            async for event in lifecycle:
                if event["type"] == "start":
                    event = {**event, "deadlines": {
                        "evidence_seconds": briefings.EVIDENCE_TIMEOUT_SECONDS,
                        "context_seconds": briefings.CONTEXT_TIMEOUT_SECONDS,
                        "model_seconds": profile.timeout_seconds,
                    }}
                elif event["type"] == "progress":
                    event = {**event, "phase": phase}
                elif event["type"] == "error" and failure is not None:
                    event = {**event, "error": failure}
                yield json.dumps(event, separators=(",", ":"), ensure_ascii=False) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson", headers={
        "Cache-Control": "no-store", "X-Accel-Buffering": "no",
    })


def _source_capture(db, user_id, capture_id):
    row = _owned(db, user_id, capture_id)
    payload = deepcopy(row.payload)
    try:
        serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        if hashlib.sha256(serialized.encode("utf-8")).hexdigest() != row.content_hash:
            raise ValueError("Changed stored content")
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=409, detail="Stored capture integrity check failed; no follow-up was started") from exc
    return row.id, row.content_hash, payload


def _lineage(capture_id, content_hash, payload, kind, index=None):
    return CaptureLineage(kind=kind, parent_id=capture_id, parent_content_hash=content_hash,
                          source_generated_at=payload["result"]["generated_at"], replay_request_index=index)


@router.post("/{capture_id}/rerun/stream", response_class=StreamingResponse,
             responses={200: {"content": {"application/x-ndjson": {"schema": {"type": "string", "description": "Progress and one committed CaptureDetail; no market collection. Uses the last saved request and current Deep model."}}}}})
async def stream_rerun(
    capture_id: str, payload: FollowupRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """Save a linked rerun of frozen prompts/settings with today's Deep model.

    Keep original messages, schema, response format and generation parameters;
    change only the model field to the current resolved Deep model. Perform one
    checked completion without augmentation, repair, format or token fallback.
    No source fetch or original-record rewrite. Providers/aliases may change.
    """
    source_id, digest, source = _source_capture(db, user.id, capture_id)
    try:
        evidence = checked_source(source)
        body, index = saved_request(source)
        lineage = _lineage(source_id, digest, source, "saved_input_rerun", index)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="Saved inputs cannot be rerun with this contract; inspect the original or refresh current data") from exc
    profile = resolve_llm_profile(get_settings(), "comparison_briefing")

    async def run(phase):
        result, generation = await rerun_saved_inputs(source, evidence, body, profile=profile, on_phase=phase)
        child = deepcopy(source)
        child.update(result=result, generation=generation, lineage=lineage.model_dump(mode="json"))
        return _receipt(_store_content(db, user.id, child, on_phase=phase))

    return _stream_run(run, profile)


@router.post("/{capture_id}/refresh/stream", response_class=StreamingResponse,
             responses={200: {"content": {"application/x-ndjson": {"schema": {"type": "string", "description": "Collect fresh evidence for the saved selection and return a new linked committed CaptureDetail."}}}}})
async def stream_refresh(
    capture_id: str, payload: FollowupRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db),
    fetcher=Depends(get_unified_fetcher), economic_service=Depends(get_economic_data_service), sec_client=Depends(get_sec_edgar_client),
):
    """Fetch current evidence for the owned saved selection and save a linked run.

    Sources, relative period window, prompts and Deep profile are current. The
    original capture is unchanged. The child embeds its own complete evidence.
    """
    source_id, digest, source = _source_capture(db, user.id, capture_id)
    try:
        if source.get("schema_version") != 1:
            raise ValueError("Unsupported capture")
        selection = ComparisonCaptureRequest.model_validate(source["selection"])
        briefings._normalized_payload(selection)
        lineage = _lineage(source_id, digest, source, "fresh_refresh")
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="Saved selection is not supported for refresh; the original is unchanged") from exc
    profile = resolve_llm_profile(get_settings(), "comparison_briefing")
    return _stream_run(lambda phase: _capture_briefing(selection, user, db, fetcher, economic_service, sec_client,
                                                       profile=profile, on_phase=phase, lineage=lineage), profile)


@router.post("/{capture_id}/sentiment", response_model=list[RetainedHeadline], status_code=201)
async def capture_headline_sentiment(
    capture_id: str, selection: SelectedHeadlines, user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """Assess up to ten explicitly selected saved headlines and retain both methods.

    Targets must match their saved news groups. Deduplicate exact repeated
    source/target observations across selected pair-local references. No live
    text fetch or legacy-score promotion. Fast judges asset implication;
    deterministic keyword tone is separate and never masks a failed model.
    Original capture/result stays unchanged; Deep interpretation is not rerun.
    One transaction stores the selected text plus independent assessments.
    Cache hits preserve original scoring times, model inputs and context identity.
    Retained until explicit future lifecycle policy; no automatic expiry.
    """
    texts = _selected_headlines(db, user.id, capture_id, selection)
    profile = resolve_llm_profile(get_settings(), "news_sentiment")
    return JSONResponse(await _capture_sentiment(texts, user, db, profile=profile), status_code=201)


@router.post("/{capture_id}/sentiment-briefing/stream", response_class=StreamingResponse,
             responses={200: {"content": {"application/x-ndjson": {"schema": {"type": "string", "description": "Checked Deep interpretation of explicitly selected retained assessments and frozen market context; final receipt only after saving a new linked run."}}}}})
async def stream_sentiment_briefing(
    capture_id: str, selection: SelectedSentiment, user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """Save a new interpretation without fetching sources or rescoring headlines.

    Select one to five retained headline observations from this owned source run.
    Embed complete original text/assessments/scoring inputs, separate methods and
    failures. Source and assessments remain unchanged; no automatic retry.
    """
    source_id, digest, source = _source_capture(db, user.id, capture_id)
    snapshots = db.scalars(select(NewsTextSnapshotORM).where(
        NewsTextSnapshotORM.user_id == user.id, NewsTextSnapshotORM.id.in_(selection.snapshot_ids),
    )).all()
    if len(snapshots) != len(selection.snapshot_ids):
        raise HTTPException(status_code=404, detail="Retained headline observation not found")
    by_id = {row.id: row for row in snapshots}
    try:
        original = checked_source(source)
        if source["mode"] != "context":
            raise ValueError("A saved news-context briefing is required")
        if original.model_dump(mode="json") != source["result"]["evidence"]:
            raise ValueError("Unsupported evidence extensions; do not silently discard saved context")
        sources = [RetainedHeadline.model_validate(row) for row in retained_headlines(
            db, user.id, [by_id[key] for key in selection.snapshot_ids],
        )]
        evidence = build_sentiment_context(original, sources, capture_id=source_id, content_hash=digest)
        lineage = _lineage(source_id, digest, source, "retained_sentiment_interpretation")
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="Choose distinct supported retained headlines from this saved news briefing") from exc
    profile = resolve_llm_profile(get_settings(), "comparison_briefing")

    async def run(phase):
        attempts = []
        def record(body):
            attempts.append(CapturedModelRequest(dispatched_at=datetime.now(timezone.utc), body=body))
        result = await generate_context_briefing(evidence, profile=profile, on_phase=phase, on_request=record)
        content = ContextCaptureContent(
            mode="context", selection=ComparisonCaptureRequest.model_validate(source["selection"]), lineage=lineage,
            sentiment_sources=sources, result=result,
            generation=CapturedGeneration(profile=LLMProfileIdentity(**profile.public_identity()), enabled=profile.enabled,
                                           timeout_seconds=profile.timeout_seconds, structured_output=profile.structured_output,
                                           attempts=attempts),
        )
        return _receipt(_store_content(db, user.id, content.model_dump(mode="json"), on_phase=phase))
    return _stream_run(run, profile)


def _selected_headlines(db, user_id, capture_id, selection):
    source_id, digest, source = _source_capture(db, user_id, capture_id)
    try:
        evidence = checked_source(source)
        texts = select_headlines(evidence, selection, capture_id=source_id, content_hash=digest)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="Select supported saved headlines and their source-group target symbols") from exc
    return texts


async def _capture_sentiment(texts, user, db, *, profile, on_phase=None):
    results = await assess_headlines(texts, profile=profile, user_id=user.id, on_phase=on_phase)
    rows = []
    try:
        for text, assessments in zip(texts, results, strict=True):
            row = capture_text(db, user_id=user.id, evidence=text)
            for assessment in assessments:
                append_assessment(db, user_id=user.id, snapshot_id=row.id, assessment=assessment)
            rows.append(row)
        if on_phase is not None:
            on_phase("saving_capture")
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("Headline sentiment storage failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Sentiment retention could not be confirmed; inspect retained evidence before retrying") from exc
    from fastapi.encoders import jsonable_encoder
    return jsonable_encoder(retained_headlines(db, user.id, rows))


@router.post("/{capture_id}/sentiment/stream", response_class=StreamingResponse, responses={200: {"content": {
    "application/x-ndjson": {"schema": {"type": "string", "description": "Progress with the Fast model budget and a final list of retained headline receipts only after commit. Closing cancels unfinished scoring; list retained records after uncertain acknowledgement."}}
}}})
async def stream_headline_sentiment(
    capture_id: str, selection: SelectedHeadlines, user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """Score explicit saved references with progress and cancellable unfinished work.

    Same selection/retention contract as synchronous scoring. Ownership, integrity
    and references are checked before headers; no live news collection or Deep
    synthesis. Cache hits preserve original inputs/times. A final receipt follows
    commit; disconnect cannot undo a completed commit. Never automatically retry.
    """
    texts = _selected_headlines(db, user.id, capture_id, selection)
    profile = resolve_llm_profile(get_settings(), "news_sentiment")
    return _stream_run(lambda phase: _capture_sentiment(texts, user, db, profile=profile, on_phase=phase), profile)


@router.get("/{capture_id}/sentiment", response_model=list[RetainedHeadline])
def list_headline_sentiment(
    capture_id: str, limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0, le=10000),
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """Owner-only retained assessments for this source ID, including a deleted source.

    No live fetch/model work or current-model defaults. Unknown and other-owner
    source IDs return an empty list. Each record remains independently readable.
    """
    from fastapi.encoders import jsonable_encoder
    rows = db.scalars(select(NewsTextSnapshotORM).where(
        NewsTextSnapshotORM.user_id == user.id,
        NewsTextSnapshotORM.payload["origin"]["capture_id"].as_string() == capture_id,
    ).order_by(NewsTextSnapshotORM.captured_at.desc(), NewsTextSnapshotORM.id.desc()).offset(offset).limit(limit)).all()
    return JSONResponse(jsonable_encoder(retained_headlines(db, user.id, rows)))


@router.get("", response_model=list[CaptureSummary])
def list_captures(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10000),
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """List this owner's captures without fetching sources or calling a model."""
    # Do not load up to 20 multi-megabyte evidence/input envelopes for a list.
    # SQLAlchemy JSON projection is portable on SQLite and PostgreSQL.
    rows = db.execute(select(
        ComparisonCaptureORM.id, ComparisonCaptureORM.captured_at, ComparisonCaptureORM.mode,
        ComparisonCaptureORM.status, ComparisonCaptureORM.content_hash,
        ComparisonCaptureORM.payload["selection"].label("selection"),
        ComparisonCaptureORM.payload["lineage"].label("lineage"),
    ).where(ComparisonCaptureORM.user_id == user.id).order_by(
        ComparisonCaptureORM.captured_at.desc(), ComparisonCaptureORM.id.desc(),
    ).offset(offset).limit(limit)).all()
    return [_summary(row, row.selection, row.lineage) for row in rows]


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
