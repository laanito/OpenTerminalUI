"""Add owner-scoped, explicit market fundamentals captures.

Revision ID: 0017_market_fund_captures
Revises: 0016_brain_memos
Create Date: 2026-10-04

Existing ``fundamentals_pit`` rows remain untouched. Historical provider
vintages are not backfilled by this migration.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0017_market_fund_captures"
down_revision = "0016_brain_memos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "market_fundamental_captures" not in inspector.get_table_names():
        op.create_table(
            "market_fundamental_captures",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("symbol", sa.String(length=64), nullable=False),
            sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("examined_count", sa.Integer(), nullable=False),
            sa.Column("records", sa.JSON(), nullable=False),
            sa.Column("content_hash", sa.String(length=64), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    indexes = {str(index["name"]) for index in sa.inspect(op.get_bind()).get_indexes("market_fundamental_captures")}
    if "ix_fund_captures_owner_symbol_time" not in indexes:
        op.create_index(
            "ix_fund_captures_owner_symbol_time", "market_fundamental_captures",
            ["user_id", "symbol", "captured_at"], unique=False,
        )


def downgrade() -> None:
    # Preserve historical observations across application-version rollbacks.
    pass
