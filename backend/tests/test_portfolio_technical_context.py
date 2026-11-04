"""Held-symbol scope, optional-source bounds and portfolio interpretation limits."""
import asyncio
import json
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from fastapi import HTTPException
from pydantic import ValidationError

from backend.api.routes import ai_insights as routes
from backend.models import PortfolioORM, PortfolioHoldingORM
from backend.services import portfolio_technical_context as technical, llm_insights
from backend.services import research_technical_context as research
from backend.services.llm_profiles import resolve_llm_profile
from backend.tests.test_research_technical_context import evidence
from backend.tests.test_shared_insight_profiles import configured, content


def context(kinds=("complete", "complete")):
    groups = []
    for index, (symbol, kind) in enumerate(zip(["AAPL", "BTC-USD"], kinds), 1):
        data = evidence(kind, symbol).model_dump()
        for number, metric in enumerate(data["metrics"], 1): metric["citation_id"] = f"H{index}.{number}"
        groups.append(technical.HoldingTechnicalEvidence.model_validate(data))
    count = sum(m.status == "available" for g in groups for m in g.metrics)
    return technical.PortfolioTechnicalContext(portfolio_id="p1", selected_symbols=[g.symbol for g in groups], total_held_symbols=4,
        status="available" if count == len(groups) * 3 else "partial" if count else "unavailable", groups=groups,
        positions=[technical.TechnicalPosition(symbol=g.symbol, quantity=12 if g.symbol == "AAPL" else .4, lot_count=2,
            recorded_cost_currencies=["USD"] if g.symbol == "AAPL" else [], unknown_cost_currency=g.symbol != "AAPL") for g in groups])


@pytest.mark.parametrize("extra", [
    {"technical_symbols": ["AAPL"]}, {"portfolio_id": "p1", "technical_symbols": ["AAPL"] * 2},
    {"portfolio_id": "p1", "technical_symbols": ["A", "B", "C", "D"]},
    {"portfolio_id": "p1", "technical_symbols": ["bad/symbol"]}, {"technical_symbols": None},
    {"metrics": {"oversize": "x" * 32001}}, {"metrics": {"bad": float("nan")}},
])
def test_request_bounds_reject_invalid_scope_and_oversized_unserializable_evidence(extra):
    with pytest.raises(ValidationError): technical.RiskInsightRequest(**extra)


def test_normalization_and_risk_evidence_are_not_silently_truncated():
    request = technical.RiskInsightRequest(portfolio_id="p1", technical_symbols=[" aapl ", "btc-usd"], metrics={"long": "x" * 2100, "zero": 0})
    assert request.technical_symbols == ["AAPL", "BTC-USD"] and len(request.metrics["long"]) == 2100
    assert request.metrics["zero"] == 0


@pytest.fixture
def db():
    engine = sa.create_engine("sqlite:///:memory:")
    PortfolioORM.__table__.create(engine); PortfolioHoldingORM.__table__.create(engine)
    with Session(engine) as session:
        session.add(PortfolioORM(id="p1", user_id="alice", name="Core", currency="EUR"))
        for symbol, shares, currency, lot in [("AAPL", 7, "USD", "a"), ("AAPL", 5, "EUR", "b"), ("BTC-USD", .4, None, "c"), ("SPY", 2, "USD", "d"), ("QQQ", 0, "USD", "e")]:
            session.add(PortfolioHoldingORM(portfolio_id="p1", symbol=symbol, shares=shares, cost_basis_currency=currency, cost_basis_per_share=1, lot_id=lot))
        session.commit()
        yield session
    engine.dispose()


def request(symbols=None, portfolio_id="p1"):
    return technical.RiskInsightRequest(portfolio_id=portfolio_id, technical_symbols=symbols or ["AAPL", "BTC-USD"])


def test_scope_aggregates_only_current_owned_lots_and_never_invents_value_weights(db):
    total, positions = technical.owned_technical_positions(db, "alice", request())
    assert total == 3 and positions[0].quantity == 12 and positions[0].lot_count == 2
    assert positions[0].recorded_cost_currencies == ["EUR", "USD"]
    assert positions[1].unknown_cost_currency is True and positions[1].recorded_cost_currencies == []
    assert "weight" not in positions[0].model_dump()
    for owner, req, status in [("bob", request(), 404), ("alice", request(portfolio_id="missing"), 404),
                                ("alice", request(["TSLA"]), 422), ("alice", request(["QQQ"]), 422)]:
        with pytest.raises(HTTPException) as exc: technical.owned_technical_positions(db, owner, req)
        assert exc.value.status_code == status


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
async def test_foreign_portfolios_and_unheld_symbols_fail_before_market_or_model_work(monkeypatch, db, stream):
    async def forbidden(*args, **kwargs): pytest.fail("Invalid owner/scope must not fetch evidence or call a model")
    monkeypatch.setattr(routes, "_risk_insights", forbidden)
    for owner, symbols, status in [("bob", ["AAPL"], 404), ("alice", ["TSLA"], 422)]:
        with pytest.raises(HTTPException) as exc:
            if stream:
                await routes.insight_stream(routes.InsightStreamRequest(kind="risk", payload=request(symbols).model_dump()), db, SimpleNamespace(id=owner))
            else: await routes.risk_insights(request(symbols), db, SimpleNamespace(id=owner))
        assert exc.value.status_code == status


@pytest.mark.parametrize("summary", ["Only first holding [H1.1]", "Invented [H1.1] [H9.9]", "No citations"])
def test_required_references_are_per_available_selected_holding(summary):
    with pytest.raises(llm_insights.InvalidInsightResponse): technical.validate_portfolio_technical_references(summary, [], context())


def test_partial_zero_and_unavailable_references_keep_exact_source_identities():
    value = context(("zero", "partial"))
    technical.validate_portfolio_technical_references("Observed [H1.1] [H2.1]", [], value)
    assert value.groups[0].metrics[0].value == 0
    assert value.groups[0].snapshot_id == evidence("zero").snapshot_id
    with pytest.raises(llm_insights.InvalidInsightResponse): technical.validate_portfolio_technical_references("Missing [H1.1] [H2.3]", [], value)
    technical.validate_portfolio_technical_references("No usable technical history", [], context(("unavailable", "unavailable")))


def test_prompt_keeps_position_units_dates_and_coverage_distinct_from_portfolio_risk():
    system, facts = technical.portfolio_technical_prompts("Original risk prompt", "Original supplied metrics", context())
    assert system.startswith("Original risk prompt") and facts.startswith("Original supplied metrics")
    for rule in ["not value weights", "NOT portfolio volatility", "Do not average", "unselected holdings", "past investor knowledge", "RSI/MACD"]:
        assert rule.lower() in system.lower()
    assert '"total_held_symbols":4' in facts and '"citation_id":"H2.1"' in facts


@pytest.mark.asyncio
async def test_batch_preserves_finished_assets_when_others_time_out_and_joins_children(monkeypatch):
    original_timeout = asyncio.timeout
    monkeypatch.setattr(research.asyncio, "timeout", lambda _: original_timeout(.01))
    cleaned = []
    async def collect(symbol, factory):
        if symbol == "AAPL": return evidence()
        try: await asyncio.Event().wait()
        finally: cleaned.append(symbol)
    monkeypatch.setattr(technical, "collect_research_technical_evidence", collect)
    result = await technical.collect_portfolio_technical_context(request(), 4, context().positions, lambda: None)
    assert cleaned == ["BTC-USD"] and result.status == "partial"
    assert result.groups[0].status == "available" and result.groups[1].input_reason == "provider_timeout"


@pytest.mark.asyncio
@pytest.mark.parametrize("stream,valid_repair", [(False, True), (True, True), (True, False)])
async def test_same_profile_reference_repair_and_failed_model_keep_entire_technical_context(monkeypatch, stream, valid_repair):
    value = context()
    async def collect(*args): return value
    monkeypatch.setattr(routes, "collect_portfolio_technical_context", collect)
    profile = resolve_llm_profile(configured(), "portfolio_risk")
    calls = []
    class Client:
        async def health(self): return True
        async def chat(self, messages, **kwargs):
            calls.append(messages)
            result = content()
            result["summary"] = "Conditional per-holding interpretation [H1.1] [H2.1]." if valid_repair and (stream or len(calls) > 1) else "Invalid [H9.9]"
            return json.dumps(result)
        async def chat_stream(self, messages, **kwargs):
            yield json.dumps({**content(), "summary": "Invalid [H9.9]"})
    def client(**kwargs):
        assert kwargs["profile"] is profile
        return Client()
    monkeypatch.setattr(llm_insights, "get_llm_client", client)
    result = await routes._risk_insights(request().model_dump(), profile=profile, position_scope=(4, value.positions), on_token=(lambda text: None) if stream else None)
    assert result["portfolio_technical_context"] == value.model_dump(mode="json")
    assert result["model_profile"] == profile.public_identity()
    assert result["engine"] == ("llm" if valid_repair else "unavailable")
    assert len(calls) == (1 if stream and valid_repair else 2)
    if not valid_repair: assert result["failure"]["code"] == "invalid_response"


@pytest.mark.asyncio
async def test_disabled_generation_performs_no_history_fetch(monkeypatch):
    async def forbidden(*args): pytest.fail("Disabled models must not collect optional history")
    monkeypatch.setattr(routes, "collect_portfolio_technical_context", forbidden)
    result = await routes._risk_insights(request().model_dump(), profile=resolve_llm_profile(configured(llm_enabled=False), "portfolio_risk"))
    assert result["failure"]["code"] == "disabled" and "portfolio_technical_context" not in result


def test_browser_contract_fixtures_match_server_projection():
    from pathlib import Path
    values = json.loads((Path(__file__).resolve().parents[2] / "frontend/src/__tests__/fixtures/portfolioTechnicalContext.json").read_text())
    for name, kinds in [("complete", ("complete", "complete")), ("partial", ("zero", "partial")), ("unavailable", ("unavailable", "unavailable")), ("modelFailure", ("complete", "complete"))]:
        result = routes.RiskInsightEnvelope.model_validate(values[name])
        assert result.portfolio_technical_context == context(kinds)
        if values[name]["engine"] == "llm": technical.validate_portfolio_technical_references(values[name]["summary"], values[name]["sections"], result.portfolio_technical_context)
