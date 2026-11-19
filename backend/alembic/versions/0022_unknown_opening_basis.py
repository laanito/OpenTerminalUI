"""Permit explicit unknown cost without zero placeholders.

Revision ID: 0022_unknown_opening_basis
Revises: 0021_portfolio_operations
"""
from alembic import op
import sqlalchemy as sa

revision = "0022_unknown_opening_basis"
down_revision = "0021_portfolio_operations"
branch_labels = None
depends_on = None


def upgrade():
    for table, column in (("portfolio_holdings", "cost_basis_per_share"), ("portfolio_transactions", "price")):
        existing = next(item for item in sa.inspect(op.get_bind()).get_columns(table) if item["name"] == column)
        if not existing["nullable"]:
            # SQLite recreates only these unreferenced child tables, retaining
            # rows, FKs, indexes and the lot uniqueness constraint. PostgreSQL
            # uses ALTER COLUMN DROP NOT NULL without rewriting old values.
            with op.batch_alter_table(table) as batch:
                batch.alter_column(column, existing_type=sa.Float(), nullable=True)


def downgrade():
    # Never replace unknowns with zero or erase evidence to restore NOT NULL.
    # Pre-unknown-basis application binaries are not safe writers for these rows.
    pass
