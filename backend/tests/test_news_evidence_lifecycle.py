"""Expiry is based on actual recording, protects references and never rewrites evidence."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa

from backend.api.routes import news_evidence as routes
from backend.config.settings import AppSettings
from backend.models import ComparisonCaptureORM, NewsTextSnapshotORM, NewsSentimentAssessmentORM, User
from backend.services import news_evidence_cleanup as worker
from backend.services.news_evidence_lifecycle import (
    EvidenceMissing, EvidencePinned, delete_unreferenced, lifecycle, lock_owner, prune_batch,
)
from backend.tests.test_captured_headline_sentiment import evidence_store  # noqa: F401
from backend.tests.test_comparison_captures import store  # noqa: F401
from backend.tests.test_news_evidence import text, assessment

NOW = datetime(2026, 11, 17, tzinfo=timezone.utc)


def bundle(factory, *, owner="owner", age=91, assessment_age=None):
    identity = str(uuid4())
    with factory() as db:
        db.add(NewsTextSnapshotORM(id=identity, user_id=owner, captured_at=NOW - timedelta(days=age),
            content_hash=text().content_hash, payload=text().model_dump(mode="json")))
        db.flush()
        db.add(NewsSentimentAssessmentORM(id=str(uuid4()), user_id=owner, snapshot_id=identity,
            recorded_at=NOW - timedelta(days=age if assessment_age is None else assessment_age),
            payload=assessment(scored_at=NOW - timedelta(days=200)).model_dump(mode="json")))
        db.commit()
    return identity


def saved(factory, identities, *, owner="owner"):
    identity = str(uuid4())
    with factory() as db:
        db.add(ComparisonCaptureORM(id=identity, user_id=owner, captured_at=NOW,
            mode="context", status="complete", content_hash="a" * 64,
            payload={"selection": {"anchor": "AAPL", "comparisons": ["SPY"], "period": "1M"},
                     "sentiment_sources": [{"id": key} for key in identities]}))
        db.commit()
    return identity


def test_unreferenced_age_uses_latest_recording_not_old_cached_score(store):
    _, factory, _, _ = store
    old = bundle(factory)
    fresh = bundle(factory, assessment_age=1)
    cached = bundle(factory, age=1)
    with factory() as db:
        rows = db.scalars(sa.select(NewsTextSnapshotORM)).all()
        states = lifecycle(db, "owner", rows, 90, now=NOW)
        assert states[old].state == "expired"
        assert states[fresh].expires_at == NOW + timedelta(days=89)
        assert states[cached].state == "unreferenced"
    assert prune_batch(factory, 90, now=NOW) == {"deleted": 1, "skipped": 0}
    with factory() as db:
        assert db.get(NewsTextSnapshotORM, old) is None
        assert db.scalar(sa.select(sa.func.count()).select_from(NewsSentimentAssessmentORM)) == 2
        assert db.get(NewsTextSnapshotORM, fresh)


def test_pinned_evidence_survives_until_last_reference_is_deleted(store):
    _, factory, _, _ = store
    identity = bundle(factory, age=500)
    first, second = saved(factory, [identity]), saved(factory, [identity])
    with factory() as db:
        state = lifecycle(db, "owner", [db.get(NewsTextSnapshotORM, identity)], 90, now=NOW)[identity]
        assert state.state == "pinned" and state.expires_at is None
        assert set(state.referencing_capture_ids) == {first, second}
        with pytest.raises(EvidencePinned): delete_unreferenced(db, "owner", identity)
        db.rollback()
    assert prune_batch(factory, 90, now=NOW)["deleted"] == 0
    with factory() as db:
        db.delete(db.get(ComparisonCaptureORM, first)); db.commit()
    assert prune_batch(factory, 90, now=NOW)["deleted"] == 0
    with factory() as db:
        db.delete(db.get(ComparisonCaptureORM, second)); db.commit()
    assert prune_batch(factory, 90, now=NOW)["deleted"] == 1


def test_foreign_owner_mentions_do_not_pin_or_disclose_private_evidence(store):
    _, factory, _, _ = store
    identity = bundle(factory)
    saved(factory, [identity], owner="other")
    with factory() as db:
        with pytest.raises(EvidenceMissing): delete_unreferenced(db, "other", identity)
        db.rollback()
        state = lifecycle(db, "owner", [db.get(NewsTextSnapshotORM, identity)], 90, now=NOW)[identity]
        assert state.referencing_capture_ids == []
    assert prune_batch(factory, 90, now=NOW)["deleted"] == 1
    with factory() as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(ComparisonCaptureORM)) == 1


def test_bundle_deletion_is_atomic_and_never_deletes_saved_runs(store):
    client, factory, _, _ = store
    identity = bundle(factory, age=1)
    parent = saved(factory, [])
    response = client.delete(f"/api/news/evidence/{identity}")
    assert response.status_code == 204, response.text
    assert client.get(f"/api/news/evidence/{identity}").status_code == 404
    with factory() as db:
        assert db.get(ComparisonCaptureORM, parent)
        assert db.scalar(sa.select(sa.func.count()).select_from(NewsSentimentAssessmentORM)) == 0


def test_batch_limit_does_not_starve_unreferenced_records_behind_pins(store):
    _, factory, _, _ = store
    pinned = bundle(factory, age=500)
    saved(factory, [pinned])
    identities = [bundle(factory) for _ in range(3)]
    assert prune_batch(factory, 90, limit=2, now=NOW)["deleted"] == 2
    assert prune_batch(factory, 90, limit=2, now=NOW)["deleted"] == 1
    with factory() as db: assert db.get(NewsTextSnapshotORM, pinned)


def test_no_cleanup_when_disabled_and_exact_cutoff_is_eligible(store):
    _, factory, _, _ = store
    old = bundle(factory, age=90)
    assert prune_batch(lambda: pytest.fail("Disabled cleanup must not open a DB"), None)["deleted"] == 0
    assert prune_batch(factory, 90, now=NOW - timedelta(microseconds=1))["deleted"] == 0
    assert prune_batch(factory, 90, now=NOW)["deleted"] == 1


def test_cleanup_rechecks_references_under_the_writer_lock(store, monkeypatch):
    _, factory, _, _ = store
    identity = bundle(factory)
    from backend.services import news_evidence_lifecycle as lifecycle_service
    original = lifecycle_service.lock_owner
    def locked(db, user_id, **kwargs):
        saved(factory, [identity])
        return original(db, user_id, **kwargs)
    monkeypatch.setattr(lifecycle_service, "lock_owner", locked)
    result = prune_batch(factory, 90, now=NOW)
    assert result == {"deleted": 0, "skipped": 1}


def test_expiry_metadata_and_409_for_pinned_bundle(store, monkeypatch):
    client, factory, _, _ = store
    identity = bundle(factory, age=1)
    parent = saved(factory, [identity])
    monkeypatch.setattr(routes, "get_settings", lambda: AppSettings(news_evidence_retention_days=90))
    value = client.get(f"/api/news/evidence/{identity}").json()
    assert value["retention"] == "pinned_by_saved_analysis"
    assert value["lifecycle"]["expires_at"] is None
    assert value["lifecycle"]["referencing_capture_ids"] == [parent]
    assert client.delete(f"/api/news/evidence/{identity}").status_code == 409
    with factory() as db: assert db.get(NewsTextSnapshotORM, identity)


@pytest.mark.parametrize("value", [0, "0", None, ""])
def test_zero_disables_expiry(value):
    assert AppSettings(news_evidence_retention_days=value).news_evidence_retention_days is None


def test_policy_default_and_invalid_values():
    assert AppSettings().news_evidence_retention_days == 90
    for value in [-1, 3651, "nonsense", True]:
        with pytest.raises(ValueError): AppSettings(news_evidence_retention_days=value)


@pytest.mark.asyncio
async def test_worker_has_no_startup_deletion_and_stops_cleanly(monkeypatch):
    calls = []
    monkeypatch.setattr(worker, "prune_batch", lambda *args, **kwargs: calls.append(kwargs) or {"deleted": 1, "skipped": 0})
    service = worker.EvidenceCleanup(lambda: None, 90, interval_seconds=0.01)
    service.start()
    assert calls == []
    for _ in range(100):
        if calls: break
        await asyncio.sleep(0.005)
    await service.stop()
    assert calls and service.task is None
    disabled = worker.EvidenceCleanup(lambda: pytest.fail("Disabled"), None)
    disabled.start()
    assert disabled.task is None


def test_sqlite_cleanup_waits_for_capture_save_and_rechecks_pins(store, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from backend.services import news_evidence_lifecycle as service
    _, factory, _, _ = store
    identity = bundle(factory)
    entered = Event()
    original = service.lock_owner
    def marked(db, owner, **kwargs):
        entered.set()
        return original(db, owner, **kwargs)
    with factory() as db, ThreadPoolExecutor(max_workers=1) as executor:
        assert original(db, "owner")
        monkeypatch.setattr(service, "lock_owner", marked)
        pending = executor.submit(prune_batch, factory, 90, now=NOW)
        assert entered.wait(2)
        db.add(ComparisonCaptureORM(id=str(uuid4()), user_id="owner", captured_at=NOW,
            mode="context", status="complete", content_hash="a" * 64, payload={"sentiment_sources": [{"id": identity}]}))
        db.commit()
        assert pending.result(timeout=5) == {"deleted": 0, "skipped": 1}
    with factory() as db: assert db.get(NewsTextSnapshotORM, identity)


def test_new_analysis_is_not_saved_when_evidence_disappears_during_generation(store, monkeypatch):
    from backend.tests.test_captured_headline_sentiment import source, capture
    from backend.tests.test_retained_sentiment_briefing import configure_deep
    from backend.api.routes import comparison_captures
    client, factory, _, _ = store
    original, _, _ = source(client, monkeypatch)
    snapshots = capture(client, original)
    configure_deep(monkeypatch)
    generate = comparison_captures.generate_context_briefing
    async def removed(*args, **kwargs):
        result = await generate(*args, **kwargs)
        with factory() as db:
            delete_unreferenced(db, "owner", snapshots[0]["id"])
            db.commit()
        return result
    monkeypatch.setattr(comparison_captures, "generate_context_briefing", removed)
    response = client.post(f"/api/market-context/briefing-captures/{original['id']}/sentiment-briefing/stream", json={"snapshot_ids": [snapshots[0]["id"]]})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]["type"] == "error"
    assert events[-1]["error"]["code"] == "capture_evidence_unavailable"
    with factory() as db: assert db.scalar(sa.select(sa.func.count()).select_from(ComparisonCaptureORM)) == 1
