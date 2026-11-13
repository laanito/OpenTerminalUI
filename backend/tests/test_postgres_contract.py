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
    from backend.services.news_evidence import NewsText, SentimentAssessment, capture_text, append_assessment, get_text

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
                with pytest.raises(IntegrityError), db.begin_nested():
                    db.add(NewsSentimentAssessmentORM(
                        id=str(uuid4()), user_id=other, snapshot_id=snapshot.id, recorded_at=now, payload={},
                    ))
                    db.flush()
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
                delete_capture(capture_id, user, db)
                assert db.get(ComparisonCaptureORM, capture_id) is None
        finally:
            transaction.rollback()
