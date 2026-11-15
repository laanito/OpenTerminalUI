"""Owner-only reads of retained scoring inputs; no live providers or inference."""
from __future__ import annotations

from datetime import timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import AwareDatetime, BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models import User, NewsTextSnapshotORM, NewsSentimentAssessmentORM
from backend.services.news_evidence import NewsText, SentimentAssessment, get_text

router = APIRouter(prefix="/api/news/evidence", tags=["market-context"])


class RetainedAssessment(BaseModel):
    id: str
    recorded_at: AwareDatetime
    payload: SentimentAssessment


class RetainedHeadline(BaseModel):
    id: str
    captured_at: AwareDatetime
    content_hash: str
    retention: Literal["retained_no_automatic_expiry"] = "retained_no_automatic_expiry"
    payload: NewsText
    assessments: list[RetainedAssessment]


def _date(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def retained_headlines(db, user_id, rows):
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
    return [{"id": row.id, "captured_at": _date(row.captured_at), "content_hash": row.content_hash,
             "retention": "retained_no_automatic_expiry", "payload": row.payload, "assessments": grouped[row.id]} for row in rows]


@router.get("/{snapshot_id}", response_model=RetainedHeadline)
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
