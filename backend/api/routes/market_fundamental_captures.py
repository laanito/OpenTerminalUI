"""Explicit, owner-scoped snapshots of currently retrieved fundamentals."""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import date, datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db, get_unified_fetcher
from backend.api.routes.market_context import _symbol
from backend.auth.deps import get_current_user
from backend.models import FundamentalCaptureORM, User
from backend.services.fundamental_evidence import source_dated_candidates


router = APIRouter(prefix="/api/market-context/fundamental-captures", tags=["market-context"])
logger = logging.getLogger(__name__)


class FundamentalCaptureRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=40, examples=["AAPL"])


class CapturedFundamentalRecord(BaseModel):
    release_date: date
    fiscal_period_end: date
    metric: Literal["revenue", "net_income", "eps", "free_cash_flow"]
    value: float
    source: str


class FundamentalCaptureSummary(BaseModel):
    id: str
    symbol: str
    captured_at: datetime
    status: Literal["records_observed", "no_eligible_records_observed", "fetch_error"]
    examined_count: int
    record_count: int
    content_hash: str
    evidence_scope: Literal["terminal_observation_only"] = "terminal_observation_only"


class FundamentalCaptureDetail(FundamentalCaptureSummary):
    records: list[CapturedFundamentalRecord]


def _summary(row: FundamentalCaptureORM) -> dict[str, Any]:
    captured_at = row.captured_at
    if captured_at.tzinfo is None:
        # SQLite drops timezone information; capture timestamps are always UTC.
        captured_at = captured_at.replace(tzinfo=timezone.utc)
    return {
        "id": row.id,
        "symbol": row.symbol,
        "captured_at": captured_at,
        "status": row.status,
        "examined_count": row.examined_count,
        "record_count": len(row.records),
        "content_hash": row.content_hash,
        "evidence_scope": "terminal_observation_only",
    }


@router.post("", response_model=FundamentalCaptureDetail, status_code=201)
async def capture_fundamentals(
    payload: FundamentalCaptureRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    fetcher: Any = Depends(get_unified_fetcher),
) -> dict[str, Any]:
    """Record what this terminal observed now, never a backdated market vintage."""
    symbol = _symbol(payload.symbol)
    try:
        raw = await fetcher.fetch_pit_fundamentals_records(symbol)
        if not isinstance(raw, list):
            raise ValueError("Unexpected fundamentals response")
        candidates = source_dated_candidates(raw)
        status = "records_observed" if candidates else "no_eligible_records_observed"
        examined_count = len(raw)
    except Exception as exc:
        # Provider exceptions can carry tokenized URLs. Do not persist or log them.
        logger.warning("Fundamental capture failed for %s (%s)", symbol, type(exc).__name__)
        candidates = []
        status = "fetch_error"
        examined_count = 0

    records = [{
        **candidate,
        "release_date": candidate["release_date"].isoformat(),
        "fiscal_period_end": candidate["fiscal_period_end"].isoformat(),
    } for candidate in candidates]
    canonical = json.dumps({"status": status, "records": records}, sort_keys=True, separators=(",", ":"))
    row = FundamentalCaptureORM(
        user_id=current_user.id,
        symbol=symbol,
        captured_at=datetime.now(timezone.utc),
        status=status,
        examined_count=examined_count,
        records=records,
        content_hash=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {**_summary(row), "records": row.records}


@router.get("", response_model=list[FundamentalCaptureSummary])
def list_fundamental_captures(
    symbol: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    query = db.query(FundamentalCaptureORM).filter(FundamentalCaptureORM.user_id == current_user.id)
    if symbol is not None:
        query = query.filter(FundamentalCaptureORM.symbol == _symbol(symbol))
    rows = query.order_by(FundamentalCaptureORM.captured_at.desc(), FundamentalCaptureORM.id.desc()).limit(limit).all()
    return [_summary(row) for row in rows]


@router.get("/{capture_id}", response_model=FundamentalCaptureDetail)
def get_fundamental_capture(
    capture_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    row = db.query(FundamentalCaptureORM).filter(
        FundamentalCaptureORM.id == capture_id,
        FundamentalCaptureORM.user_id == current_user.id,
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Capture not found")
    return {**_summary(row), "records": row.records}


@router.delete("/{capture_id}", status_code=204)
def delete_fundamental_capture(
    capture_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    row = db.query(FundamentalCaptureORM).filter(
        FundamentalCaptureORM.id == capture_id,
        FundamentalCaptureORM.user_id == current_user.id,
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Capture not found")
    db.delete(row)
    db.commit()
    return Response(status_code=204)
