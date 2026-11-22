from __future__ import annotations

from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.main import app
from backend.models.journal import JournalEntry
from backend.shared.db import Base


def _build_client() -> tuple[TestClient, sessionmaker]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def _override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db
    app.state.db_session_factory = TestingSessionLocal
    return TestClient(app), TestingSessionLocal


def _auth_headers(client: TestClient, email: str) -> dict[str, str]:
    password = "StrongPass123!"
    register = client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    assert register.status_code == 200
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_trade(client: TestClient, headers: dict[str, str], **overrides):
    payload = {
        "symbol": "RELIANCE",
        "direction": "LONG",
        "entry_date": "2026-04-01T09:15:00",
        "entry_price": 2500,
        "exit_date": "2026-04-01T15:20:00",
        "exit_price": 2600,
        "quantity": 10,
        "fees": 0,
        "strategy": "breakout",
        "setup": "bull-flag",
        "emotion": "confident",
        "notes": "Clean breakout",
        "tags": ["gap", "momentum"],
        "rating": 4,
    }
    payload.update(overrides)
    return client.post("/api/journal", headers=headers, json=payload)


def test_post_journal_creates_entry_and_computes_pnl() -> None:
    client, _ = _build_client()
    headers = _auth_headers(client, "journal-create@example.com")

    response = _create_trade(client, headers)

    assert response.status_code == 200
    entry = response.json()["entry"]
    assert entry["symbol"] == "RELIANCE"
    assert entry["pnl"] == 1000.0
    assert entry["pnl_pct"] == 4.0


def test_get_journal_returns_list_and_symbol_filter() -> None:
    client, _ = _build_client()
    headers = _auth_headers(client, "journal-list@example.com")

    _create_trade(client, headers, symbol="RELIANCE")
    _create_trade(client, headers, symbol="INFY", strategy="mean-reversion")

    listed = client.get("/api/journal", headers=headers)
    filtered = client.get("/api/journal", headers=headers, params={"symbol": "INFY"})

    assert listed.status_code == 200
    assert len(listed.json()["entries"]) == 2
    assert filtered.status_code == 200
    assert [row["symbol"] for row in filtered.json()["entries"]] == ["INFY"]


def test_get_journal_stats_returns_valid_statistics() -> None:
    client, _ = _build_client()
    headers = _auth_headers(client, "journal-stats@example.com")

    _create_trade(client, headers, symbol="RELIANCE", strategy="breakout", emotion="confident")
    _create_trade(
        client,
        headers,
        symbol="TCS",
        strategy="mean-reversion",
        emotion="fearful",
        entry_price=100,
        exit_price=90,
        quantity=5,
        entry_date="2026-04-02T09:15:00",
        exit_date="2026-04-02T15:20:00",
    )

    stats = client.get("/api/journal/stats", headers=headers)

    assert stats.status_code == 200
    payload = stats.json()
    assert payload["total_trades"] == 2
    assert payload["closed_trades"] == 2
    assert payload["open_trades"] == 0
    assert payload["win_rate"] == 50.0
    assert payload["total_pnl"] == 950.0
    assert any(item["strategy"] == "breakout" for item in payload["by_strategy"])
    assert any(item["emotion"] == "confident" for item in payload["by_emotion"])


def test_journal_gap_review_is_on_demand_deterministic_and_owner_scoped() -> None:
    client, session_factory = _build_client()
    headers = _auth_headers(client, "journal-gaps@example.com")
    other_headers = _auth_headers(client, "journal-gaps-other@example.com")

    complete = _create_trade(client, headers, symbol="COMPLETE")
    incomplete = _create_trade(
        client,
        headers,
        symbol="REVIEW",
        exit_date=None,
        exit_price=None,
        setup=None,
        emotion=None,
        notes=None,
    )
    _create_trade(client, other_headers, symbol="PRIVATE", setup=None, emotion=None, notes=None)

    db = session_factory()
    try:
        row = db.query(JournalEntry).filter(JournalEntry.id == incomplete.json()["entry"]["id"]).one()
        row.updated_at = datetime(2026, 1, 1)
        row.created_at = datetime(2026, 1, 1)
        db.commit()
    finally:
        db.close()

    response = client.get("/api/journal/gaps", headers=headers, params={"stale_after_days": 1})

    assert complete.status_code == 200
    assert response.status_code == 200
    payload = response.json()
    assert payload["total_entries"] == 2
    assert payload["entries_needing_review"] == 1
    assert payload["complete_entries"] == 1
    assert [item["symbol"] for item in payload["items"]] == ["REVIEW"]
    assert payload["items"][0]["missing"] == [
        "rationale",
        "outcome",
        "emotion",
        "setup",
        "thesis_update",
    ]
    assert payload["gap_counts"] == {
        "rationale": 1,
        "outcome": 1,
        "emotion": 1,
        "setup": 1,
        "thesis_update": 1,
    }


def test_journal_gap_review_rejects_invalid_staleness_window() -> None:
    client, _ = _build_client()
    headers = _auth_headers(client, "journal-gap-window@example.com")

    response = client.get("/api/journal/gaps", headers=headers, params={"stale_after_days": 0})

    assert response.status_code == 422


def test_get_journal_equity_curve_returns_time_series() -> None:
    client, _ = _build_client()
    headers = _auth_headers(client, "journal-equity@example.com")

    _create_trade(client, headers, entry_date="2026-04-01T09:15:00", exit_date="2026-04-01T15:20:00")
    _create_trade(
        client,
        headers,
        symbol="INFY",
        entry_price=2000,
        exit_price=1900,
        quantity=1,
        entry_date="2026-04-02T09:15:00",
        exit_date="2026-04-02T15:20:00",
    )

    curve = client.get("/api/journal/equity-curve", headers=headers)

    assert curve.status_code == 200
    points = curve.json()["points"]
    assert points == [
        {"date": "2026-04-01", "cumulative_pnl": 1000.0},
        {"date": "2026-04-02", "cumulative_pnl": 900.0},
    ]


def test_get_journal_calendar_returns_calendar_data() -> None:
    client, _ = _build_client()
    headers = _auth_headers(client, "journal-calendar@example.com")

    _create_trade(client, headers, entry_date="2026-04-01T09:15:00", exit_date="2026-04-01T15:20:00")
    _create_trade(
        client,
        headers,
        symbol="INFY",
        entry_price=100,
        exit_price=110,
        quantity=2,
        entry_date="2026-04-01T10:00:00",
        exit_date="2026-04-01T14:00:00",
    )

    calendar = client.get("/api/journal/calendar", headers=headers)

    assert calendar.status_code == 200
    assert calendar.json()["days"] == [{"date": "2026-04-01", "pnl": 1020.0, "trade_count": 2}]


def test_put_journal_updates_and_recomputes_pnl() -> None:
    client, _ = _build_client()
    headers = _auth_headers(client, "journal-update@example.com")

    created = _create_trade(client, headers)
    entry_id = created.json()["entry"]["id"]

    updated = client.put(
        f"/api/journal/{entry_id}",
        headers=headers,
        json={"exit_price": 2550, "fees": 10},
    )

    assert updated.status_code == 200
    entry = updated.json()["entry"]
    assert entry["pnl"] == 490.0
    assert entry["pnl_pct"] == 1.96


def test_delete_journal_removes_entry() -> None:
    client, _ = _build_client()
    headers = _auth_headers(client, "journal-delete@example.com")

    created = _create_trade(client, headers)
    entry_id = created.json()["entry"]["id"]

    deleted = client.delete(f"/api/journal/{entry_id}", headers=headers)
    listed = client.get("/api/journal", headers=headers)

    assert deleted.status_code == 200
    assert deleted.json() == {"status": "deleted", "id": entry_id}
    assert listed.json()["entries"] == []


def test_pnl_computation_long_profit_long_loss_short_profit() -> None:
    client, _ = _build_client()
    headers = _auth_headers(client, "journal-pnl@example.com")

    long_profit = _create_trade(client, headers, symbol="LONGWIN")
    long_loss = _create_trade(client, headers, symbol="LONGLOSS", entry_price=100, exit_price=90, quantity=2)
    short_profit = _create_trade(
        client,
        headers,
        symbol="SHORTWIN",
        direction="SHORT",
        entry_price=100,
        exit_price=80,
        quantity=3,
    )

    assert long_profit.json()["entry"]["pnl"] == 1000.0
    assert long_loss.json()["entry"]["pnl"] == -20.0
    assert short_profit.json()["entry"]["pnl"] == 60.0


def test_fractional_journal_create_update_and_csv_preserve_units_and_fees() -> None:
    import pytest
    client, _ = _build_client()
    headers = _auth_headers(client, "fractional-journal@example.com")
    response = _create_trade(client, headers, symbol="BTC-USD", entry_price=20000, exit_price=21000, quantity=0.005, fees=0.125)
    assert response.status_code == 200, response.text
    entry = response.json()["entry"]
    assert entry["quantity"] == pytest.approx(0.005)
    assert entry["fees"] == pytest.approx(0.125)
    assert entry["pnl"] == pytest.approx(4.875)
    updated = client.put(f"/api/journal/{entry['id']}", headers=headers, json={"quantity": 0.0075, "fees": 0.0625})
    assert updated.status_code == 200, updated.text
    assert updated.json()["entry"]["quantity"] == pytest.approx(0.0075)
    assert updated.json()["entry"]["pnl"] == pytest.approx(7.4375)
    csv_text = "symbol,direction,entry_date,entry_price,exit_date,exit_price,quantity,fees\nBTC-USD,LONG,2026-04-01T09:15:00,20000,2026-04-01T15:20:00,22000,0.00000001,0.000001\n"
    imported = client.post("/api/journal/import-csv", headers=headers, files={"file": ("fractional.csv", csv_text, "text/csv")})
    assert imported.status_code == 200, imported.text
    rows = client.get("/api/journal", headers=headers).json()["entries"]
    tiny = next(row for row in rows if row["id"] != entry["id"])
    assert tiny["quantity"] == pytest.approx(1e-8, abs=1e-15)
    assert tiny["fees"] == pytest.approx(1e-6)
    assert tiny["pnl"] == pytest.approx(0.000019)


def test_journal_rejects_invalid_sizes_and_reports_validation_fields() -> None:
    client, _ = _build_client()
    headers = _auth_headers(client, "invalid-fractional-journal@example.com")
    for field, value in [("quantity", 0), ("quantity", -1), ("quantity", "NaN"), ("fees", -0.1), ("fees", "Infinity"), ("entry_price", 0)]:
        response = _create_trade(client, headers, **{field: value})
        assert response.status_code == 422, response.text
        assert any(issue["loc"][-1] == field for issue in response.json()["detail"])
