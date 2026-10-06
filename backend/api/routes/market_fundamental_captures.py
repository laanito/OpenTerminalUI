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


class ObservedFundamentalsAsOf(BaseModel):
    contract_version: Literal[1] = 1
    symbol: str
    requested_as_of: datetime
    selection_status: Literal["capture_found", "no_retained_capture"]
    selection_basis: Literal[
        "latest_retained_owner_capture_at_or_before_requested_at"
    ] = "latest_retained_owner_capture_at_or_before_requested_at"
    evidence_scope: Literal["terminal_observation_only"] = "terminal_observation_only"
    capture: FundamentalCaptureDetail | None


class ObservedFundamentalDelta(BaseModel):
    release_date: date
    fiscal_period_end: date
    metric: Literal["revenue", "net_income", "eps", "free_cash_flow"]
    source: str
    kind: Literal["only_in_earlier", "only_in_later", "value_set_different"]
    earlier_values: list[float]
    later_values: list[float]


class ObservedFundamentalsDeltaResponse(BaseModel):
    contract_version: Literal[1] = 1
    evidence_scope: Literal["terminal_observation_only"] = "terminal_observation_only"
    comparison_basis: Literal["retained_capture_candidate_sets"] = "retained_capture_candidate_sets"
    symbol: str
    earlier_capture: FundamentalCaptureSummary
    later_capture: FundamentalCaptureSummary
    comparison_status: Literal["comparable", "unavailable"]
    reason: Literal["earlier_capture_not_records_observed", "later_capture_not_records_observed"] | None
    unchanged_identity_count: int
    deltas: list[ObservedFundamentalDelta]


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


@router.get("/observed-as-of", response_model=ObservedFundamentalsAsOf)
def get_observed_fundamentals_as_of(
    symbol: str,
    as_of: datetime = Query(
        description="Timezone-aware instant; selects the latest retained owner capture at or before this UTC instant."
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Return terminal-observed state, not a provider or market historical vintage."""
    normalized_symbol = _symbol(symbol)
    if as_of.utcoffset() is None:
        raise HTTPException(status_code=422, detail="as_of must include a timezone offset")
    requested_at = as_of.astimezone(timezone.utc)
    row = (
        db.query(FundamentalCaptureORM)
        .filter(
            FundamentalCaptureORM.user_id == current_user.id,
            FundamentalCaptureORM.symbol == normalized_symbol,
            FundamentalCaptureORM.captured_at <= requested_at,
        )
        .order_by(FundamentalCaptureORM.captured_at.desc(), FundamentalCaptureORM.id.desc())
        .first()
    )
    return {
        "symbol": normalized_symbol,
        "requested_as_of": requested_at,
        "selection_status": "capture_found" if row is not None else "no_retained_capture",
        "capture": {**_summary(row), "records": row.records} if row is not None else None,
    }


def _capture_value_sets(row: FundamentalCaptureORM) -> dict[tuple[str, str, str, str], set[float]]:
    values: dict[tuple[str, str, str, str], set[float]] = {}
    for record in row.records:
        identity = (
            record["release_date"], record["fiscal_period_end"],
            record["metric"], record["source"],
        )
        values.setdefault(identity, set()).add(float(record["value"]))
    return values


@router.get("/observed-delta", response_model=ObservedFundamentalsDeltaResponse)
def compare_observed_fundamentals(
    from_id: str = Query(min_length=1, max_length=36),
    to_id: str = Query(min_length=1, max_length=36),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Compare retained candidate sets without inferring provider revisions."""
    rows = db.query(FundamentalCaptureORM).filter(
        FundamentalCaptureORM.user_id == current_user.id,
        FundamentalCaptureORM.id.in_([from_id, to_id]),
    ).all()
    by_id = {row.id: row for row in rows}
    if from_id not in by_id or to_id not in by_id:
        raise HTTPException(status_code=404, detail="Capture not found")
    earlier, later = by_id[from_id], by_id[to_id]
    if earlier.symbol != later.symbol or earlier.id == later.id:
        raise HTTPException(status_code=422, detail="Select two distinct captures for the same symbol")
    if _summary(earlier)["captured_at"] >= _summary(later)["captured_at"]:
        raise HTTPException(status_code=422, detail="from_id must precede to_id by capture time")

    result: dict[str, Any] = {
        "symbol": earlier.symbol,
        "earlier_capture": _summary(earlier),
        "later_capture": _summary(later),
        "comparison_status": "unavailable",
        "reason": None,
        "unchanged_identity_count": 0,
        "deltas": [],
    }
    if earlier.status != "records_observed":
        result["reason"] = "earlier_capture_not_records_observed"
        return result
    if later.status != "records_observed":
        result["reason"] = "later_capture_not_records_observed"
        return result

    first_values = _capture_value_sets(earlier)
    last_values = _capture_value_sets(later)
    result["comparison_status"] = "comparable"
    for identity in sorted(first_values.keys() | last_values.keys()):
        first = first_values.get(identity, set())
        last = last_values.get(identity, set())
        if first == last:
            result["unchanged_identity_count"] += 1
            continue
        kind = "only_in_earlier" if not last else "only_in_later" if not first else "value_set_different"
        result["deltas"].append({
            "release_date": identity[0],
            "fiscal_period_end": identity[1],
            "metric": identity[2],
            "source": identity[3],
            "kind": kind,
            "earlier_values": sorted(first),
            "later_values": sorted(last),
        })
    return result


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
