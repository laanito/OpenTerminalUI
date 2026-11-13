"""Retain explicitly requested comparison evidence, model inputs and results.

Revision ID: 0020_comparison_captures
Revises: 0019_news_evidence
"""
from alembic import op
import sqlalchemy as sa

revision = "0020_comparison_captures"
down_revision = "0019_news_evidence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "comparison_captures" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "comparison_captures",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("mode", sa.String(16), nullable=False),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("content_hash", sa.String(64), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
        )
    indexes = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("comparison_captures")}
    if "ix_comparison_captures_owner_time" not in indexes:
        op.create_index("ix_comparison_captures_owner_time", "comparison_captures", ["user_id", "captured_at"])


def downgrade() -> None:
    # Preserve research during application rollback; old versions ignore it.
    pass
