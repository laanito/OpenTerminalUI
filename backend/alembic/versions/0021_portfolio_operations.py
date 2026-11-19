"""Retain operation identities and non-cash opening provenance.

Revision ID: 0021_portfolio_operations
Revises: 0020_comparison_captures
"""
from alembic import op
import sqlalchemy as sa

revision = "0021_portfolio_operations"
down_revision = "0020_comparison_captures"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("portfolio_transactions")}
    if "operation_data" not in columns:
        op.add_column("portfolio_transactions", sa.Column("operation_data", sa.JSON(), nullable=True))


def downgrade():
    # Preserve operation identities/provenance on application rollback. Older
    # binaries must not accept writes while non-cash opening events exist.
    pass
