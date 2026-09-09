"""add owner-scoped notes and portfolio tables

Revision ID: 0013_owner_scoped_notes_portfolios
Revises: 0012_remove_global_watchlists
Create Date: 2026-09-09

These tables were historically created by ``Base.metadata.create_all`` during
application startup, so existing installations may already have some or all of
them. The forward migration is intentionally additive and idempotent. Its
downgrade is a no-op because Alembic cannot distinguish tables created here from
pre-existing production tables and must never drop user notes or portfolios.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0013_owner_scoped_notes_portfolios"
down_revision = "0012_remove_global_watchlists"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return table_name in set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if not _has_table("portfolios"):
        op.create_table(
            "portfolios",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=128), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("benchmark_symbol", sa.String(length=32), nullable=True),
            sa.Column("currency", sa.String(length=8), nullable=False),
            sa.Column("starting_cash", sa.Float(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_portfolios_user_id", "portfolios", ["user_id"])
        op.create_index("ix_portfolios_name", "portfolios", ["name"])
        op.create_index(
            "ix_portfolios_benchmark_symbol",
            "portfolios",
            ["benchmark_symbol"],
        )
        op.create_index("ix_portfolios_created_at", "portfolios", ["created_at"])

    if not _has_table("portfolio_holdings"):
        op.create_table(
            "portfolio_holdings",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("portfolio_id", sa.String(length=36), nullable=False),
            sa.Column("symbol", sa.String(length=64), nullable=False),
            sa.Column("shares", sa.Float(), nullable=False),
            sa.Column("cost_basis_per_share", sa.Float(), nullable=False),
            sa.Column("purchase_date", sa.String(length=16), nullable=False),
            sa.Column("notes", sa.Text(), nullable=False),
            sa.Column("lot_id", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(
                ["portfolio_id"],
                ["portfolios.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "portfolio_id",
                "symbol",
                "lot_id",
                name="uq_portfolio_holding_portfolio_symbol_lot",
            ),
        )
        op.create_index(
            "ix_portfolio_holdings_portfolio_id",
            "portfolio_holdings",
            ["portfolio_id"],
        )
        op.create_index(
            "ix_portfolio_holdings_symbol",
            "portfolio_holdings",
            ["symbol"],
        )
        op.create_index(
            "ix_portfolio_holdings_created_at",
            "portfolio_holdings",
            ["created_at"],
        )

    if not _has_table("portfolio_transactions"):
        op.create_table(
            "portfolio_transactions",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("portfolio_id", sa.String(length=36), nullable=False),
            sa.Column("symbol", sa.String(length=64), nullable=False),
            sa.Column("type", sa.String(length=16), nullable=False),
            sa.Column("shares", sa.Float(), nullable=False),
            sa.Column("price", sa.Float(), nullable=False),
            sa.Column("date", sa.String(length=16), nullable=False),
            sa.Column("fees", sa.Float(), nullable=False),
            sa.Column("lot_id", sa.String(length=64), nullable=False),
            sa.Column("notes", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(
                ["portfolio_id"],
                ["portfolios.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        for column in ("portfolio_id", "symbol", "type", "date", "created_at"):
            op.create_index(
                f"ix_portfolio_transactions_{column}",
                "portfolio_transactions",
                [column],
            )

    if not _has_table("notes"):
        op.create_table(
            "notes",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("symbol", sa.String(length=64), nullable=True),
            sa.Column("context", sa.String(length=32), nullable=False),
            sa.Column("ref_id", sa.String(length=64), nullable=True),
            sa.Column("title", sa.String(length=256), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("tags", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        for column in ("user_id", "symbol", "context", "created_at"):
            op.create_index(f"ix_notes_{column}", "notes", [column])

    if not _has_table("api_keys"):
        op.create_table(
            "api_keys",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("key_prefix", sa.String(length=12), nullable=False),
            sa.Column("key_hash", sa.String(length=256), nullable=False),
            sa.Column("permissions", sa.String(length=20), nullable=False),
            sa.Column("is_active", sa.Integer(), nullable=False),
            sa.Column("last_used_at", sa.DateTime(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_api_keys_user_id", "api_keys", ["user_id"])
        op.create_index("ix_api_keys_key_prefix", "api_keys", ["key_prefix"])


def downgrade() -> None:
    # Safety migration: these tables may predate Alembic ownership in existing
    # installations, so a downgrade must not destroy user portfolios or notes.
    pass
