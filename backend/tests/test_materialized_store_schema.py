"""materialized_store must introspect its table portably (SQLite + Postgres).

Regression: ensure_screener_table used a raw `PRAGMA table_info(...)` to find
existing columns, which is SQLite-only. On Postgres it raised a syntax error and
500'd /api/screener/run-revamped. The introspection now goes through the
SQLAlchemy inspector, which works on either dialect.
"""
from __future__ import annotations

from sqlalchemy import inspect, text

from backend.services import materialized_store as ms
from backend.shared.db import engine


def _drop() -> None:
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {ms.TABLE_NAME}"))


def test_ensure_creates_full_schema_and_is_idempotent() -> None:
    _drop()
    ms.ensure_screener_table()
    cols = {c["name"] for c in inspect(engine).get_columns(ms.TABLE_NAME)}
    assert set(ms.SCHEMA_COLUMNS).issubset(cols)
    # Second call must not raise (introspection + no-op migration).
    ms.ensure_screener_table()


def test_ensure_adds_missing_columns_to_an_old_table() -> None:
    # Simulate a pre-existing table from an older schema (missing most columns).
    _drop()
    with engine.begin() as conn:
        conn.execute(text(f"CREATE TABLE {ms.TABLE_NAME} (ticker TEXT PRIMARY KEY, updated_at TEXT NOT NULL)"))

    ms.ensure_screener_table()  # should backfill every missing column, no PRAGMA

    cols = {c["name"] for c in inspect(engine).get_columns(ms.TABLE_NAME)}
    assert set(ms.SCHEMA_COLUMNS).issubset(cols)


def test_upsert_and_load_roundtrip() -> None:
    _drop()
    ms.upsert_screener_rows([{"ticker": "AAPL", "sector": "Tech", "current_price": 200.0}])
    df = ms.load_screener_df(["AAPL", "MSFT"])
    assert list(df["ticker"]) == ["AAPL"]
    assert df.iloc[0]["sector"] == "Tech"
    # Upsert again updates in place (ON CONFLICT), no duplicate row.
    ms.upsert_screener_rows([{"ticker": "AAPL", "sector": "Technology", "current_price": 210.0}])
    df2 = ms.load_screener_df(["AAPL"])
    assert len(df2) == 1
    assert df2.iloc[0]["sector"] == "Technology"
    _drop()
