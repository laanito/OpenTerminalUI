"""Durable evidence survives sessions and never inherits cache/provider changes."""
from datetime import datetime, timezone
import importlib.util
import io
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from backend.models import User, NewsTextSnapshotORM, NewsSentimentAssessmentORM
from backend.services.news_evidence import (
    NewsText, SentimentAssessment, capture_text, get_text, append_assessment, get_assessment,
)
from backend.shared.db import Base

NOW = datetime(2026, 11, 11, tzinfo=timezone.utc)


def text(**changes):
    return NewsText(**{
        "title": "  Issuer raises guidance  ", "summary": "Exact summary\nwith whitespace.",
        "source_url": "https://example.test/story", "publisher": "Example",
        "retrieved_at": NOW, "text_scope": "headline_and_summary", "symbols": ("AAPL",), **changes,
    })


def assessment(**changes):
    return SentimentAssessment(**{
        "meaning": "asset_implication", "target_symbol": "AAPL", "method": "llm",
        "method_version": "news-v1", "provider": "local", "model": "fast",
        "prompt_version": "v1", "input_text": "Exact scorer input", "scored_at": NOW,
        "status": "complete", "score": 0.4, "label": "bullish", **changes,
    })


@pytest.fixture
def database(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'evidence.sqlite'}")
    @sa.event.listens_for(engine, "connect")
    def foreign_keys(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine, tables=[User.__table__, NewsTextSnapshotORM.__table__, NewsSentimentAssessmentORM.__table__])
    with Session(engine) as db:
        db.add_all([User(id=owner, email=f"{owner}@example.test", hashed_password="") for owner in ("owner", "other")])
        db.commit()
    yield engine
    engine.dispose()


def test_restart_exact_versions_rescoring_and_original_times(database):
    with Session(database) as db:
        first = capture_text(db, user_id="owner", evidence=text())
        original = append_assessment(db, user_id="owner", snapshot_id=first.id, assessment=assessment())
        revised = capture_text(db, user_id="owner", evidence=text(title="Provider edited the same URL"))
        rescored = append_assessment(db, user_id="owner", snapshot_id=first.id, assessment=assessment(score=-0.3, label="bearish", model="new-model"))
        first_id, original_id, revised_id, rescored_id = first.id, original.id, revised.id, rescored.id
        db.commit()
    database.dispose()  # New connection/session, no provider or cache involved.
    with Session(database) as db:
        first = get_text(db, user_id="owner", snapshot_id=first_id)
        revised = get_text(db, user_id="owner", snapshot_id=revised_id)
        original = get_assessment(db, user_id="owner", assessment_id=original_id)
        assert first.payload == text().model_dump(mode="json")
        assert first.content_hash != revised.content_hash
        assert original.payload == assessment().model_dump(mode="json")
        assert original.recorded_at.replace(tzinfo=timezone.utc) > NOW
        assert get_assessment(db, user_id="owner", assessment_id=rescored_id).payload["score"] == -0.3
        assert get_text(db, user_id="other", snapshot_id=first_id) is None
        assert get_assessment(db, user_id="other", assessment_id=original_id) is None
        with pytest.raises(LookupError):
            append_assessment(db, user_id="other", snapshot_id=first_id, assessment=assessment())
        first.payload = {"title": "overwrite"}
        with pytest.raises(ValueError, match="append-only"):
            db.flush()
        db.rollback()
        original.payload = {"score": 1}
        with pytest.raises(ValueError, match="append-only"):
            db.flush()


def test_database_rejects_cross_owner_links_and_owner_delete_cascades(database):
    with Session(database) as db:
        snapshot = capture_text(db, user_id="owner", evidence=text())
        snapshot_id = snapshot.id
        append_assessment(db, user_id="owner", snapshot_id=snapshot_id, assessment=assessment())
        db.commit()
        db.add(NewsSentimentAssessmentORM(id="forged", user_id="other", snapshot_id=snapshot_id, recorded_at=NOW, payload={}))
        with pytest.raises(sa.exc.IntegrityError):
            db.flush()
        db.rollback()
        db.execute(sa.delete(User).where(User.id == "owner"))
        db.commit()
        assert db.scalar(sa.select(sa.func.count()).select_from(NewsTextSnapshotORM)) == 0
        assert db.scalar(sa.select(sa.func.count()).select_from(NewsSentimentAssessmentORM)) == 0


@pytest.mark.parametrize("changes", [
    {"retrieved_at": datetime(2026, 11, 11)}, {"title": "", "summary": ""},
    {"text_scope": "headline_only"}, {"symbols": ("",)}, {"summary": "x" * 65537},
])
def test_text_rejects_ambiguous_or_oversized_input_without_silent_truncation(changes):
    with pytest.raises(ValueError):
        text(**changes)


@pytest.mark.parametrize("changes", [
    {"score": float("nan")}, {"target_symbol": None}, {"scored_at": datetime(2026, 11, 11)},
    {"status": "failed", "failure_code": "timeout"}, {"status": "fallback"},
    {"confidence": 0.7}, {"model": None}, {"prompt_version": None}, {"api_key": "must-not-store"},
])
def test_assessment_rejects_invalid_result_and_arbitrary_settings(changes):
    with pytest.raises(ValueError):
        assessment(**changes)


def test_failure_fallback_and_hash_boundaries():
    failed = assessment(status="failed", score=None, label=None, failure_code="timeout")
    assert failed.score is None
    assert assessment(status="fallback", failure_code="timeout", method="lexicon").status == "fallback"
    assert text(title="a", summary="bc").content_hash != text(title="ab", summary="c").content_hash
    assert text().content_hash != text(title=text().title.strip()).content_hash


def migration():
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0019_news_evidence.py"
    spec = importlib.util.spec_from_file_location("news_evidence_migration_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_additive_migration_preserves_legacy_and_captured_records(database):
    module = migration()
    with database.begin() as connection:
        connection.execute(sa.text("CREATE TABLE news_articles (id INTEGER PRIMARY KEY, title TEXT)"))
        connection.execute(sa.text("INSERT INTO news_articles VALUES (1, 'Legacy title')"))
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade(); module.upgrade()
        assert connection.execute(sa.text("SELECT title FROM news_articles")).scalar_one() == "Legacy title"
    with Session(database) as db:
        row = capture_text(db, user_id="owner", evidence=text())
        snapshot_id = row.id
        db.commit()
    with database.begin() as connection:
        module.op = Operations(MigrationContext.configure(connection))
        module.downgrade(); module.upgrade()
        assert connection.execute(sa.text("SELECT id FROM news_text_snapshots")).scalar_one() == snapshot_id


def test_postgres_migration_ddl_has_owner_fk_and_short_revision(monkeypatch):
    module = migration()
    output = io.StringIO()
    module.op = Operations(MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output}))
    class Inspector:
        def get_table_names(self): return []
        def get_indexes(self, table): return []
    monkeypatch.setattr(module.sa, "inspect", lambda bind: Inspector())
    module.upgrade(); module.downgrade()
    ddl = output.getvalue()
    assert "FOREIGN KEY(user_id, snapshot_id) REFERENCES news_text_snapshots (user_id, id) ON DELETE CASCADE" in ddl
    assert "TIMESTAMP WITH TIME ZONE" in ddl and "JSON NOT NULL" in ddl
    assert "DROP" not in ddl and "UPDATE" not in ddl
    assert len(module.revision) <= 32


def test_fresh_sqlite_migration_matches_orm_and_owner_foreign_keys():
    module = migration()
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(sa.text("PRAGMA foreign_keys=ON"))
        User.__table__.create(connection)
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade(); module.upgrade()
        inspector = sa.inspect(connection)
        for table in (NewsTextSnapshotORM.__table__, NewsSentimentAssessmentORM.__table__):
            assert {column["name"] for column in inspector.get_columns(table.name)} == set(table.columns.keys())
            assert {index["name"] for index in inspector.get_indexes(table.name)} == {index.name for index in table.indexes}
        assert inspector.get_foreign_keys("news_sentiment_assessments")[0]["constrained_columns"] == ["user_id", "snapshot_id"]
    with Session(engine) as db:
        db.add(User(id="owner", email="owner@example.test", hashed_password=""))
        db.flush()
        snapshot = capture_text(db, user_id="owner", evidence=text())
        append_assessment(db, user_id="owner", snapshot_id=snapshot.id, assessment=assessment())
        db.commit()
    engine.dispose()
