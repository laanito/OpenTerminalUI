"""Retain fractional asset units in trade-journal entries.

Revision ID: 0023_journal_fractional_quantity
Revises: 0022_unknown_opening_basis
"""
from alembic import op
import sqlalchemy as sa

revision = "0023_journal_fractional_quantity"
down_revision = "0022_unknown_opening_basis"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    column = next(row for row in sa.inspect(bind).get_columns("journal_entries") if row["name"] == "quantity")
    if isinstance(column["type"], sa.Integer):
        # PostgreSQL widens existing integers in place; SQLite batch mode retains
        # the journal rows, indexes and metadata while rebuilding this child table.
        kwargs = {"postgresql_using": "quantity::double precision"} if bind.dialect.name == "postgresql" else {}
        with op.batch_alter_table("journal_entries") as batch:
            batch.alter_column("quantity", existing_type=sa.Integer(), type_=sa.Float(), existing_nullable=column["nullable"], **kwargs)


def downgrade():
    # Do not truncate fractional research records to restore an integer column.
    # Older integer-only writers are not safe for the newly supported entries.
    pass
