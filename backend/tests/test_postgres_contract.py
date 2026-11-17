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
        "brain_memos",
        "news_text_snapshots",
        "news_sentiment_assessments",
        "comparison_captures",
    ):
        assert inspector.has_table(table), f"missing migrated PostgreSQL table: {table}"

    with engine.connect() as connection:
        assert connection.execute(text("SELECT 1")).scalar_one() == 1

    holding_columns = {column["name"]: column for column in inspector.get_columns("portfolio_holdings")}
    transaction_columns = {column["name"]: column for column in inspector.get_columns("portfolio_transactions")}
    assert holding_columns["cost_basis_currency"]["nullable"] is True
    assert transaction_columns["currency"]["nullable"] is True
    assert transaction_columns["fees_currency"]["nullable"] is True
    memo_columns = {column["name"]: column for column in inspector.get_columns("brain_memos")}
    assert memo_columns["technical_context"]["nullable"] is True
    assert memo_columns["technical_context"]["default"] is None


def test_news_evidence_round_trip_and_owner_constraint_on_postgres() -> None:
    from datetime import datetime, timezone
    from uuid import uuid4
    from sqlalchemy.orm import Session
    from sqlalchemy.exc import IntegrityError
    from backend.models import User, NewsSentimentAssessmentORM
    from backend.services.news_evidence import NewsText, SentimentAssessment, ComparisonNewsOrigin, capture_text, append_assessment, get_text

    # Always roll back, even on assertion failure; the lane is disposable but
    # this contract need not leave test research behind.
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
                owner, other = str(uuid4()), str(uuid4())
                db.add_all([User(id=value, email=f"{value}@example.test", hashed_password="") for value in (owner, other)])
                db.flush()
                now = datetime.now(timezone.utc)
                snapshot = capture_text(db, user_id=owner, evidence=NewsText(
                    title="Exact headline", source_url="https://example.test/story", publisher="Example",
                    retrieved_at=now, text_scope="headline_only",
                    origin=ComparisonNewsOrigin(capture_id="retained-source", capture_content_hash="a"*64, citation_ids=("C1G1H1",)),
                ))
                result = append_assessment(db, user_id=owner, snapshot_id=snapshot.id, assessment=SentimentAssessment(
                    meaning="text_tone", method="lexicon", method_version="v1", input_text="Exact headline",
                    scored_at=now, status="complete", score=0, label="neutral",
                ))
                db.expire_all()
                assert get_text(db, user_id=owner, snapshot_id=snapshot.id).payload["title"] == "Exact headline"
                assert snapshot.captured_at.tzinfo is not None
                assert result.payload["scored_at"] == now.isoformat().replace("+00:00", "Z")
                assert get_text(db, user_id=other, snapshot_id=snapshot.id) is None
                import json
                from types import SimpleNamespace
                from backend.api.routes.comparison_captures import list_headline_sentiment
                retained = json.loads(list_headline_sentiment("retained-source", limit=20, offset=0, user=SimpleNamespace(id=owner), db=db).body)
                assert retained[0]["id"] == snapshot.id
                assert retained[0]["payload"]["origin"]["citation_ids"] == ["C1G1H1"]
                assert retained[0]["assessments"][0]["payload"] == result.payload
                from backend.api.routes.news_evidence import list_retained_headlines
                history = json.loads(list_retained_headlines(limit=20, offset=0, user=SimpleNamespace(id=owner), db=db).body)
                assert history == retained
                assert json.loads(list_retained_headlines(limit=20, offset=0, user=SimpleNamespace(id=other), db=db).body) == []
                assert json.loads(list_headline_sentiment("retained-source", limit=20, offset=0, user=SimpleNamespace(id=other), db=db).body) == []
                with pytest.raises(IntegrityError), db.begin_nested():
                    db.add(NewsSentimentAssessmentORM(
                        id=str(uuid4()), user_id=other, snapshot_id=snapshot.id, recorded_at=now, payload={},
                    ))
                    db.flush()
                from backend.models import ComparisonCaptureORM, NewsTextSnapshotORM
                from backend.services.news_evidence_lifecycle import lifecycle, delete_unreferenced, EvidencePinned, prune_batch
                capture_id = str(uuid4())
                db.add(ComparisonCaptureORM(id=capture_id, user_id=owner, captured_at=now,
                    mode="context", status="complete", content_hash="b" * 64,
                    payload={"sentiment_sources": [{"id": snapshot.id}]}))
                db.flush()
                status = lifecycle(db, owner, [snapshot], 90)[snapshot.id]
                assert status.state == "pinned" and status.referencing_capture_ids == [capture_id]
                with pytest.raises(EvidencePinned):
                    delete_unreferenced(db, owner, snapshot.id)
                db.delete(db.get(ComparisonCaptureORM, capture_id)); db.flush()
                assert lifecycle(db, owner, [snapshot], 90)[snapshot.id].state == "unreferenced"
                delete_unreferenced(db, owner, snapshot.id); db.flush()
                assert get_text(db, user_id=owner, snapshot_id=snapshot.id) is None
                from datetime import timedelta
                old_id = str(uuid4())
                db.add(NewsTextSnapshotORM(id=old_id, user_id=owner, captured_at=now - timedelta(days=91),
                    content_hash="c" * 64, payload={"title": "Old unreferenced test evidence"}))
                db.flush()
                result = prune_batch(lambda: Session(bind=connection, join_transaction_mode="create_savepoint"),
                    90, now=now, user_id=owner)
                assert result["deleted"] == 1
        finally:
            transaction.rollback()


def test_comparison_capture_json_ownership_and_delete_on_postgres() -> None:
    from datetime import datetime, timezone
    from uuid import uuid4
    from sqlalchemy.orm import Session
    from fastapi import HTTPException
    from backend.models import ComparisonCaptureORM, User
    from backend.api.routes.comparison_captures import get_capture, list_captures, delete_capture
    from backend.services.comparison_briefing import unavailable_briefing
    from backend.tests.test_comparison_briefing import _packet
    from types import SimpleNamespace

    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
                owner, other, capture_id = str(uuid4()), str(uuid4()), str(uuid4())
                db.add_all([User(id=value, email=f"{value}@example.test", hashed_password="") for value in (owner, other)])
                db.flush()
                payload = {
                    "schema_version": 1, "mode": "price", "selection": {"anchor": "AAPL", "comparisons": ["SPY"], "period": "1M", "context": None},
                    "generation": {"contract_version": "comparison-capture-v1", "protocol": "openai_compatible_chat_completions",
                        "profile": {"requested_profile": "deep", "resolved_profile": "fast", "model": "test"},
                        "enabled": False, "timeout_seconds": 1, "structured_output": "auto", "attempts": []},
                    "result": unavailable_briefing("disabled", evidence=_packet()).model_dump(mode="json"),
                }
                db.add(ComparisonCaptureORM(id=capture_id, user_id=owner, captured_at=datetime.now(timezone.utc),
                    mode="price", status="unavailable", content_hash="a"*64, payload=payload))
                db.flush(); db.expire_all()
                user = SimpleNamespace(id=owner)
                import json
                detail = json.loads(get_capture(capture_id, user, db).body)
                assert detail["content"] == payload
                assert datetime.fromisoformat(detail["captured_at"].replace("Z", "+00:00")).tzinfo is not None
                assert len(list_captures(limit=20, offset=0, user=user, db=db)) == 1
                for operation in (get_capture, delete_capture):
                    with pytest.raises(HTTPException) as failure:
                        operation(capture_id, SimpleNamespace(id=other), db)
                    assert failure.value.status_code == 404
                from copy import deepcopy
                from backend.api.routes.comparison_captures import CaptureLineage
                child_id = str(uuid4())
                child = deepcopy(payload)
                lineage = CaptureLineage(kind="fresh_refresh", parent_id=capture_id, parent_content_hash="a"*64,
                    source_generated_at=payload["result"]["generated_at"]).model_dump(mode="json")
                child["lineage"] = lineage
                db.add(ComparisonCaptureORM(id=child_id, user_id=owner, captured_at=datetime.now(timezone.utc),
                    mode="price", status="unavailable", content_hash="b"*64, payload=child))
                db.flush(); db.expire_all()
                summaries = list_captures(limit=20, offset=0, user=user, db=db)
                assert next(row for row in summaries if row.id == child_id).lineage.model_dump(mode="json") == lineage
                delete_capture(capture_id, user, db)
                assert db.get(ComparisonCaptureORM, capture_id) is None
                assert json.loads(get_capture(child_id, user, db).body)["content"] == child
                # Deep sentiment follow-ups embed exact retained methods/inputs
                # in portable JSON, independent of parent/text-row lifetimes.
                from backend.tests.generate_sentiment_briefing_fixture import fixture
                retained = fixture()["child"]
                sentiment_id = str(uuid4())
                db.add(ComparisonCaptureORM(id=sentiment_id, user_id=owner, captured_at=datetime.now(timezone.utc),
                    mode="context", status="complete", content_hash=retained["content_hash"], payload=retained["content"]))
                db.flush(); db.expire_all()
                opened = json.loads(get_capture(sentiment_id, user, db).body)
                assert opened["content"] == retained["content"]
                assert opened["content"]["sentiment_sources"][0]["assessments"][1]["payload"]["generation"]["attempts"]
                summary = next(row for row in list_captures(limit=20, offset=0, user=user, db=db) if row.id == sentiment_id)
                assert summary.lineage.kind == "retained_sentiment_interpretation"
                with pytest.raises(HTTPException) as failure:
                    get_capture(sentiment_id, SimpleNamespace(id=other), db)
                assert failure.value.status_code == 404
        finally:
            transaction.rollback()
