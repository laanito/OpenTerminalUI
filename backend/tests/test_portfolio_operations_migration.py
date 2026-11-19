import importlib.util
import io
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def migration():
    path = Path(__file__).resolve().parents[1] / 'alembic/versions/0021_portfolio_operations.py'
    spec = importlib.util.spec_from_file_location('portfolio_operations_migration_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_nullable_operation_metadata_preserves_legacy_and_retains_retries_on_rollback():
    module = migration()
    engine = sa.create_engine('sqlite:///:memory:')
    with engine.begin() as connection:
        connection.exec_driver_sql('CREATE TABLE portfolio_transactions (id TEXT PRIMARY KEY, notes TEXT NOT NULL)')
        connection.exec_driver_sql("INSERT INTO portfolio_transactions VALUES ('old', 'Original transaction')")
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade(); module.upgrade()
        row = connection.exec_driver_sql('SELECT notes, operation_data FROM portfolio_transactions').one()
        assert tuple(row) == ('Original transaction', None)
        connection.exec_driver_sql("UPDATE portfolio_transactions SET operation_data='{}'")
        module.downgrade(); module.upgrade()
        assert connection.exec_driver_sql('SELECT operation_data FROM portfolio_transactions').scalar_one() == '{}'
    engine.dispose()


def test_postgresql_addition_uses_nullable_json_without_defaults_or_old_row_updates(monkeypatch):
    module = migration()
    output = io.StringIO()
    module.op = Operations(MigrationContext.configure(dialect_name='postgresql', opts={'as_sql': True, 'output_buffer': output}))
    class Inspector:
        def get_columns(self, table):
            assert table == 'portfolio_transactions'
            return [{'name': 'id'}, {'name': 'notes'}]
    monkeypatch.setattr(module.sa, 'inspect', lambda bind: Inspector())
    module.upgrade(); module.downgrade()
    sql = output.getvalue()
    assert 'ADD COLUMN operation_data JSON' in sql
    assert all(token not in sql for token in ['DEFAULT', 'NOT NULL', 'DROP', 'UPDATE'])
    assert len(module.revision) <= 32 and module.down_revision == '0020_comparison_captures'
