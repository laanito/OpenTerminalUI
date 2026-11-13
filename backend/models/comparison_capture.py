"""Owner-scoped, self-contained comparison research retained on explicit request."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String, event
from sqlalchemy.orm import Mapped, mapped_column
from backend.shared.db import Base


class ComparisonCaptureORM(Base):
    __tablename__ = "comparison_captures"
    __table_args__ = (Index("ix_comparison_captures_owner_time", "user_id", "captured_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)


@event.listens_for(ComparisonCaptureORM, "before_update")
def _reject_update(mapper, connection, target) -> None:
    raise ValueError("Comparison captures are immutable; create a new capture")
