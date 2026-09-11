"""add explicit portfolio ledger currencies

Revision ID: 0014_ledger_currency
Revises: 0013_owner_data
Create Date: 2026-09-11

Legacy holding and transaction amounts do not carry enough evidence to infer
their denomination safely. The new columns are therefore nullable and this
migration intentionally performs no data backfill. It is additive and
idempotent for installations whose tables historically came from
``Base.metadata.create_all``.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0014_ledger_currency"
down_revision = "0013_owner_data"
branch_labels = None
depends_on = None


def _columns(table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table_name not in set(inspector.get_table_names()):
        return set()
    return {str(column["name"]) for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    holding_columns = _columns("portfolio_holdings")
    if holding_columns and "cost_basis_currency" not in holding_columns:
        op.add_column(
            "portfolio_holdings",
            sa.Column("cost_basis_currency", sa.String(length=8), nullable=True),
        )

    transaction_columns = _columns("portfolio_transactions")
    if transaction_columns:
        if "currency" not in transaction_columns:
            op.add_column(
                "portfolio_transactions",
                sa.Column("currency", sa.String(length=8), nullable=True),
            )
        if "fees_currency" not in transaction_columns:
            op.add_column(
                "portfolio_transactions",
                sa.Column("fees_currency", sa.String(length=8), nullable=True),
            )


def downgrade() -> None:
    # Preserve currency evidence once users have supplied it. Re-running the
    # idempotent upgrade after a version rollback is safe.
    pass
