"""Filing routing, honest lexical fallback and portable saved provenance."""
import asyncio
import json

import httpx
import pytest
from sqlalchemy import create_engine, create_mock_engine, event, inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.schema import DropTable

from backend.nlp import filing_parser as service, routes
from backend.services import llm_client
from backend.services.llm_profiles import resolve_llm_profile
from backend.tests.test_llm_profiles import settings


DOCS = [{"title": "Company update", "text": "Profit growth improved. A dividend was approved.", "published_at": "2026-10-01"}]


def configured(**overrides):
    return settings(**{"llm_deep_model": "deep-model", "llm_deep_base_url": "https://deep.example/v1",
                       "llm_deep_timeout_seconds": 600, "llm_deep_structured_output": "json", **overrides})


def answer(**overrides):
    return {"sentiment_score": 0.5, "sentiment_label": "positive", "summary": "The supplied update reports growth.",
            "catalysts": [{"title": "Dividend approved", "date": None, "type": "dividend", "confidence": 0.7}], **overrides}


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    with Session(engine) as session:
        yield session
    engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("deep", [False, True])
async def test_provider_transport_and_schema_use_selected_profile(monkeypatch, deep):
    monkeypatch.setattr(service, "get_settings", configured if deep else settings)
    requests = []
    def handle(request):
        requests.append(request)
        assert request.url.host == ("deep.example" if deep else "fast.example")
        assert request.headers.get("authorization") == (None if deep else "Bearer fast-test-secret")
        body = json.loads(request.content)
        assert body["model"] == ("deep-model" if deep else "fast-model")
        assert request.extensions["timeout"]["read"] == (600 if deep else 30)
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(answer())}, "finish_reason": "stop"}]})
    original = httpx.AsyncClient
    monkeypatch.setattr(llm_client.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    result = await service.parse_filing_documents("AAPL", DOCS)
    assert result["engine"] == "llm" and result["failure"] is None and len(requests) == 1
    assert result["model_profile"]["resolved_profile"] == ("deep" if deep else "fast")
    assert "example" not in json.dumps(result) and "test-secret" not in json.dumps(result)


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["disabled", "not_requested", "no_documents"])
async def test_no_model_paths_never_construct_provider(monkeypatch, mode):
    monkeypatch.setattr(service, "get_settings", lambda: configured(llm_enabled=mode != "disabled"))
    monkeypatch.setattr(service, "get_llm_client", lambda **kwargs: pytest.fail("No model was requested or available"))
    result = await service.parse_filing_documents("AAPL", [] if mode == "no_documents" else DOCS, use_llm=mode != "not_requested")
    assert result["engine"] == "lexical"
    assert (result["failure"]["code"] if result["failure"] else None) == (None if mode == "not_requested" else mode)
    assert (result["model_profile"] is None) == (mode == "not_requested")


@pytest.mark.asyncio
async def test_deep_failure_is_explicit_lexical_fallback_never_fast(monkeypatch):
    monkeypatch.setattr(service, "get_settings", configured)
    requests = []
    def handle(request):
        requests.append(request)
        assert request.url.host == "deep.example"
        return httpx.Response(503, json={"error": "unavailable"})
    original = httpx.AsyncClient
    monkeypatch.setattr(llm_client.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    result = await service.parse_filing_documents("AAPL", DOCS)
    assert len(requests) == 1 and result["engine"] == "lexical"
    assert result["failure"]["code"] == "provider_error" and result["model_profile"]["resolved_profile"] == "deep"


@pytest.mark.asyncio
async def test_whole_provider_operation_uses_profile_timeout_and_joins_cancellation(monkeypatch):
    monkeypatch.setattr(service, "get_settings", lambda: configured(llm_deep_timeout_seconds=0.01))
    cleaned = []
    class Client:
        async def chat(self, *args, **kwargs):
            try:
                await asyncio.Event().wait()
            finally:
                cleaned.append(True)
    monkeypatch.setattr(service, "get_llm_client", lambda **kwargs: Client())
    result = await service.parse_filing_documents("AAPL", DOCS)
    assert cleaned == [True] and result["failure"]["code"] == "timeout"
    assert result["engine"] == "lexical"


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", [{}, "not JSON", answer(sentiment_score=float("nan")), answer(sentiment_score=2), answer(summary=" "), answer(catalysts=[{}])])
async def test_malformed_generation_is_not_stored_as_model_extraction(monkeypatch, invalid):
    monkeypatch.setattr(service, "get_settings", configured)
    class Client:
        async def chat(self, *args, **kwargs): return json.dumps(invalid)
    monkeypatch.setattr(service, "get_llm_client", lambda **kwargs: Client())
    result = await service.parse_filing_documents("AAPL", DOCS)
    assert result["engine"] == "lexical" and result["failure"]["code"] == "invalid_response"


def test_saved_provenance_survives_reads_and_same_date_lexical_overwrite(db):
    profile = resolve_llm_profile(configured(), "filing_analysis")
    generated = {**answer(), "engine": "llm", "model_profile": profile.public_identity(), "failure": None}
    row = service.upsert_conviction_record(db, symbol="AAPL", market="US", record_date="2026-10-01", extraction=generated, source_count=1)
    assert row["engine"] == "llm" and row["model_profile"] == profile.public_identity()
    assert service.get_conviction_record(db, "AAPL")["model_profile"] == profile.public_identity()
    lexical = {**service._lexical_extract("AAPL", DOCS), "model_profile": None, "failure": None}
    replaced = service.upsert_conviction_record(db, symbol="AAPL", market="US", record_date="2026-10-01", extraction=lexical, source_count=1)
    assert replaced["engine"] == "lexical" and replaced["model_profile"] is None
    assert replaced["failure"] is None
    assert db.execute(text("SELECT COUNT(*) FROM stock_conviction_records")).scalar() == 1


def test_existing_legacy_rows_and_columns_are_unchanged_and_never_relabelled(db):
    service.upsert_conviction_record(db, symbol="OLD", market="US", record_date="2026-01-01", extraction={**answer(), "engine": "lmstudio"}, source_count=1)
    before = inspect(db.get_bind()).get_columns("stock_conviction_records")
    db.execute(DropTable(service._PROVENANCE)); db.commit()
    row = service.get_conviction_record(db, "OLD")
    assert row["engine"] == "lmstudio" and row["model_profile"] is None and row["failure"] is None
    assert row["catalysts"] == answer()["catalysts"]
    assert [col["name"] for col in inspect(db.get_bind()).get_columns("stock_conviction_records")] == [col["name"] for col in before]


def test_provenance_and_report_updates_are_atomic(db):
    service.ensure_conviction_table(db)
    def fail(conn, cursor, statement, parameters, context, executemany):
        if "INSERT INTO stock_conviction_provenance" in statement:
            raise RuntimeError("test write failure")
    event.listen(db.get_bind(), "before_cursor_execute", fail)
    try:
        with pytest.raises(RuntimeError, match="test write failure"):
            service.upsert_conviction_record(db, symbol="NEW", market="US", record_date="2026-10-01", extraction={**answer(), "engine": "llm"}, source_count=1)
        db.rollback()
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", fail)
    assert service.get_conviction_record(db, "NEW") is None


@pytest.mark.parametrize("dialect", ["sqlite", "postgresql"])
def test_legacy_and_companion_ddl_remain_portable(dialect):
    compiled = []
    engine = create_mock_engine(f"{dialect}://", lambda *args: None)
    class DB:
        def get_bind(self): return engine
        def execute(self, statement): compiled.append(str(statement.compile(dialect=engine.dialect)))
        def commit(self): pass
    service.ensure_conviction_table(DB())
    assert "CREATE TABLE IF NOT EXISTS stock_conviction_provenance" in compiled[-1]
    assert "PRIMARY KEY (symbol, market, record_date)" in compiled[-1]
    assert not any("ALTER TABLE" in statement for statement in compiled)
    if dialect == "postgresql":
        assert "SERIAL PRIMARY KEY" in compiled[0] and not any("AUTOINCREMENT" in statement or "PRAGMA" in statement for statement in compiled)


@pytest.mark.asyncio
async def test_stream_announces_snapshot_before_ingestion_and_closing_cancels_work(monkeypatch):
    monkeypatch.setattr(routes, "get_settings", configured)
    started, cleaned = asyncio.Event(), []
    async def ingest(*args, profile, **kwargs):
        assert profile.model == "deep-model"
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cleaned.append(True)
    monkeypatch.setattr(routes, "ingest_symbol_filings", ingest)
    response = await routes.stream_ingest_conviction(routes.ConvictionIngestRequest(symbol="AAPL"), None)
    iterator = response.body_iterator
    first = json.loads(await anext(iterator))
    assert first["model_profile"]["model"] == "deep-model" and first["deadlines"]["operation_seconds"] == 645
    await anext(iterator); await asyncio.wait_for(started.wait(), 1)
    await iterator.aclose()
    assert cleaned == [True]


@pytest.mark.asyncio
async def test_ingest_snapshot_persists_through_source_fetch_and_later_configuration_change(monkeypatch, db):
    monkeypatch.setattr(routes, "get_settings", configured)
    captured = []
    async def fetch(*args, **kwargs):
        monkeypatch.setattr(service, "get_settings", settings)
        return DOCS
    class Client:
        async def chat(self, *args, **kwargs): return json.dumps(answer())
    def client(*, profile):
        captured.append(profile)
        return Client()
    monkeypatch.setattr(service, "fetch_public_filings", fetch)
    monkeypatch.setattr(service, "get_llm_client", client)
    row = await routes.post_ingest_conviction(routes.ConvictionIngestRequest(symbol="AAPL"), db)
    assert len(captured) == 1 and captured[0].model == "deep-model"
    assert row["model_profile"] == captured[0].public_identity()
    assert service.get_conviction_record(db, "AAPL")["model_profile"] == captured[0].public_identity()
