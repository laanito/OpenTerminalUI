from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.routes.dividends import _portfolio_symbols
from backend.models import WatchlistORM
from backend.reports.generator import rows_for_data_type
from backend.services.watchlists import all_watchlist_symbols, watchlist_symbols_for_user
from backend.shared.db import Base


def _session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    return factory


def test_user_reads_do_not_cross_watchlist_ownership_boundary() -> None:
    factory = _session_factory()
    now = datetime.now(timezone.utc)
    with factory() as db:
        db.add_all(
            [
                WatchlistORM(
                    id="one-a",
                    user_id="user-one",
                    name="Core",
                    symbols_json=[" aapl ", "MSFT", "AAPL"],
                    column_config_json={},
                    created_at=now,
                ),
                WatchlistORM(
                    id="one-b",
                    user_id="user-one",
                    name="Ideas",
                    symbols_json=["TSLA", "MSFT"],
                    column_config_json={},
                    created_at=now + timedelta(seconds=1),
                ),
                WatchlistORM(
                    id="two-a",
                    user_id="user-two",
                    name="Private",
                    symbols_json=["NVDA"],
                    column_config_json={},
                    created_at=now,
                ),
            ]
        )
        db.commit()

        assert watchlist_symbols_for_user(db, "user-one") == ["AAPL", "MSFT", "TSLA"]
        assert _portfolio_symbols(db, "user-one") == ["AAPL", "MSFT", "TSLA"]
        assert rows_for_data_type(db, "watchlist", "user-one") == [
            {"id": "one-a:AAPL", "watchlist_name": "Core", "ticker": "AAPL"},
            {"id": "one-a:MSFT", "watchlist_name": "Core", "ticker": "MSFT"},
            {"id": "one-b:TSLA", "watchlist_name": "Ideas", "ticker": "TSLA"},
            {"id": "one-b:MSFT", "watchlist_name": "Ideas", "ticker": "MSFT"},
        ]


def test_background_union_exposes_symbols_only_and_honours_limit() -> None:
    factory = _session_factory()
    with factory() as db:
        db.add_all(
            [
                WatchlistORM(user_id="user-one", name="One", symbols_json=["TSLA", "AAPL"], column_config_json={}),
                WatchlistORM(user_id="user-two", name="Two", symbols_json=["NVDA", "AAPL"], column_config_json={}),
            ]
        )
        db.commit()

        assert all_watchlist_symbols(db) == ["AAPL", "NVDA", "TSLA"]
        assert all_watchlist_symbols(db, limit=2) == ["AAPL", "NVDA"]
