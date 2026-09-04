"""remove ownerless watchlist items

Revision ID: 0012_remove_global_watchlists
Revises: 0011_saved_views
Create Date: 2026-09-04
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0012_remove_global_watchlists"
down_revision = "0011_saved_views"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return table_name in set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    # These rows never had an owner, so assigning them to private accounts would
    # copy installation-global data across security boundaries. The supported
    # owner-scoped watchlists table is already populated independently.
    if _has_table("watchlist_items"):
        op.drop_table("watchlist_items")


def downgrade() -> None:
    if _has_table("watchlist_items"):
        return
    op.create_table(
        "watchlist_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("watchlist_name", sa.String(length=64), nullable=False),
        sa.Column("ticker", sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_watchlist_items_id", "watchlist_items", ["id"])
    op.create_index("ix_watchlist_items_watchlist_name", "watchlist_items", ["watchlist_name"])
    op.create_index("ix_watchlist_items_ticker", "watchlist_items", ["ticker"])
