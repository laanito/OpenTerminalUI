"""Nullable evidence migration preserves legacy rows on SQLite/PostgreSQL DDL."""
import importlib.util
import io
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa


def migration():
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0018_brain_technical_context.py"
    spec = importlib.util.spec_from_file_location("brain_technical_migration_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_nullable_snapshot_upgrade_is_idempotent_and_never_backfills_or_erases():
    engine = sa.create_engine("sqlite:///:memory:")
    module = migration()
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE brain_memos (id TEXT PRIMARY KEY, answer TEXT NOT NULL)"))
        connection.execute(sa.text("INSERT INTO brain_memos (id, answer) VALUES ('legacy', 'Original private answer')"))
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade(); module.upgrade()
        row = connection.execute(sa.text("SELECT answer, technical_context FROM brain_memos WHERE id='legacy'")).one()
        assert tuple(row) == ("Original private answer", None)
        connection.execute(sa.text("UPDATE brain_memos SET technical_context='{}' WHERE id='legacy'"))
        module.downgrade()
        assert connection.execute(sa.text("SELECT technical_context FROM brain_memos WHERE id='legacy'")).scalar_one() == "{}"
    engine.dispose()


def test_postgres_upgrade_uses_nullable_json_without_default_data_update_or_drop(monkeypatch):
    module = migration()
    output = io.StringIO()
    operations = Operations(MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output}))
    module.op = operations
    class Inspector:
        def get_columns(self, table):
            assert table == "brain_memos"
            return [{"name": "id"}, {"name": "answer"}]
    monkeypatch.setattr(module.sa, "inspect", lambda bind: Inspector())
    module.upgrade(); module.downgrade()
    ddl = output.getvalue()
    assert "ALTER TABLE brain_memos ADD COLUMN technical_context JSON" in ddl
    assert "DEFAULT" not in ddl and "UPDATE" not in ddl and "DROP" not in ddl and "NOT NULL" not in ddl
    assert len(module.revision) <= 32 and module.down_revision == "0017_market_fund_captures"
