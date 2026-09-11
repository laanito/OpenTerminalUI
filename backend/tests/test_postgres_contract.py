"""Guards for the opt-in, disposable PostgreSQL CI contract."""

from __future__ import annotations

import os

import pytest
from sqlalchemy import inspect, text

from backend.shared.db import engine


pytestmark = pytest.mark.skipif(
    os.environ.get("OPENTERMINALUI_ALLOW_POSTGRES_TESTS") != "1",
    reason="requires the explicit disposable PostgreSQL test lane",
)


def test_postgres_lane_uses_migrated_disposable_database() -> None:
    assert engine.dialect.name == "postgresql"
    assert engine.url.database and engine.url.database.endswith(("_ci", "_test"))
    assert engine.url.username and engine.url.username.endswith(("_ci", "_test"))

    inspector = inspect(engine)
    for table in (
        "users",
        "portfolios",
        "portfolio_holdings",
        "portfolio_transactions",
        "notes",
        "api_keys",
    ):
        assert inspector.has_table(table), f"missing migrated PostgreSQL table: {table}"

    with engine.connect() as connection:
        assert connection.execute(text("SELECT 1")).scalar_one() == 1

    holding_columns = {column["name"]: column for column in inspector.get_columns("portfolio_holdings")}
    transaction_columns = {column["name"]: column for column in inspector.get_columns("portfolio_transactions")}
    assert holding_columns["cost_basis_currency"]["nullable"] is True
    assert transaction_columns["currency"]["nullable"] is True
    assert transaction_columns["fees_currency"]["nullable"] is True
