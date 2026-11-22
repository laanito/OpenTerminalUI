"""Widen legacy journal quantities without losing research or truncating fractions."""
import importlib.util
import io
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa


def migration():
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0023_journal_fractional_quantity.py"
    spec = importlib.util.spec_from_file_location("journal_fractional_migration_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_sqlite_widen_preserves_legacy_rows_indexes_and_fractions_after_downgrade():
    module = migration()
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE journal_entries (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, quantity INTEGER NOT NULL, notes TEXT, fees FLOAT NOT NULL)"))
        connection.execute(sa.text("CREATE INDEX ix_journal_entries_user_id ON journal_entries (user_id)"))
        connection.execute(sa.text("INSERT INTO journal_entries VALUES (1, 'owner', 7, 'Original thesis', 0.125)"))
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade(); module.upgrade()
        assert tuple(connection.execute(sa.text("SELECT * FROM journal_entries WHERE id=1")).one()) == (1, "owner", 7.0, "Original thesis", 0.125)
        assert any(row["name"] == "ix_journal_entries_user_id" for row in sa.inspect(connection).get_indexes("journal_entries"))
        connection.execute(sa.text("INSERT INTO journal_entries VALUES (2, 'owner', 0.00000001, 'Fractional thesis', 0.000001)"))
        module.downgrade()
        assert connection.execute(sa.text("SELECT quantity FROM journal_entries WHERE id=2")).scalar_one() == 1e-8
        assert isinstance(next(row for row in sa.inspect(connection).get_columns("journal_entries") if row["name"] == "quantity")["type"], sa.Float)
    engine.dispose()


def test_postgres_widens_integer_using_explicit_cast_without_updates_or_drop(monkeypatch):
    module = migration(); output = io.StringIO()
    module.op = Operations(MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output}))
    class Inspector:
        def get_columns(self, table):
            assert table == "journal_entries"
            return [{"name": "quantity", "type": sa.Integer(), "nullable": False}]
    monkeypatch.setattr(module.sa, "inspect", lambda bind: Inspector())
    module.upgrade(); module.downgrade()
    ddl = output.getvalue()
    assert "ALTER TABLE journal_entries ALTER COLUMN quantity TYPE FLOAT USING quantity::double precision" in ddl
    assert "UPDATE" not in ddl and "DROP" not in ddl and "DELETE" not in ddl
    assert len(module.revision) <= 32 and module.down_revision == "0022_unknown_opening_basis"
