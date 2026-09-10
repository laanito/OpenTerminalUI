from __future__ import annotations

import pytest

from backend.shared.cache import MultiTierCache


def test_cache_blob_integrity_roundtrip() -> None:
    cache = MultiTierCache(redis_url=None)
    blob = cache._encode_blob({"a": 1, "b": "x"})
    value = cache._decode_blob(blob)
    assert value == {"a": 1, "b": "x"}


def test_cache_blob_integrity_tamper_detected() -> None:
    cache = MultiTierCache(redis_url=None)
    blob = bytearray(cache._encode_blob({"a": 1}))
    blob[-1] = (blob[-1] + 1) % 255
    value = cache._decode_blob(bytes(blob))
    assert value is None


@pytest.mark.asyncio
async def test_cache_health_reports_initialized_local_tiers(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("REDIS_URL", raising=False)
    cache = MultiTierCache(db_path=str(tmp_path / "cache.db"))
    await cache.initialize()
    try:
        health = await cache.health()
    finally:
        await cache.close()

    assert health == {
        "status": "ok",
        "l1": {"status": "ok", "entries": 0},
        "redis": {"status": "disabled", "configured": False},
        "sqlite": {"status": "ok"},
    }


@pytest.mark.asyncio
async def test_cache_health_labels_configured_redis_failure(tmp_path, monkeypatch) -> None:
    class _UnavailableRedis:
        async def ping(self) -> None:
            raise ConnectionError("offline")

    monkeypatch.delenv("REDIS_URL", raising=False)
    cache = MultiTierCache(redis_url="redis://cache.invalid", db_path=str(tmp_path / "cache.db"))
    cache._redis = _UnavailableRedis()
    cache._db_conn = None

    health = await cache.health()

    assert health["status"] == "degraded"
    assert health["redis"] == {"status": "unavailable", "configured": True}
    assert health["sqlite"] == {"status": "unavailable"}
