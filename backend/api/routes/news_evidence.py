"""Owner-only reads of retained scoring inputs; no live providers or inference."""
from __future__ import annotations

from datetime import timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models import User, NewsTextSnapshotORM, NewsSentimentAssessmentORM
from backend.services.news_evidence import RetainedAssessment, RetainedHeadline, get_text
from backend.config.settings import get_settings
from backend.services.news_evidence_lifecycle import (
    EvidenceLifecycle, EvidenceMissing, EvidencePinned, delete_unreferenced, lifecycle,
)

router = APIRouter(prefix="/api/news/evidence", tags=["market-context"])


class RetainedHeadlineRead(RetainedHeadline):
    retention: Literal["retained_no_automatic_expiry", "pinned_by_saved_analysis", "unreferenced_retention_window"]
    lifecycle: EvidenceLifecycle


def _date(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def retained_headlines(db, user_id, rows, *, embedded=False):
    if not rows:
        return []
    assessments = db.scalars(select(NewsSentimentAssessmentORM).where(
        NewsSentimentAssessmentORM.user_id == user_id,
        NewsSentimentAssessmentORM.snapshot_id.in_([row.id for row in rows]),
    ).order_by(NewsSentimentAssessmentORM.recorded_at, NewsSentimentAssessmentORM.id)).all()
    grouped = {row.id: [] for row in rows}
    for item in assessments:
        grouped[item.snapshot_id].append({"id": item.id, "recorded_at": _date(item.recorded_at), "payload": item.payload})
    # Preserve saved JSON exactly; no hydration through today's payload models.
    result = [{"id": row.id, "captured_at": _date(row.captured_at), "content_hash": row.content_hash,
             "retention": "retained_no_automatic_expiry", "payload": row.payload, "assessments": grouped[row.id]} for row in rows]
    if not embedded:
        states = lifecycle(db, user_id, rows, get_settings().news_evidence_retention_days)
        for record in result:
            state = states[record["id"]]
            record["lifecycle"] = state.model_dump(mode="json")
            record["retention"] = ("pinned_by_saved_analysis" if state.state == "pinned" else
                                   "retained_no_automatic_expiry" if state.state == "expiry_disabled" else "unreferenced_retention_window")
    return result


@router.get("", response_model=list[RetainedHeadlineRead])
def list_retained_headlines(
    limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0, le=10000),
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """Owner-only paginated history, including evidence whose source was deleted.

    Reads stored text/assessments without providers, scoring or current defaults.
    """
    from fastapi.encoders import jsonable_encoder
    from fastapi.responses import JSONResponse
    rows = db.scalars(select(NewsTextSnapshotORM).where(NewsTextSnapshotORM.user_id == user.id).order_by(
        NewsTextSnapshotORM.captured_at.desc(), NewsTextSnapshotORM.id.desc(),
    ).offset(offset).limit(limit)).all()
    return JSONResponse(jsonable_encoder(retained_headlines(db, user.id, rows)))


@router.get("/{snapshot_id}", response_model=RetainedHeadlineRead)
def read_headline(snapshot_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Read exact retained text and assessments, even after a source capture is deleted.

    No providers or scoring. Another owner's ID is indistinguishable from unknown.
    """
    from fastapi.encoders import jsonable_encoder
    from fastapi.responses import JSONResponse
    row = get_text(db, user_id=user.id, snapshot_id=snapshot_id)
    if row is None:
        raise HTTPException(status_code=404, detail="News evidence not found")
    return JSONResponse(jsonable_encoder(retained_headlines(db, user.id, [row])[0]))


@router.delete("/{snapshot_id}", status_code=204, responses={
    404: {"description": "Unknown or other-owner evidence."},
    409: {"description": "A saved briefing references this evidence; delete those runs first."},
    503: {"description": "Deletion could not be confirmed; refresh history before retrying."},
})
def delete_headline(snapshot_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Delete the owner's unreferenced text/assessment bundle, never a saved run."""
    try:
        delete_unreferenced(db, user.id, snapshot_id)
        db.commit()
    except EvidenceMissing as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail="News evidence not found") from exc
    except EvidencePinned as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Saved briefings use this evidence. Delete those runs first.") from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Deletion could not be confirmed. Refresh retained evidence before retrying.") from exc
    return Response(status_code=204)
