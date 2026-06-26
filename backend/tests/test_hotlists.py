from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes.hotlists import router
from backend.services.hotlist_service import HotlistService, get_hotlist_service


def _build_test_app(service: HotlistService) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_hotlist_service] = lambda: service
    return TestClient(app)


def test_hotlist_route_is_empty_and_degraded() -> None:
    # No live screener source is wired, so the route returns empty + degraded
    # rather than a fabricated universe of movers (v1.0 silent-mock audit).
    service = HotlistService(now_factory=lambda: datetime(2026, 3, 20, 14, 45, tzinfo=timezone.utc))
    client = _build_test_app(service)

    response = client.get("/api/hotlists", params={"list_type": "gainers", "market": "US", "limit": 5})

    assert response.status_code == 200
    body = response.json()
    assert body["list_type"] == "gainers"
    assert body["market"] == "US"
    assert body["items"] == []
    assert body["degraded"]["reason"] == "no_live_source"


def test_hotlist_market_default_is_us() -> None:
    service = HotlistService(now_factory=lambda: datetime(2026, 3, 20, 14, 45, tzinfo=timezone.utc))
    client = _build_test_app(service)

    response = client.get("/api/hotlists", params={"list_type": "gainers"})

    assert response.status_code == 200
    assert response.json()["market"] == "US"


def test_hotlist_rejects_invalid_inputs() -> None:
    service = HotlistService(now_factory=lambda: datetime(2026, 3, 20, 14, 45, tzinfo=timezone.utc))
    client = _build_test_app(service)

    bad_type = client.get("/api/hotlists", params={"list_type": "invalid", "market": "US"})
    bad_market = client.get("/api/hotlists", params={"list_type": "gainers", "market": "EU"})

    assert bad_type.status_code == 400
    assert "unsupported list_type" in bad_type.json()["detail"]
    assert bad_market.status_code == 400
    assert "unsupported market" in bad_market.json()["detail"]


def test_hotlist_cache_ttl_respects_market_hours() -> None:
    now = [datetime(2026, 3, 20, 15, 0, tzinfo=timezone.utc)]
    service = HotlistService(now_factory=lambda: now[0])

    first = service._ttl_seconds("US")  # type: ignore[attr-defined]
    now[0] = now[0] + timedelta(hours=10)
    second = service._ttl_seconds("US")  # type: ignore[attr-defined]

    assert first == 5
    assert second == 300
