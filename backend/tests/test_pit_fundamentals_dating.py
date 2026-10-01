from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.services import pit_fundamentals_service as pit
from backend.shared.db import Base


def test_fmp_records_use_reported_date_and_actual_fiscal_end() -> None:
    rows = [
        {
            "date": "2025-12-31", "period": "FY", "acceptedDate": "2026-02-12 18:00:00",
            "revenue": 100.0,
        },
        {
            "date": "2026-03-31", "period": "Q1", "acceptedDate": "invalid",
            "fillingDate": "2026-05-07", "revenue": 30.0,
        },
    ]
    records = pit._records_from_fmp_rows("aapl", rows, "fmp", "US")
    assert [(row.fiscal_period, row.as_of_release_date, row.release_date_estimated) for row in records] == [
        ("2025-12-31", date(2026, 2, 12), False),
        ("2026-03-31", date(2026, 5, 7), False),
    ]


def test_fmp_never_treats_period_end_or_impossible_filing_date_as_release() -> None:
    rows = [
        {"date": "2025-12-31", "period": "FY", "acceptedDate": "2025-12-01", "revenue": 100.0},
        {"date": "2026-03-31", "period": "Q1", "revenue": 30.0},
    ]
    records = pit._records_from_fmp_rows("AAPL", rows, "fmp", "US")
    assert [(row.as_of_release_date, row.release_date_estimated) for row in records] == [
        (date(2026, 4, 30), True),
        (date(2026, 5, 30), True),
    ]


def test_date_parser_returns_date_for_datetime() -> None:
    parsed = pit._parse_date(datetime(2026, 2, 12, 18, 0, tzinfo=timezone.utc))
    assert type(parsed) is date
    assert parsed == date(2026, 2, 12)


def test_asof_snapshot_respects_availability_and_prefers_confirmed_same_period() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        pit.upsert_pit_records(db, [
            pit.PitFundamentalRecord("AAPL", "revenue", 100, "FY", date(2026, 2, 1), False, "legacy", "US"),
            pit.PitFundamentalRecord("AAPL", "revenue", 110, "2025-12-31", date(2026, 2, 10), False, "fmp", "US"),
            pit.PitFundamentalRecord("AAPL", "revenue", 105, "2025-12-31", date(2026, 4, 30), True, "yahoo", "US"),
            pit.PitFundamentalRecord("AAPL", "revenue", 30, "2026-03-31", date(2026, 5, 7), False, "fmp", "US"),
        ])

        def snapshot(day: date):
            return pit.get_fundamentals(db, "AAPL", day)[1][0]

        assert snapshot(date(2026, 2, 5))["value"] == 100
        assert snapshot(date(2026, 3, 1))["value"] == 110
        assert snapshot(date(2026, 5, 1))["value"] == 110
        assert snapshot(date(2026, 5, 8))["value"] == 30
    engine.dispose()


def test_refresh_skips_records_without_release_date(monkeypatch) -> None:
    class FakeFetcher:
        async def fetch_pit_fundamentals_records(self, symbol: str):
            assert symbol == "AAPL"
            return [
                {"symbol": "AAPL", "metric": "revenue", "value": 100, "fiscal_period": "2025-12-31",
                 "as_of_release_date": "", "source": "fmp"},
                {"symbol": "AAPL", "metric": "eps", "value": 2, "fiscal_period": "2026-03-31",
                 "as_of_release_date": "2026-03-01", "source": "fmp"},
                {"symbol": "AAPL", "metric": "net_income", "value": 10, "fiscal_period": "2025-12-31",
                 "as_of_release_date": "2026-02-12", "source": "fmp"},
            ]

    def fake_upsert(db, records, data_version_id=None):
        assert len(records) == 1
        assert records[0].metric == "net_income"
        assert records[0].as_of_release_date == date(2026, 2, 12)
        return "test-version", 1

    monkeypatch.setattr(pit, "upsert_pit_records", fake_upsert)
    assert asyncio.run(pit.fetch_and_store_pit_fundamentals(object(), FakeFetcher(), "AAPL")) == ("test-version", 1)
