"""Explicit observation-time captures do not invent historical vintages."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db, get_unified_fetcher
from backend.api.routes.market_fundamental_captures import router
from backend.auth.deps import get_current_user
from backend.models import FundamentalCaptureORM, User
from backend.shared.db import Base


def _client(responses: list[Any]) -> tuple[TestClient, dict[str, str]]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[User.__table__, FundamentalCaptureORM.__table__])
    session_factory = sessionmaker(bind=engine)
    with session_factory() as db:
        db.add_all([
            User(id="owner", email="owner@example.test", hashed_password=""),
            User(id="other", email="other@example.test", hashed_password=""),
        ])
        db.commit()

    class Fetcher:
        async def fetch_pit_fundamentals_records(self, symbol: str) -> list[dict[str, Any]]:
            assert symbol == "AAPL"
            result = responses.pop(0)
            if isinstance(result, Exception):
                raise result
            return result

    current = {"id": "owner"}
    app = FastAPI()
    app.include_router(router)

    def session():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = session
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=current["id"])
    app.dependency_overrides[get_unified_fetcher] = lambda: Fetcher()
    return TestClient(app), current


def _dated(value: float) -> dict[str, Any]:
    return {
        "symbol": "AAPL", "metric": "revenue", "value": value,
        "fiscal_period": "2026-06-30", "as_of_release_date": "2026-09-05",
        "release_date_estimated": False, "source": "fmp",
    }


def test_captures_are_immutable_owner_scoped_and_keep_conflicting_values() -> None:
    client, current = _client([
        [_dated(100.0), _dated(100.0), _dated(110.0), {**_dated(90.0), "release_date_estimated": True}],
        [_dated(120.0)],
    ])
    first = client.post("/api/market-context/fundamental-captures", json={"symbol": " aapl "})
    assert first.status_code == 201, first.text
    snapshot = first.json()
    assert snapshot["symbol"] == "AAPL"
    assert snapshot["status"] == "records_observed"
    assert snapshot["examined_count"] == 4
    assert snapshot["record_count"] == 2
    assert snapshot["evidence_scope"] == "terminal_observation_only"
    assert datetime.fromisoformat(snapshot["captured_at"]).tzinfo is not None
    assert {row["value"] for row in snapshot["records"]} == {100.0, 110.0}

    second = client.post("/api/market-context/fundamental-captures", json={"symbol": "AAPL"})
    assert second.status_code == 201
    assert second.json()["content_hash"] != snapshot["content_hash"]
    assert [row["value"] for row in second.json()["records"]] == [120.0]
    assert client.get(f"/api/market-context/fundamental-captures/{snapshot['id']}").json() == snapshot

    listed = client.get("/api/market-context/fundamental-captures", params={"symbol": "aapl"})
    assert listed.status_code == 200
    assert len(listed.json()) == 2
    assert "records" not in listed.json()[0]

    current["id"] = "other"
    assert client.get("/api/market-context/fundamental-captures").json() == []
    assert client.get(f"/api/market-context/fundamental-captures/{snapshot['id']}").status_code == 404
    assert client.delete(f"/api/market-context/fundamental-captures/{snapshot['id']}").status_code == 404

    current["id"] = "owner"
    assert client.delete(f"/api/market-context/fundamental-captures/{snapshot['id']}").status_code == 204
    assert client.get(f"/api/market-context/fundamental-captures/{snapshot['id']}").status_code == 404


def test_empty_and_failed_fetches_are_captured_without_claiming_absence() -> None:
    client, _ = _client([[], RuntimeError("tokenized provider failure")])
    empty = client.post("/api/market-context/fundamental-captures", json={"symbol": "AAPL"})
    failed = client.post("/api/market-context/fundamental-captures", json={"symbol": "AAPL"})
    assert empty.status_code == failed.status_code == 201
    assert empty.json()["status"] == "no_eligible_records_observed"
    assert failed.json()["status"] == "fetch_error"
    assert empty.json()["records"] == failed.json()["records"] == []
    assert empty.json()["content_hash"] != failed.json()["content_hash"]
    assert "tokenized" not in failed.text


def test_capture_hash_is_order_independent_for_the_same_eligible_values() -> None:
    client, _ = _client([[_dated(100.0), _dated(110.0)], [_dated(110.0), _dated(100.0)]])
    first = client.post("/api/market-context/fundamental-captures", json={"symbol": "AAPL"}).json()
    second = client.post("/api/market-context/fundamental-captures", json={"symbol": "AAPL"}).json()
    assert first["id"] != second["id"]
    assert first["content_hash"] == second["content_hash"]
    assert first["records"] == second["records"]


def test_observed_as_of_uses_owner_capture_time_and_never_falls_back_past_failure() -> None:
    client, current = _client([[_dated(100.0)], RuntimeError("tokenized provider failure")])
    first = client.post("/api/market-context/fundamental-captures", json={"symbol": "AAPL"}).json()
    second = client.post("/api/market-context/fundamental-captures", json={"symbol": "AAPL"}).json()
    first_at = datetime.fromisoformat(first["captured_at"])
    second_at = datetime.fromisoformat(second["captured_at"])
    assert first_at < second_at

    endpoint = "/api/market-context/fundamental-captures/observed-as-of"
    before = client.get(endpoint, params={"symbol": "aapl", "as_of": (first_at - timedelta(microseconds=1)).isoformat()})
    assert before.status_code == 200
    assert before.json()["selection_status"] == "no_retained_capture"
    assert before.json()["capture"] is None
    assert before.json()["evidence_scope"] == "terminal_observation_only"
    assert before.json()["selection_basis"] == "latest_retained_owner_capture_at_or_before_requested_at"

    at_first = client.get(endpoint, params={"symbol": "AAPL", "as_of": first_at.isoformat()})
    assert at_first.status_code == 200
    assert at_first.json()["contract_version"] == 1
    assert at_first.json()["capture"] == first
    assert datetime.fromisoformat(at_first.json()["requested_as_of"]) == first_at

    offset = first_at.astimezone(timezone(timedelta(hours=2))).isoformat()
    assert client.get(endpoint, params={"symbol": "AAPL", "as_of": offset}).json()["capture"] == first

    at_second = client.get(endpoint, params={"symbol": "AAPL", "as_of": second_at.isoformat()})
    assert at_second.status_code == 200
    assert at_second.json()["capture"] == second
    assert at_second.json()["capture"]["status"] == "fetch_error"
    assert at_second.json()["capture"]["records"] == []

    current["id"] = "other"
    assert client.get(endpoint, params={"symbol": "AAPL", "as_of": second_at.isoformat()}).json()["capture"] is None
    assert client.get(endpoint, params={"symbol": "AAPL", "as_of": "2026-09-11T10:00:00"}).status_code == 422

    current["id"] = "owner"
    assert client.delete(f"/api/market-context/fundamental-captures/{second['id']}").status_code == 204
    retained = client.get(endpoint, params={"symbol": "AAPL", "as_of": second_at.isoformat()}).json()
    assert retained["capture"] == first
    assert client.delete(f"/api/market-context/fundamental-captures/{first['id']}").status_code == 204
    assert client.get(endpoint, params={"symbol": "AAPL", "as_of": second_at.isoformat()}).json()["selection_status"] == "no_retained_capture"
