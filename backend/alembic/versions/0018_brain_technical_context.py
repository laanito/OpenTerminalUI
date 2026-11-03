"""Retain explicitly saved Brain technical evidence, without rewriting old memos.

Revision ID: 0018_brain_technical_context
Revises: 0017_market_fund_captures
Create Date: 2026-11-03
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0018_brain_technical_context"
down_revision = "0017_market_fund_captures"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {str(column["name"]) for column in sa.inspect(op.get_bind()).get_columns("brain_memos")}
    if "technical_context" not in columns:
        # A nullable JSON column with no default/backfill preserves every old
        # record and uses native portable DDL on SQLite and PostgreSQL.
        op.add_column("brain_memos", sa.Column("technical_context", sa.JSON(), nullable=True))


def downgrade() -> None:
    # Preserve captured private research during application rollback, as 0016
    # does for the memo table. Older application versions ignore the new column.
    pass
