"""Private immutable evidence records; legacy public news remains separate."""
from __future__ import annotations

from datetime import datetime
from sqlalchemy import event, DateTime, ForeignKey, ForeignKeyConstraint, Index, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from backend.shared.db import Base


class NewsTextSnapshotORM(Base):
    __tablename__ = "news_text_snapshots"
    __table_args__ = (
        UniqueConstraint("user_id", "id", name="uq_news_snapshot_owner_id"),
        Index("ix_news_snapshots_owner_time", "user_id", "captured_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)


class NewsSentimentAssessmentORM(Base):
    __tablename__ = "news_sentiment_assessments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id", "snapshot_id"], ["news_text_snapshots.user_id", "news_text_snapshots.id"],
            ondelete="CASCADE", name="fk_news_assessment_owner_snapshot",
        ),
        Index("ix_news_assessments_owner_snapshot", "user_id", "snapshot_id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    snapshot_id: Mapped[str] = mapped_column(String(36), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)


# Guard ordinary ORM writes. This is an application append-only contract, not a
# tamper-proof archive: privileged SQL and explicit owner deletion remain possible.
@event.listens_for(NewsTextSnapshotORM, "before_update")
@event.listens_for(NewsSentimentAssessmentORM, "before_update")
def _reject_evidence_update(mapper, connection, target) -> None:
    raise ValueError("News evidence is append-only; create a new record")
