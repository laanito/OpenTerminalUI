"""Tests for bond service and routes.

There is no live fixed-income data source wired yet, so every endpoint returns
an empty result flagged ``degraded`` rather than a hardcoded India-only bond
universe presented as live market data (v1.0 silent-mock audit).
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes.bonds import router
from backend.services.bond_service import BondService, get_bond_service


def _make_app(service: BondService) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_bond_service] = lambda: service
    return TestClient(app)


@pytest.fixture
def bond_service():
    return BondService()


@pytest.fixture
def client(bond_service: BondService):
    return _make_app(bond_service)


@pytest.mark.asyncio
async def test_bond_screener_is_empty_and_degraded(bond_service: BondService):
    result = await bond_service.get_bond_screener()
    assert result["bonds"] == []
    assert result["degraded"]["reason"] == "no_live_source"


@pytest.mark.asyncio
async def test_credit_spreads_is_empty_and_degraded(bond_service: BondService):
    result = await bond_service.get_credit_spreads()
    assert result["history"] == []
    assert result["degraded"]["reason"] == "no_live_source"


@pytest.mark.asyncio
async def test_ratings_migration_is_empty_and_degraded(bond_service: BondService):
    result = await bond_service.get_ratings_migration()
    assert result["migrations"] == []
    assert result["degraded"]["reason"] == "no_live_source"


def test_bond_screener_route(client: TestClient):
    resp = client.get("/api/bonds/screener")
    assert resp.status_code == 200
    data = resp.json()
    assert data["bonds"] == []
    assert data["degraded"]["reason"] == "no_live_source"


def test_credit_spreads_route(client: TestClient):
    resp = client.get("/api/bonds/credit-spreads")
    assert resp.status_code == 200
    data = resp.json()
    assert data["history"] == []
    assert data["degraded"]


def test_ratings_migration_route(client: TestClient):
    resp = client.get("/api/bonds/ratings-migration")
    assert resp.status_code == 200
    data = resp.json()
    assert data["migrations"] == []
    assert data["degraded"]
