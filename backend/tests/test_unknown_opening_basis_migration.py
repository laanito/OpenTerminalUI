import importlib.util
import io
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def migration():
    path = Path(__file__).resolve().parents[1] / 'alembic/versions/0022_unknown_opening_basis.py'
    spec = importlib.util.spec_from_file_location('unknown_basis_migration_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_relaxing_nullability_preserves_rows_constraints_and_unknowns_on_rollback():
    module = migration()
    engine = sa.create_engine('sqlite:///:memory:')
    with engine.begin() as connection:
        connection.exec_driver_sql('PRAGMA foreign_keys=ON')
        connection.exec_driver_sql('CREATE TABLE portfolios (id TEXT PRIMARY KEY)')
        connection.exec_driver_sql("INSERT INTO portfolios VALUES ('p')")
        for table, column in [('portfolio_holdings', 'cost_basis_per_share'), ('portfolio_transactions', 'price')]:
            connection.exec_driver_sql(f'CREATE TABLE {table} (id TEXT PRIMARY KEY, portfolio_id TEXT NOT NULL REFERENCES portfolios(id), lot_id TEXT NOT NULL, {column} FLOAT NOT NULL, CONSTRAINT uq_{table}_lot UNIQUE (portfolio_id, lot_id))')
            connection.exec_driver_sql(f'CREATE INDEX ix_{table}_portfolio ON {table} (portfolio_id)')
            connection.exec_driver_sql(f"INSERT INTO {table} VALUES ('old', 'p', 'known', 100), ('zero', 'p', 'gift', 0)")
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade(); module.upgrade()
        for table, column in [('portfolio_holdings', 'cost_basis_per_share'), ('portfolio_transactions', 'price')]:
            assert connection.exec_driver_sql(f'SELECT id, {column} FROM {table} ORDER BY id').all() == [('old', 100), ('zero', 0)]
            connection.exec_driver_sql(f"INSERT INTO {table} VALUES ('unknown', 'p', 'unknown', NULL)")
            assert sa.inspect(connection).get_indexes(table)[0]['name'] == f'ix_{table}_portfolio'
            with pytest.raises(sa.exc.IntegrityError):
                connection.exec_driver_sql(f"INSERT INTO {table} VALUES ('dup', 'p', 'known', 50)")
            with pytest.raises(sa.exc.IntegrityError):
                connection.exec_driver_sql(f"INSERT INTO {table} VALUES ('foreign', 'missing', 'missing', 50)")
        module.downgrade(); module.upgrade()
        assert connection.exec_driver_sql("SELECT price FROM portfolio_transactions WHERE id='unknown'").scalar_one() is None
        assert connection.exec_driver_sql('PRAGMA foreign_key_check').all() == []
    engine.dispose()


def test_postgresql_only_drops_not_null_without_row_rewrites(monkeypatch):
    module = migration()
    output = io.StringIO()
    module.op = Operations(MigrationContext.configure(dialect_name='postgresql', opts={'as_sql': True, 'output_buffer': output}))
    class Inspector:
        def get_columns(self, table):
            return [{'name': 'cost_basis_per_share' if table == 'portfolio_holdings' else 'price', 'nullable': False}]
    monkeypatch.setattr(module.sa, 'inspect', lambda bind: Inspector())
    module.upgrade(); module.downgrade()
    sql = output.getvalue()
    assert 'ALTER TABLE portfolio_holdings ALTER COLUMN cost_basis_per_share DROP NOT NULL' in sql
    assert 'ALTER TABLE portfolio_transactions ALTER COLUMN price DROP NOT NULL' in sql
    assert all(token not in sql for token in ['UPDATE ', 'DEFAULT', 'SET NOT NULL', 'DROP TABLE'])
    assert len(module.revision) <= 32 and module.down_revision == '0021_portfolio_operations'
