"""Add private exact-text snapshots and append-only sentiment assessments.

Revision ID: 0019_news_evidence
Revises: 0018_brain_technical_context
No legacy rewrite, inference, backfill or retention cleanup.
"""
from alembic import op
import sqlalchemy as sa

revision = "0019_news_evidence"
down_revision = "0018_brain_technical_context"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "news_text_snapshots" not in tables:
        op.create_table(
            "news_text_snapshots",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("content_hash", sa.String(64), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.UniqueConstraint("user_id", "id", name="uq_news_snapshot_owner_id"),
        )
    if "news_sentiment_assessments" not in tables:
        op.create_table(
            "news_sentiment_assessments",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column("snapshot_id", sa.String(36), nullable=False),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.ForeignKeyConstraint(
                ["user_id", "snapshot_id"], ["news_text_snapshots.user_id", "news_text_snapshots.id"],
                ondelete="CASCADE", name="fk_news_assessment_owner_snapshot",
            ),
        )
    for table, name, columns in (
        ("news_text_snapshots", "ix_news_snapshots_owner_time", ["user_id", "captured_at"]),
        ("news_sentiment_assessments", "ix_news_assessments_owner_snapshot", ["user_id", "snapshot_id"]),
    ):
        if name not in {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}:
            op.create_index(name, table, columns)


def downgrade() -> None:
    # Application rollback must not destroy captured research. Older versions
    # ignore these additive tables; re-upgrade is idempotent.
    pass
