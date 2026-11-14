"""Explicit captures preserve evidence and dispatched input across provider changes."""
import asyncio
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import httpx
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from backend.api.deps import get_db, get_unified_fetcher
from backend.api.routes import comparison_captures as routes, market_briefing as briefings
from backend.auth.deps import get_current_user
from backend.config.settings import AppSettings
from backend.models import ComparisonCaptureORM, User
from backend.services import comparison_briefing as synthesis, llm_client
from backend.shared.db import Base
from backend.tests.test_comparison_briefing import _packet, _valid
from backend.tests.test_comparison_context_briefing import packet as context_packet, valid as context_valid

URL = "/api/market-context/briefing-captures"
SELECTION = {"anchor": " aapl ", "comparisons": ["spy", "SPY"], "period": "1M"}


@pytest.fixture
def store(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'captures.sqlite'}", connect_args={"check_same_thread": False})
    @sa.event.listens_for(engine, "connect")
    def foreign_keys(connection, record): connection.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine, tables=[User.__table__, ComparisonCaptureORM.__table__])
    factory = sessionmaker(bind=engine)
    with factory() as db:
        db.add_all([User(id=owner, email=f"{owner}@example.test", hashed_password="") for owner in ("owner", "other")])
        db.commit()
    owner = {"id": "owner"}
    app = FastAPI()
    app.include_router(routes.router)
    def session():
        with factory() as db: yield db
    app.dependency_overrides[get_db] = session
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=owner["id"])
    app.dependency_overrides[get_unified_fetcher] = lambda: SimpleNamespace()
    app.dependency_overrides[routes.get_economic_data_service] = lambda: SimpleNamespace()
    app.dependency_overrides[routes.get_sec_edgar_client] = lambda: SimpleNamespace()
    yield TestClient(app), factory, owner, engine
    engine.dispose()


def setup_provider(monkeypatch, *, context=False, replies=None, enabled=True, evidence_override=None):
    evidence = evidence_override if evidence_override is not None else context_packet() if context else _packet()
    settings = AppSettings(llm_enabled=enabled, llm_model="captured-model", llm_timeout_seconds=1,
                           llm_api_key="PRIVATE-CONFIGURED-KEY", llm_base_url="https://private-endpoint.test/v1")
    monkeypatch.setattr(routes, "get_settings", lambda: settings)
    calls, preparations = [], []
    async def prepare(*args, **kwargs):
        preparations.append((args, kwargs))
        return evidence
    if context:
        async def price(*args): return evidence.price, None
        monkeypatch.setattr(briefings, "_prepare_context_price", price)
        monkeypatch.setattr(briefings, "collect_context_evidence", prepare)
    else:
        monkeypatch.setattr(briefings, "prepare_comparison_briefing_evidence", prepare)
    responses = list(replies or [context_valid(evidence) if context else _valid(evidence)])
    def handle(request):
        if request.method == "GET": return httpx.Response(200, json={"data": []})
        body = json.loads(request.content)
        calls.append(body)
        response = responses[min(len(calls) - 1, len(responses) - 1)]
        if isinstance(response, int): return httpx.Response(response, json={"error": "unsupported"})
        if isinstance(response, str): content = response
        else: content = json.dumps(response)
        return httpx.Response(200, json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}]})
    original = httpx.AsyncClient
    monkeypatch.setattr(llm_client.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    return evidence, calls, preparations


def test_price_capture_offline_reopen_owner_isolation_delete_and_immutability(store, monkeypatch):
    client, factory, owner, engine = store
    evidence, calls, preparations = setup_provider(monkeypatch)
    response = client.post(URL, json=SELECTION)
    assert response.status_code == 201, response.text
    saved = response.json()
    content = saved["content"]
    assert content["selection"]["anchor"] == "AAPL" and content["selection"]["comparisons"] == ["SPY"]
    assert content["result"]["evidence"] == evidence.model_dump(mode="json")
    assert content["result"]["status"] == "complete"
    assert [attempt["body"] for attempt in content["generation"]["attempts"]] == calls
    assert "Respond with ONLY a single JSON" in calls[0]["messages"][-1]["content"]
    assert len(preparations) == 1
    assert "PRIVATE-CONFIGURED-KEY" not in response.text and "private-endpoint.test" not in response.text
    encoded = json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    assert saved["content_hash"] == hashlib.sha256(encoded.encode()).hexdigest()
    assert saved["retention"] == "retained_no_automatic_expiry"
    engine.dispose()
    async def forbidden(*args, **kwargs): pytest.fail("Reopening must not fetch or infer")
    monkeypatch.setattr(briefings, "_run_briefing", forbidden)
    assert client.get(f"{URL}/{saved['id']}").json() == saved
    summaries = client.get(URL).json()
    assert len(summaries) == 1 and "content" not in summaries[0]
    assert client.get(URL, params={"limit": 1, "offset": 1}).json() == []
    owner["id"] = "other"
    assert client.get(URL).json() == []
    assert client.get(f"{URL}/{saved['id']}").status_code == 404
    assert client.delete(f"{URL}/{saved['id']}").status_code == 404
    owner["id"] = "owner"
    with factory() as db:
        row = db.get(ComparisonCaptureORM, saved["id"])
        row.payload = {"overwrite": True}
        with pytest.raises(ValueError, match="immutable"): db.flush()
    assert client.delete(f"{URL}/{saved['id']}").status_code == 204
    assert client.get(f"{URL}/{saved['id']}").status_code == 404


def test_context_capture_retains_sources_and_exact_repair_input_without_rejected_prose(store, monkeypatch):
    client, _, _, _ = store
    evidence = context_packet()
    rejected = copy.deepcopy(context_valid(evidence))
    rejected["observations"][0]["citation_ids"] = ["P6"]
    rejected["observations"][0]["text"] = "REJECTED-PROSE-MUST-NOT-BE-SAVED"
    _, calls, _ = setup_provider(monkeypatch, context=True, replies=[400, rejected, context_valid(evidence)])
    result = client.post(URL, json={**SELECTION, "context": {"news": True, "macro_regions": ["us", "euro_area"]}})
    assert result.status_code == 201, result.text
    saved = result.json()
    assert saved["mode"] == "context" and saved["status"] == "complete"
    assert saved["content"]["result"]["evidence"] == evidence.model_dump(mode="json")
    attempts = saved["content"]["generation"]["attempts"]
    assert len(attempts) == 3 and [item["body"] for item in attempts] == calls
    assert calls[0]["response_format"]["type"] == "json_schema"
    assert calls[1]["response_format"]["type"] == "json_object"
    assert calls[2]["temperature"] == 0 and "Specific validator feedback" in calls[2]["messages"][-2]["content"]
    assert "REJECTED-PROSE" not in result.text
    assert client.get(f"{URL}/{saved['id']}").json() == saved


@pytest.mark.parametrize("enabled,replies,expected", [(False, None, "disabled"), (True, ["not valid JSON"], "invalid_response")])
def test_typed_model_failure_is_retained_with_evidence_not_partial_answer(store, monkeypatch, enabled, replies, expected):
    client, _, _, _ = store
    evidence, calls, _ = setup_provider(monkeypatch, enabled=enabled, replies=replies)
    response = client.post(URL, json=SELECTION)
    assert response.status_code == 201, response.text
    saved = response.json()
    result = saved["content"]["result"]
    assert result["status"] == "unavailable" and result["failure"]["code"] == expected
    assert result["evidence"] == evidence.model_dump(mode="json")
    assert result["observations"] == []
    assert len(calls) == (0 if not enabled else 2)
    assert client.get(f"{URL}/{saved['id']}").json() == saved


def test_evidence_timeout_records_failure_without_inventing_a_packet(store, monkeypatch):
    client, _, _, _ = store
    setup_provider(monkeypatch)
    async def timeout(*args, **kwargs): raise HTTPException(504)
    monkeypatch.setattr(briefings, "prepare_comparison_briefing_evidence", timeout)
    response = client.post(URL, json=SELECTION)
    assert response.status_code == 201, response.text
    content = response.json()["content"]
    assert content["result"]["evidence"] is None
    assert content["result"]["failure"]["code"] == "evidence_timed_out"
    assert content["generation"]["attempts"] == []


def test_provider_refresh_creates_distinct_capture_and_cannot_replace_original(store, monkeypatch):
    client, _, _, _ = store
    first, _, _ = setup_provider(monkeypatch, context=True)
    selection = {**SELECTION, "context": {"news": True, "macro_regions": ["us", "euro_area"]}}
    saved = client.post(URL, json=selection).json()
    from backend.services.market_briefing_context_evidence import build_context_evidence
    from backend.tests.test_market_briefing_context_evidence import headlines, NOW, fred, euro
    edited = headlines()
    edited.groups[0].headlines[0].title = "New title from the same URL"
    changed = build_context_evidence(first.price, first.requested, prepared_at=NOW,
        news={"P1": edited}, macro={("P1", "us"): fred(), ("P1", "euro_area"): euro()})
    setup_provider(monkeypatch, context=True, evidence_override=changed)
    second = client.post(URL, json=selection).json()
    assert second["id"] != saved["id"]
    assert second["content_hash"] != saved["content_hash"]
    assert second["content"]["result"]["evidence"]["packet_id"] != saved["content"]["result"]["evidence"]["packet_id"]
    assert "New title from the same URL" not in json.dumps(saved)
    assert client.get(f"{URL}/{saved['id']}").json() == saved
    assert len(client.get(URL).json()) == 2


def test_storage_failure_and_size_limit_do_not_claim_success(store, monkeypatch):
    client, factory, _, _ = store
    setup_provider(monkeypatch)
    monkeypatch.setattr(routes, "MAX_CAPTURE_BYTES", 1)
    assert client.post(URL, json=SELECTION).status_code == 413
    assert client.get(URL).json() == []
    monkeypatch.setattr(routes, "MAX_CAPTURE_BYTES", 4_000_000)
    def failed_commit(*args): raise RuntimeError("PRIVATE-DATABASE-DETAIL")
    monkeypatch.setattr(Session, "commit", failed_commit)
    response = client.post(URL, json=SELECTION)
    assert response.status_code == 503 and "PRIVATE-DATABASE-DETAIL" not in response.text
    assert client.get(URL).json() == []


@pytest.mark.parametrize("extra", [{"result": {}}, {"generation": {}}, {"context": {"unknown": True}}, {"comparisons": ["AAPL"]}])
def test_capture_rejects_client_results_and_invalid_selections_before_work(store, monkeypatch, extra):
    client, _, _, _ = store
    _, calls, preparations = setup_provider(monkeypatch)
    response = client.post(URL, json={**SELECTION, **extra})
    assert response.status_code == 422
    assert calls == [] and preparations == []


@pytest.mark.asyncio
async def test_dispatch_capture_is_detached_and_records_token_retry(monkeypatch):
    actual = []
    original = httpx.AsyncClient
    def handle(request):
        actual.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}, "finish_reason": "length" if len(actual) == 1 else "stop"}]})
    monkeypatch.setattr(llm_client.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    client = llm_client.LLMClient(base_url="https://example.test/v1", model="test", api_key="secret", structured_output="json")
    captured = []
    def record(body):
        captured.append(copy.deepcopy(body))
        body["messages"][0]["content"] = "observer mutation must not change request"
    await client.chat([{"role": "user", "content": "original"}], max_tokens=100, json_schema={"type": "object"}, on_request=record)
    assert captured == actual
    assert len(actual) == 2 and actual[1]["max_tokens"] > actual[0]["max_tokens"]
    assert actual[0]["messages"][0]["content"] == "original"


@pytest.mark.asyncio
async def test_capture_cancellation_leaves_no_saved_or_background_work(store, monkeypatch):
    _, factory, _, _ = store
    started, cancelled = asyncio.Event(), asyncio.Event()
    async def run(*args, **kwargs):
        started.set()
        try: await asyncio.sleep(60)
        finally: cancelled.set()
    monkeypatch.setattr(briefings, "_run_briefing", run)
    with factory() as db:
        task = asyncio.create_task(routes.create_capture(
            routes.ComparisonCaptureRequest(**SELECTION), user=SimpleNamespace(id="owner"), db=db,
            fetcher=None, economic_service=None, sec_client=None,
        ))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert cancelled.is_set()
        assert db.scalar(sa.select(sa.func.count()).select_from(ComparisonCaptureORM)) == 0


def migration():
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0020_comparison_captures.py"
    spec = importlib.util.spec_from_file_location("comparison_capture_migration_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_fresh_additive_migration_idempotence_rollback_and_account_delete():
    module = migration()
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(sa.text("PRAGMA foreign_keys=ON"))
        User.__table__.create(connection)
        connection.execute(sa.insert(User.__table__).values(id="owner", email="owner@example.test", hashed_password="", role="VIEWER"))
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade(); module.upgrade()
        connection.execute(sa.insert(ComparisonCaptureORM.__table__).values(
            id="saved", user_id="owner", captured_at=datetime.now(timezone.utc), mode="price", status="unavailable", content_hash="a"*64, payload={"original": "evidence"},
        ))
        module.downgrade(); module.upgrade()
        assert connection.execute(sa.select(ComparisonCaptureORM.payload)).scalar_one() == {"original": "evidence"}
        assert connection.execute(sa.text("SELECT email FROM users")).scalar_one() == "owner@example.test"
        connection.execute(sa.text("DELETE FROM users WHERE id='owner'"))
        assert connection.execute(sa.select(sa.func.count()).select_from(ComparisonCaptureORM)).scalar_one() == 0
    engine.dispose()


def test_postgres_ddl_is_additive_and_revision_fits(monkeypatch):
    module = migration()
    output = io.StringIO()
    module.op = Operations(MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output}))
    class Inspector:
        def get_table_names(self): return []
        def get_indexes(self, table): return []
    monkeypatch.setattr(module.sa, "inspect", lambda bind: Inspector())
    module.upgrade(); module.downgrade()
    ddl = output.getvalue()
    assert "JSON NOT NULL" in ddl and "TIMESTAMP WITH TIME ZONE" in ddl
    assert "REFERENCES users (id) ON DELETE CASCADE" in ddl
    assert "DROP" not in ddl and "UPDATE" not in ddl
    assert len(module.revision) <= 32 and module.down_revision == "0019_news_evidence"


@pytest.mark.parametrize("source", ["technical", "fundamentals"])
def test_current_optional_packets_reopen_with_original_versions_and_source_details(store, monkeypatch, source):
    if source == "technical":
        from backend.tests.test_technical_briefing_evidence import packet, answer
    else:
        from backend.tests.test_filing_context_synthesis import packet, answer
    evidence = packet()
    client, _, _, _ = store
    setup_provider(monkeypatch, context=True, evidence_override=evidence, replies=[answer(evidence)])
    selection = {"anchor": evidence.price.anchor, "comparisons": [pair.comparison.symbol for pair in evidence.price.comparisons],
                 "context": evidence.requested.model_dump(mode="json")}
    response = client.post(URL, json=selection)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["status"] == "complete"
    assert saved["content"]["result"]["evidence"] == evidence.model_dump(mode="json")
    assert saved["content"]["result"]["evidence"]["schema_version"] == ("2" if source == "fundamentals" else "1")
    assert client.get(f"{URL}/{saved['id']}").json() == saved


def test_capture_requires_login_before_source_or_model_work(store, monkeypatch):
    client, _, _, _ = store
    _, calls, preparations = setup_provider(monkeypatch)
    client.app.dependency_overrides.pop(get_current_user)
    assert client.post(URL, json=SELECTION).status_code == 401
    assert client.get(URL).status_code == 401
    assert calls == [] and preparations == []


def test_reopen_returns_retained_json_without_todays_schema_projection(store, monkeypatch):
    client, factory, _, _ = store
    setup_provider(monkeypatch)
    saved = client.post(URL, json=SELECTION).json()
    original = copy.deepcopy(saved["content"])
    original["result"]["retained_extension"] = {"original": "must survive read projection"}
    with factory() as db:
        # Simulate a retained version with an extension today's result model
        # does not know; privileged SQL is intentionally outside ORM guards.
        db.execute(sa.update(ComparisonCaptureORM).where(ComparisonCaptureORM.id == saved["id"]).values(payload=original))
        db.commit()
    assert client.get(f"{URL}/{saved['id']}").json()["content"] == original


@pytest.mark.parametrize("context,enabled", [(False, True), (True, True), (False, False)])
def test_capture_stream_acknowledges_only_committed_owner_record(store, monkeypatch, context, enabled):
    client, factory, owner, _ = store
    setup_provider(monkeypatch, context=context, enabled=enabled)
    selection = {**SELECTION, **({"context": {"news": True, "macro_regions": ["us", "euro_area"]}} if context else {})}
    response = client.post(f"{URL}/stream", json=selection)
    assert response.status_code == 200 and "application/x-ndjson" in response.headers["content-type"]
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[0]["type"] == "start" and events[0]["deadlines"]["model_seconds"] == 1
    assert events[-1]["type"] == "result"
    saved = events[-1]["result"]
    assert saved["mode"] == ("context" if context else "price")
    assert saved["status"] == ("complete" if enabled else "unavailable")
    assert client.get(f"{URL}/{saved['id']}").json() == saved
    owner["id"] = "other"
    assert client.get(f"{URL}/{saved['id']}").status_code == 404
    assert "PRIVATE-CONFIGURED-KEY" not in response.text and "private-endpoint.test" not in response.text


def test_stream_rejects_invalid_scope_before_headers_and_sanitizes_storage_failure(store, monkeypatch):
    client, _, _, _ = store
    _, calls, preparations = setup_provider(monkeypatch)
    assert client.post(f"{URL}/stream", json={**SELECTION, "comparisons": ["AAPL"]}).status_code == 422
    assert calls == [] and preparations == []
    def failure(*args): raise RuntimeError("PRIVATE-STORAGE-DETAIL")
    monkeypatch.setattr(Session, "commit", failure)
    response = client.post(f"{URL}/stream", json=SELECTION)
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]["type"] == "error" and events[-1]["error"]["code"] == "capture_not_confirmed"
    assert "PRIVATE-STORAGE-DETAIL" not in response.text
    assert client.get(URL).json() == []


@pytest.mark.asyncio
async def test_closing_capture_stream_cancels_collection_and_never_commits_partial_work(store, monkeypatch):
    _, factory, _, _ = store
    started, cancelled = asyncio.Event(), asyncio.Event()
    async def slow(*args, **kwargs):
        started.set()
        try: await asyncio.sleep(60)
        finally: cancelled.set()
    monkeypatch.setattr(briefings, "_run_briefing", slow)
    with factory() as db:
        response = await routes.stream_capture(routes.ComparisonCaptureRequest(**SELECTION),
            user=SimpleNamespace(id="owner"), db=db, fetcher=None, economic_service=None, sec_client=None)
        iterator = response.body_iterator
        assert json.loads(await anext(iterator))["type"] == "start"
        assert json.loads(await anext(iterator))["type"] == "progress"
        await started.wait()
        await iterator.aclose()
        assert cancelled.is_set()
        assert db.scalar(sa.select(sa.func.count()).select_from(ComparisonCaptureORM)) == 0
