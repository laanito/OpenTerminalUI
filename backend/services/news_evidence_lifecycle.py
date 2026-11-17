"""Owner-serialized expiry/deletion of standalone evidence; saved runs stay intact.

References are detected conservatively in saved JSON, including embedded copies
and saved requests. A false positive retains extra evidence rather than dropping
an unknown reference. No existing payload or schema is rewritten.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Literal

from pydantic import AwareDatetime, BaseModel
from sqlalchemy import Text, case, cast, delete, exists, func, select

from backend.models import ComparisonCaptureORM, NewsSentimentAssessmentORM, NewsTextSnapshotORM, User


class EvidencePinned(ValueError):
    pass


class EvidenceMissing(ValueError):
    pass


class EvidenceLifecycle(BaseModel):
    state: Literal["pinned", "unreferenced", "expired", "expiry_disabled"]
    retention_days: int | None
    expires_at: AwareDatetime | None
    referencing_capture_ids: list[str]
    references_truncated: bool


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def lock_owner(db, user_id: str, *, skip_locked: bool = False) -> bool:
    """Short critical sections only, never during provider/model calls.

    SQLite ignores FOR UPDATE and SELECT may not start a DBAPI transaction.
    Reserve its writer before checking references. PostgreSQL uses a row lock.
    All capture/evidence writers and lifecycle deletes follow this same lock.
    """
    connection = db.connection()
    dialect = connection.dialect.name
    if dialect == "sqlite":
        driver = connection.connection.driver_connection
        if not driver.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
    elif dialect == "postgresql":
        if connection.get_isolation_level() != "READ COMMITTED":
            raise RuntimeError("Evidence lifecycle requires PostgreSQL READ COMMITTED isolation")
    else:
        raise RuntimeError("Evidence lifecycle supports SQLite and PostgreSQL only")
    owner = db.scalar(select(User.id).where(User.id == user_id).with_for_update(skip_locked=skip_locked))
    return owner is not None


def _referenced(user_id, snapshot_id):
    # Stored IDs are opaque UUID strings. A conservative substring check also
    # protects older/extended envelopes and references inside saved requests.
    return exists(select(ComparisonCaptureORM.id).where(
        ComparisonCaptureORM.user_id == user_id,
        cast(ComparisonCaptureORM.payload, Text).contains(snapshot_id),
    ))


def _last_recorded():
    latest = select(func.max(NewsSentimentAssessmentORM.recorded_at)).where(
        NewsSentimentAssessmentORM.user_id == NewsTextSnapshotORM.user_id,
        NewsSentimentAssessmentORM.snapshot_id == NewsTextSnapshotORM.id,
    ).correlate(NewsTextSnapshotORM).scalar_subquery()
    return case((latest > NewsTextSnapshotORM.captured_at, latest), else_=NewsTextSnapshotORM.captured_at)


def lifecycle(db, user_id: str, rows, retention_days: int | None, *, now: datetime | None = None):
    if retention_days is not None and not 1 <= retention_days <= 3650:
        raise ValueError("Retention days must be between 1 and 3650")
    now = utc(now or datetime.now(timezone.utc))
    if not rows:
        return {}
    latest = dict(db.execute(select(NewsTextSnapshotORM.id, _last_recorded()).where(
        NewsTextSnapshotORM.user_id == user_id, NewsTextSnapshotORM.id.in_([row.id for row in rows]),
    )).all())
    result = {}
    for row in rows:
        references = list(db.scalars(select(ComparisonCaptureORM.id).where(
            ComparisonCaptureORM.user_id == user_id, cast(ComparisonCaptureORM.payload, Text).contains(row.id),
        ).order_by(ComparisonCaptureORM.captured_at.desc(), ComparisonCaptureORM.id).limit(21)))
        expires = utc(latest[row.id]) + timedelta(days=retention_days) if retention_days is not None else None
        state = "pinned" if references else "expiry_disabled" if expires is None else "expired" if expires <= now else "unreferenced"
        result[row.id] = EvidenceLifecycle(state=state, retention_days=retention_days,
            expires_at=None if references else expires, referencing_capture_ids=references[:20], references_truncated=len(references) > 20)
    return result


def delete_unreferenced(db, user_id: str, snapshot_id: str) -> None:
    if not lock_owner(db, user_id):
        raise EvidenceMissing("Owner is unavailable")
    row = db.scalar(select(NewsTextSnapshotORM).where(
        NewsTextSnapshotORM.user_id == user_id, NewsTextSnapshotORM.id == snapshot_id,
    ).execution_options(populate_existing=True))
    if row is None:
        raise EvidenceMissing("Evidence is unavailable")
    if db.scalar(select(_referenced(user_id, snapshot_id))):
        raise EvidencePinned("Saved briefings reference this evidence")
    db.execute(delete(NewsSentimentAssessmentORM).where(
        NewsSentimentAssessmentORM.user_id == user_id, NewsSentimentAssessmentORM.snapshot_id == snapshot_id,
    ))
    db.delete(row)


def require_available(db, user_id: str, snapshot_ids: list[str]):
    """Called under the writer lock immediately before saving a new selection."""
    found = set(db.scalars(select(NewsTextSnapshotORM.id).where(
        NewsTextSnapshotORM.user_id == user_id, NewsTextSnapshotORM.id.in_(snapshot_ids),
    )))
    if found != set(snapshot_ids):
        raise EvidenceMissing("Selected evidence was removed before saving")


def prune_batch(session_factory, retention_days: int | None, *, limit: int = 100, now: datetime | None = None, user_id: str | None = None):
    if retention_days is None:
        return {"deleted": 0, "skipped": 0}
    if not 1 <= retention_days <= 3650 or not 1 <= limit <= 500:
        raise ValueError("Invalid cleanup bounds")
    cutoff = utc(now or datetime.now(timezone.utc)) - timedelta(days=retention_days)
    # Do not repeatedly select a page full of protected evidence and starve
    # later eligible records. Recheck age and references after the writer lock.
    with session_factory() as db:
        candidates = db.execute(select(NewsTextSnapshotORM.user_id, NewsTextSnapshotORM.id).where(
            _last_recorded() <= cutoff,
            ~_referenced(NewsTextSnapshotORM.user_id, NewsTextSnapshotORM.id),
            *([NewsTextSnapshotORM.user_id == user_id] if user_id is not None else []),
        ).order_by(NewsTextSnapshotORM.captured_at, NewsTextSnapshotORM.id).limit(limit)).all()
    grouped = defaultdict(list)
    for owner, identity in candidates:
        grouped[owner].append(identity)
    deleted, skipped = 0, 0
    for owner in sorted(grouped):
        with session_factory() as db:
            if not lock_owner(db, owner, skip_locked=True):
                skipped += len(grouped[owner])
                db.rollback()
                continue
            eligible = list(db.scalars(select(NewsTextSnapshotORM).where(
                NewsTextSnapshotORM.user_id == owner, NewsTextSnapshotORM.id.in_(grouped[owner]),
                _last_recorded() <= cutoff, ~_referenced(owner, NewsTextSnapshotORM.id),
            )))
            ids = [row.id for row in eligible]
            if ids:
                db.execute(delete(NewsSentimentAssessmentORM).where(
                    NewsSentimentAssessmentORM.user_id == owner, NewsSentimentAssessmentORM.snapshot_id.in_(ids),
                ))
                for row in eligible:
                    db.delete(row)
            db.commit()
            deleted += len(ids)
            skipped += len(grouped[owner]) - len(ids)
    return {"deleted": deleted, "skipped": skipped}
