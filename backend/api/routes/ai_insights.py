"""LLM-powered AI insight endpoints.

Read-only analytical endpoints that turn structured terminal data into a concise,
sectioned narrative via a local LLM:

* ``GET  /api/ai/briefing/{ticker}``     - investment briefing for a stock
* ``GET  /api/ai/interrogate/{ticker}``  - adversarial interrogation of a stock,
  grounded in the user's own notes (v1.2 "research interrogates")
* ``POST /api/ai/backtest-explain``      - plain-English assessment of a backtest
* ``POST /api/ai/risk-insights``         - narrative interpretation of portfolio risk

All share one structured-output schema (``llm_insights.INSIGHT_SCHEMA``) and
degrade gracefully when LLM is unavailable.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.api.deps import cache_instance, fetch_stock_snapshot_coalesced, get_db
from backend.api.routes.news import _fetch_news_fallback, _ticker_fallback_terms
from backend.auth.deps import get_current_user
from backend.core.ttl_policy import market_open_now, ttl_seconds
from backend.models.notes import NoteORM
from backend.models.user import User
from backend.services.brain import brain_service
from backend.services.llm_insights import run_insight

router = APIRouter()


def _fmt(value: Any, suffix: str = "") -> str:
    if value is None or value == "":
        return "n/a"
    try:
        return f"{float(value):,.2f}{suffix}"
    except (TypeError, ValueError):
        return str(value)


def _interrogation_prompts(
    symbol: str,
    snap: dict[str, Any],
    headlines: list[str],
    note_texts: list[str],
    related_texts: list[str] | None = None,
) -> tuple[str, str]:
    """Build the (system, user) prompt for an adversarial stock interrogation.

    Pure and side-effect-free so it's unit-testable: the user's own notes are
    folded in verbatim (capped upstream) as the thesis to pressure-test.
    ``related_texts`` are the user's semantically-related notes on *other*
    tickers/themes (via the second-brain index), so the model can cross-reference
    the thesis against the user's wider recorded thinking. The output contract
    stays the shared INSIGHT_SCHEMA {summary, sections}."""
    name = snap.get("company_name") or snap.get("name") or symbol
    facts = "\n".join(
        [
            f"Sector: {snap.get('sector') or 'n/a'} | Industry: {snap.get('industry') or 'n/a'}",
            f"Price: {_fmt(snap.get('current_price'))} | Day change: {_fmt(snap.get('change_pct'), '%')}",
            f"Market cap: {_fmt(snap.get('market_cap'))}",
            f"P/E: {_fmt(snap.get('pe_ratio') or snap.get('pe'))} | "
            f"P/B: {_fmt(snap.get('pb_ratio') or snap.get('pb'))}",
            f"ROE: {_fmt(snap.get('roe'))} | Debt/Equity: {_fmt(snap.get('debt_to_equity'))}",
            f"52-week range: {_fmt(snap.get('week52_low'))} - {_fmt(snap.get('week52_high'))}",
        ]
    )
    news_block = "\n".join(f"- {h}" for h in headlines) or "- (no recent headlines available)"
    notes_block = "\n".join(f"- {t}" for t in note_texts) or "- (you have recorded no notes on this stock yet)"
    related = related_texts or []
    related_block = "\n".join(f"- {t}" for t in related)

    system_prompt = (
        "You are a sharp, skeptical devil's-advocate analyst for a professional "
        "trader — the opposite of a cheerleader. Your job is to INTERROGATE the bull "
        "case for a stock, not sell it. Using the fundamentals, recent headlines, and "
        "especially the user's own notes, state the prevailing narrative plainly and "
        "then pressure-test it: surface the assumptions it rests on, the ways it could "
        "be wrong, relevant base rates, and whether the story is already reflected in "
        "the price. Where the user's notes assert a thesis, challenge it directly and "
        "on its own terms. When the user's related notes on OTHER tickers or themes "
        "reveal a recurring pattern — the same bet, bias, or blind spot they keep "
        "returning to — name it explicitly, because that is exactly what a person is "
        "least able to see in themselves. Be specific and grounded in the data "
        "provided; do NOT give direct buy or sell advice, and do not flatter. Provide "
        "exactly these sections: 'The Bull Narrative' (tone neutral) - the story being "
        "told, including the user's if present; 'What Would Have To Be True' (tone "
        "neutral) - the load-bearing assumptions behind it; 'The Bear Case & Base "
        "Rates' (tone negative) - what would break it and how often such stories "
        "disappoint; 'Already Priced In?' (tone neutral) - whether the valuation and "
        "price action already reflect the narrative."
    )
    user_content = (
        f"Company: {name} ({symbol})\n\n"
        f"Fundamentals:\n{facts}\n\n"
        f"Recent headlines:\n{news_block}\n\n"
        f"The user's own notes on {symbol} (their recorded thesis - challenge it directly):\n{notes_block}"
    )
    if related:
        user_content += (
            f"\n\nThe user's related notes on OTHER tickers/themes (cross-reference the "
            f"thesis against these — flag if it repeats a pattern the user expresses "
            f"elsewhere):\n{related_block}"
        )
    return system_prompt, user_content


@router.get("/ai/briefing/{ticker}")
async def stock_briefing(
    ticker: str,
    market: str | None = Query(default=None, description="Optional market context"),
) -> dict[str, Any]:
    """Return an AI investment briefing synthesizing fundamentals and news."""
    symbol = ticker.strip().upper()
    market_code = (market or "").strip().upper() or None
    cache_key = cache_instance.build_key("ai_insight", f"briefing:{symbol}", {"market": market_code or ""})
    cached = await cache_instance.get(cache_key)
    if cached:
        return cached

    snap = await fetch_stock_snapshot_coalesced(symbol) or {}
    headlines: list[str] = []
    for term in _ticker_fallback_terms(symbol, market_code):
        items = await _fetch_news_fallback(term, limit=6)
        if items:
            headlines = [str(i.get("title") or "").strip() for i in items[:6] if i.get("title")]
            break

    name = snap.get("company_name") or snap.get("name") or symbol
    facts = "\n".join(
        [
            f"Company: {name} ({symbol})",
            f"Sector: {snap.get('sector') or 'n/a'} | Industry: {snap.get('industry') or 'n/a'}",
            f"Price: {_fmt(snap.get('current_price'))} | Day change: {_fmt(snap.get('change_pct'), '%')}",
            f"Market cap: {_fmt(snap.get('market_cap'))}",
            f"P/E: {_fmt(snap.get('pe_ratio') or snap.get('pe'))} | "
            f"P/B: {_fmt(snap.get('pb_ratio') or snap.get('pb'))}",
            f"ROE: {_fmt(snap.get('roe'))} | Debt/Equity: {_fmt(snap.get('debt_to_equity'))}",
            f"52-week range: {_fmt(snap.get('week52_low'))} - {_fmt(snap.get('week52_high'))}",
        ]
    )
    news_block = "\n".join(f"- {h}" for h in headlines) or "- (no recent headlines available)"

    system_prompt = (
        "You are an equity research analyst. Produce a concise, balanced investment "
        "briefing for a professional trader from the data provided. Be specific and "
        "factual; do NOT give direct buy or sell advice. Provide exactly these "
        "sections: 'Bull Case' (tone positive), 'Bear Case' (tone negative), and "
        "'Key Risks' (tone negative or neutral)."
    )
    user_content = f"Fundamentals:\n{facts}\n\nRecent headlines:\n{news_block}"

    result = await run_insight(
        system_prompt,
        user_content,
        max_tokens=900,
        unavailable_summary=(
            f"AI briefing for {symbol} is unavailable - start your local LLM (Ollama) "
            "model to enable it."
        ),
    )
    payload = {"ticker": symbol, "company_name": name, **result}
    await cache_instance.set(cache_key, payload, ttl=ttl_seconds("news_latest", market_open_now()))
    return payload


@router.get("/ai/interrogate/{ticker}")
async def interrogate_stock(
    ticker: str,
    market: str | None = Query(default=None, description="Optional market context"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Adversarially interrogate a stock, grounded in the user's own notes.

    The differentiator of v1.2: instead of another bullish briefing, this turns
    the local model on the *bull case* — and specifically on the user's recorded
    thesis for the ticker — to pressure-test it rather than flatter it. Authed and
    per-user: it reads this user's `security`/symbol notes.
    """
    symbol = ticker.strip().upper()
    market_code = (market or "").strip().upper() or None

    # Cache per user — the interrogation folds in THIS user's private notes, so
    # two users must not share a cached result for the same symbol.
    cache_key = cache_instance.build_key(
        "ai_insight", f"interrogate:{symbol}:{current_user.id}", {"market": market_code or ""}
    )
    cached = await cache_instance.get(cache_key)
    if cached:
        return cached

    # The user's own notes on this exact ticker — their recorded thesis. Direct,
    # precise, symbol-scoped (no embedding round-trip needed for "my notes on X").
    notes = (
        db.query(NoteORM)
        .filter(NoteORM.user_id == current_user.id, NoteORM.symbol == symbol)
        .order_by(NoteORM.updated_at.desc())
        .limit(12)
        .all()
    )
    note_texts: list[str] = []
    for note in notes:
        title = (note.title or "").strip()
        body = (note.body or "").strip()
        text = f"{title}: {body}" if title and body else (title or body)
        if text:
            note_texts.append(text[:600])

    snap = await fetch_stock_snapshot_coalesced(symbol) or {}
    name = snap.get("company_name") or snap.get("name") or symbol
    headlines: list[str] = []
    for term in _ticker_fallback_terms(symbol, market_code):
        items = await _fetch_news_fallback(term, limit=6)
        if items:
            headlines = [str(i.get("title") or "").strip() for i in items[:6] if i.get("title")]
            break

    # Broaden the grounding beyond same-ticker notes: semantically retrieve the
    # user's related notes on OTHER tickers/themes from their second brain, so the
    # interrogation can cross-reference the thesis against their wider thinking
    # (e.g. the same bet made elsewhere). Best-effort — degrades to nothing when the
    # brain is empty or embeddings are unavailable, never failing the endpoint.
    related_query = " ".join(
        [name, symbol, str(snap.get("sector") or ""), *note_texts]
    ).strip()
    related = await brain_service.related_notes(
        db, str(current_user.id), related_query, exclude_symbol=symbol, k=4
    )
    related_texts = [
        f"[on {r['symbol']}] {r['text']}" if r.get("symbol") else r["text"]
        for r in related
    ]

    system_prompt, user_content = _interrogation_prompts(
        symbol, snap, headlines, note_texts, related_texts
    )
    result = await run_insight(
        system_prompt,
        user_content,
        max_tokens=1000,
        unavailable_summary=(
            f"AI interrogation for {symbol} is unavailable - start your local LLM (e.g. Ollama) "
            "to pressure-test your thesis."
        ),
    )
    payload = {
        "ticker": symbol,
        "note_count": len(note_texts),
        "related_count": len(related_texts),
        **result,
    }
    await cache_instance.set(cache_key, payload, ttl=ttl_seconds("news_latest", market_open_now()))
    return payload


@router.post("/ai/backtest-explain")
async def backtest_explain(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a plain-English assessment of a backtest result."""
    metrics = payload.get("metrics") if isinstance(payload, dict) else None
    metrics = metrics if isinstance(metrics, dict) else {}
    strategy = str((payload or {}).get("strategy") or "the strategy").strip() or "the strategy"

    system_prompt = (
        "You are a quantitative strategy analyst. Assess a backtest result for a "
        "professional trader. Judge return quality, risk-adjusted performance, "
        "drawdown severity, and sample robustness. Flag likely overfitting when the "
        "trade sample is small or metrics look unrealistically strong. Provide "
        "exactly these sections: 'Strengths' (tone positive), 'Weaknesses' (tone "
        "negative), and 'Overfitting & Robustness' (tone neutral or negative)."
    )
    user_content = (
        f"Strategy: {strategy}\n"
        f"Backtest metrics (JSON):\n{json.dumps(metrics, default=str)[:1600]}"
    )
    return await run_insight(
        system_prompt,
        user_content,
        max_tokens=900,
        unavailable_summary="AI backtest analysis is unavailable - start your local LLM (e.g. Ollama).",
    )


@router.post("/ai/collection-briefing")
async def collection_briefing(payload: dict[str, Any]) -> dict[str, Any]:
    """Return an AI briefing for a collection of symbols (Screener/Watchlist)."""
    symbols = payload.get("symbols") or []
    if not isinstance(symbols, list):
        symbols = []
    symbols = [str(s).strip().upper() for s in symbols[:10] if s]
    scope = str(payload.get("scope") or "collection").strip()

    if not symbols:
        return {
            "engine": "unavailable",
            "summary": "No symbols provided for AI analysis.",
            "sections": [],
        }

    system_prompt = (
        f"You are a market analyst. Assess this {scope} of {len(symbols)} stocks. "
        "Summarize the collective themes, sector distribution, and technical/fundamental "
        "posture. Provide exactly these sections: 'Themes & Posture' (tone neutral), "
        "'Top Picks' (tone positive), and 'Risks' (tone negative)."
    )
    user_content = f"Symbols: {', '.join(symbols)}\nContext: Analysis of a filtered {scope}."

    return await run_insight(
        system_prompt,
        user_content,
        max_tokens=900,
        unavailable_summary=f"AI {scope} analysis is unavailable - start your local LLM (e.g. Ollama).",
    )


@router.post("/ai/risk-insights")
async def risk_insights(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a narrative interpretation of portfolio/ticker risk metrics."""
    metrics = payload.get("metrics") if isinstance(payload, dict) else None
    metrics = metrics if isinstance(metrics, dict) else {}
    scope = str((payload or {}).get("scope") or "the portfolio").strip() or "the portfolio"

    system_prompt = (
        "You are a portfolio risk analyst. Interpret the risk metrics for a "
        "professional trader in plain English. Highlight tail risk, volatility, "
        "concentration, correlation clustering, and factor exposure. Provide exactly "
        "these sections: 'Risk Posture' (tone neutral), 'Concentration & "
        "Correlation' (tone negative or neutral), and 'Recommendations' (tone neutral)."
    )
    user_content = (
        f"Scope: {scope}\n"
        f"Risk metrics (JSON):\n{json.dumps(metrics, default=str)[:2000]}"
    )
    return await run_insight(
        system_prompt,
        user_content,
        max_tokens=900,
        unavailable_summary="AI risk analysis is unavailable - start your local LLM (e.g. Ollama).",
    )
