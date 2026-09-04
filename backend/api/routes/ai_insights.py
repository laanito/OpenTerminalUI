"""LLM-powered AI insight endpoints.

Read-only analytical endpoints that turn structured terminal data into a concise,
sectioned narrative via a local LLM:

* ``GET  /api/ai/briefing/{ticker}``     - asset-aware investment briefing
* ``GET  /api/ai/interrogate/{ticker}``  - asset-aware adversarial interrogation,
  grounded in the user's own notes (v1.2 "research interrogates")
* ``POST /api/ai/backtest-explain``      - plain-English assessment of a backtest
* ``POST /api/ai/risk-insights``         - narrative interpretation of portfolio risk

All share one structured-output schema (``llm_insights.INSIGHT_SCHEMA``) and
degrade gracefully when LLM is unavailable.
"""

from __future__ import annotations

import json
import math
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.api.deps import cache_instance, fetch_stock_snapshot_coalesced, get_db
from backend.api.routes.news import _fetch_news_fallback, _ticker_fallback_terms
from backend.auth.deps import get_current_user
from backend.core.ttl_policy import market_open_now, ttl_seconds
from backend.models.brain import BrainChunkORM
from backend.models.notes import NoteORM
from backend.models.user import User
from backend.services.brain import brain_service
from backend.services.crypto_fundamentals import get_fundamentals as get_crypto_fundamentals
from backend.services.llm_insights import run_insight
from backend.services.llm_sentiment import score_articles
from backend.services.news_terms import INDEX_NAME_BY_SYMBOL, is_index_symbol
from backend.shared.market_classifier import is_crypto_symbol

router = APIRouter()

AssetType = Literal["equity", "crypto", "index"]


def _fmt(value: Any, suffix: str = "") -> str:
    if value is None or value == "":
        return "n/a"
    try:
        return f"{float(value):,.2f}{suffix}"
    except (TypeError, ValueError):
        return str(value)


def _finite_observation(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _asset_type(symbol: str, market: str | None = None) -> AssetType:
    market_code = (market or "").strip().upper()
    if is_index_symbol(symbol):
        return "index"
    if market_code == "CRYPTO" or is_crypto_symbol(symbol):
        return "crypto"
    return "equity"


def _asset_name(
    symbol: str,
    asset_type: AssetType,
    snap: dict[str, Any],
    crypto: dict[str, Any] | None = None,
) -> str:
    if asset_type == "index":
        return INDEX_NAME_BY_SYMBOL.get(symbol, snap.get("name") or symbol)
    if asset_type == "crypto" and crypto:
        return str(crypto.get("name") or snap.get("name") or symbol)
    return str(snap.get("company_name") or snap.get("name") or symbol)


def _asset_facts(
    asset_type: AssetType,
    snap: dict[str, Any],
    crypto: dict[str, Any] | None = None,
) -> str:
    """Format only facts that make sense for this asset class."""
    if asset_type == "index":
        return "\n".join(
            [
                f"Index level: {_fmt(snap.get('current_price'))}",
                f"Day change: {_fmt(snap.get('change_pct'), '%')}",
                f"52-week range: {_fmt(snap.get('week52_low'))} - {_fmt(snap.get('week52_high'))}",
            ]
        )

    if asset_type == "crypto":
        fundamentals = crypto or {}
        tokenomics = fundamentals.get("tokenomics") if isinstance(fundamentals.get("tokenomics"), dict) else {}
        valuation = fundamentals.get("valuation") if isinstance(fundamentals.get("valuation"), dict) else {}
        onchain = fundamentals.get("onchain") if isinstance(fundamentals.get("onchain"), dict) else {}
        return "\n".join(
            [
                f"Price: {_fmt(snap.get('current_price'))} | 24h change: {_fmt(snap.get('change_pct'), '%')}",
                f"Market cap: {_fmt(valuation.get('market_cap') or snap.get('market_cap'))} | "
                f"Fully diluted valuation: {_fmt(valuation.get('fully_diluted_valuation'))}",
                f"Circulating supply: {_fmt(tokenomics.get('circulating_supply'))} | "
                f"Supply circulating: {_fmt(tokenomics.get('circulating_pct'), '%')}",
                f"FDV/market-cap: {_fmt(valuation.get('fdv_mcap_ratio'))} | "
                f"ATH change: {_fmt(valuation.get('ath_change_pct'), '%')}",
                f"TVL: {_fmt(onchain.get('tvl'))} | Annualized fees: {_fmt(onchain.get('fees_annualized'))}",
            ]
        )

    return "\n".join(
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


async def _crypto_context(symbol: str, asset_type: AssetType) -> dict[str, Any] | None:
    if asset_type != "crypto":
        return None
    try:
        return await get_crypto_fundamentals(symbol)
    except Exception:  # noqa: BLE001 - optional provider context must not break AI analysis
        return None


def _note_cache_version(db: Session, user_id: str) -> str:
    """Fingerprint source notes and their asynchronously refreshed brain index."""
    note_count, latest_note_update = (
        db.query(func.count(NoteORM.id), func.max(NoteORM.updated_at))
        .filter(NoteORM.user_id == user_id)
        .one()
    )
    chunk_count, latest_chunk_update = (
        db.query(func.count(BrainChunkORM.id), func.max(BrainChunkORM.updated_at))
        .filter(BrainChunkORM.user_id == user_id, BrainChunkORM.source == "note")
        .one()
    )
    note_stamp = latest_note_update.isoformat() if latest_note_update else "-"
    chunk_stamp = latest_chunk_update.isoformat() if latest_chunk_update else "-"
    return f"notes:{int(note_count or 0)}:{note_stamp}|index:{int(chunk_count or 0)}:{chunk_stamp}"


def _briefing_prompts(
    symbol: str,
    asset_type: AssetType,
    snap: dict[str, Any],
    headlines: list[str],
    crypto: dict[str, Any] | None = None,
) -> tuple[str, str]:
    name = _asset_name(symbol, asset_type, snap, crypto)
    facts = _asset_facts(asset_type, snap, crypto)
    news_block = "\n".join(f"- {h}" for h in headlines) or "- (no recent headlines available)"

    if asset_type == "crypto":
        system_prompt = (
            "You are a skeptical crypto-asset research analyst. Produce a concise, balanced "
            "briefing using only the supplied market, tokenomics, on-chain, and news context. "
            "Do not invent protocol usage or treat a token like a company. Do NOT give direct "
            "buy or sell advice. Provide exactly these sections: 'Adoption & Utility' (tone "
            "positive or neutral), 'Tokenomics & Valuation' (tone neutral), and 'Key Risks' "
            "(tone negative or neutral)."
        )
        label = "Crypto asset"
    elif asset_type == "index":
        system_prompt = (
            "You are a skeptical cross-asset market strategist. Produce a concise, balanced "
            "briefing on a market index using only the supplied index-level and news context. "
            "An index is not an issuer: do not discuss company fundamentals, corporate debt, "
            "or management. Do NOT give direct buy or sell advice. Provide exactly these "
            "sections: 'Supportive Regime' (tone positive or neutral), 'Headwinds' (tone "
            "negative or neutral), and 'Key Risks' (tone negative or neutral)."
        )
        label = "Market index"
    else:
        system_prompt = (
            "You are an equity research analyst. Produce a concise, balanced investment "
            "briefing for a professional trader from the data provided. Be specific and "
            "factual; do NOT give direct buy or sell advice. Provide exactly these "
            "sections: 'Bull Case' (tone positive), 'Bear Case' (tone negative), and "
            "'Key Risks' (tone negative or neutral)."
        )
        label = "Company"

    user_content = f"{label}: {name} ({symbol})\n\nFacts:\n{facts}\n\nRecent headlines:\n{news_block}"
    return system_prompt, user_content


def _interrogation_prompts(
    symbol: str,
    snap: dict[str, Any],
    headlines: list[str],
    note_texts: list[str],
    related_texts: list[str] | None = None,
    *,
    asset_type: AssetType = "equity",
    crypto: dict[str, Any] | None = None,
) -> tuple[str, str]:
    """Build an asset-aware adversarial interrogation prompt.

    Pure and side-effect-free so it's unit-testable: the user's own notes are
    folded in verbatim (capped upstream) as the thesis to pressure-test.
    ``related_texts`` are the user's semantically-related notes on *other*
    tickers/themes (via the second-brain index), so the model can cross-reference
    the thesis against the user's wider recorded thinking. The output contract
    stays the shared INSIGHT_SCHEMA {summary, sections}."""
    name = _asset_name(symbol, asset_type, snap, crypto)
    facts = _asset_facts(asset_type, snap, crypto)
    news_block = "\n".join(f"- {h}" for h in headlines) or "- (no recent headlines available)"
    asset_word = {"equity": "stock", "crypto": "crypto asset", "index": "market index"}[asset_type]
    notes_block = (
        "\n".join(f"- {t}" for t in note_texts)
        or f"- (you have recorded no notes on this {asset_word} yet)"
    )
    related = related_texts or []
    related_block = "\n".join(f"- {t}" for t in related)

    context_word = {
        "equity": "fundamentals",
        "crypto": "market, tokenomics, and on-chain context",
        "index": "index-level and market-regime context",
    }[asset_type]
    risk_section = {
        "equity": "The Bear Case & Base Rates",
        "crypto": "Tokenomics, Usage & Base-Rate Risks",
        "index": "Regime, Breadth & Concentration Risks",
    }[asset_type]
    asset_guardrail = {
        "equity": "",
        "crypto": "Do not treat the token like a company or invent protocol usage. ",
        "index": "An index is not an issuer; do not discuss company fundamentals, corporate debt, or management. ",
    }[asset_type]

    system_prompt = (
        "You are a sharp, skeptical devil's-advocate analyst for a professional "
        "trader — the opposite of a cheerleader. Your job is to INTERROGATE the bull "
        f"case for a {asset_word}, not sell it. Using the {context_word}, recent headlines, and "
        f"especially the user's own notes, state the prevailing narrative plainly and "
        "then pressure-test it: surface the assumptions it rests on, the ways it could "
        "be wrong, relevant base rates, and whether the story is already reflected in "
        "the price. Where the user's notes assert a thesis, challenge it directly and "
        "on its own terms. When the user's related notes on OTHER tickers or themes "
        "reveal a recurring pattern — the same bet, bias, or blind spot they keep "
        "returning to — name it explicitly, because that is exactly what a person is "
        "least able to see in themselves. "
        f"{asset_guardrail}Be specific and grounded in the data "
        "provided; do NOT give direct buy or sell advice, and do not flatter. Provide "
        "exactly these sections: 'The Bull Narrative' (tone neutral) - the story being "
        "told, including the user's if present; 'What Would Have To Be True' (tone "
        "neutral) - the load-bearing assumptions behind it; "
        f"'{risk_section}' (tone negative) - what would break it and how often such stories "
        "disappoint; 'Already Priced In?' (tone neutral) - whether the valuation and "
        "price action already reflect the narrative."
    )
    user_content = (
        f"Asset: {name} ({symbol})\nAsset type: {asset_type}\n\n"
        f"Relevant facts:\n{facts}\n\n"
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
    refresh: bool = Query(default=False, description="Bypass a cached AI result"),
) -> dict[str, Any]:
    """Return an asset-aware AI briefing synthesizing relevant facts and news."""
    symbol = ticker.strip().upper()
    market_code = (market or "").strip().upper() or None
    asset_type = _asset_type(symbol, market_code)
    cache_key = cache_instance.build_key(
        "ai_insight", f"briefing:{symbol}", {"market": market_code or "", "asset": asset_type}
    )
    if not refresh:
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

    crypto = await _crypto_context(symbol, asset_type)
    name = _asset_name(symbol, asset_type, snap, crypto)
    system_prompt, user_content = _briefing_prompts(
        symbol, asset_type, snap, headlines, crypto
    )

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
    refresh: bool = Query(default=False, description="Bypass a cached AI result"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Adversarially interrogate an asset, grounded in the user's own notes.

    The differentiator of v1.2: instead of another bullish briefing, this turns
    the local model on the *bull case* — and specifically on the user's recorded
    thesis for the ticker — to pressure-test it rather than flatter it. The prompt
    is specialised for equities, crypto assets, or indices. Authed and per-user:
    it reads this user's `security`/symbol notes.
    """
    symbol = ticker.strip().upper()
    market_code = (market or "").strip().upper() or None
    asset_type = _asset_type(symbol, market_code)

    # Interrogation can use both same-symbol and semantically related notes. A
    # compact state fingerprint gives note CRUD — and completion of its async
    # brain reindex — a new key without wildcard deletion across cache tiers.
    note_version = _note_cache_version(db, str(current_user.id))

    # Cache per user — the interrogation folds in THIS user's private notes, so
    # two users must not share a cached result for the same symbol.
    cache_key = cache_instance.build_key(
        "ai_insight",
        f"interrogate:{symbol}:{current_user.id}",
        {"market": market_code or "", "asset": asset_type, "notes": note_version},
    )
    if not refresh:
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
    crypto = await _crypto_context(symbol, asset_type)
    name = _asset_name(symbol, asset_type, snap, crypto)
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
        symbol,
        snap,
        headlines,
        note_texts,
        related_texts,
        asset_type=asset_type,
        crypto=crypto,
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


@router.post("/ai/news-sentiment")
async def news_sentiment(payload: dict[str, Any]) -> dict[str, Any]:
    """Score a batch of news articles' sentiment with the local LLM (v1.2).

    On-demand upgrade over the always-on lexical scorer: pass a page of headlines
    (`{items: [{id, title, summary}]}`) and get a trader's-eye Bullish/Bearish/
    Neutral read per article, batched into one LLM call and cached per headline.
    Degrades per-item to the lexical engine when the model is off/unreachable —
    each item is tagged with the engine that produced it.
    """
    items = payload.get("items") if isinstance(payload, dict) else None
    return await score_articles(items if isinstance(items, list) else [])


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
    raw_facts = payload.get("facts") or []
    facts: list[dict[str, Any]] = []
    if isinstance(raw_facts, list):
        allowed_symbols = set(symbols)
        for raw in raw_facts[:10]:
            if not isinstance(raw, dict):
                continue
            symbol = str(raw.get("symbol") or "").strip().upper()
            if symbol not in allowed_symbols:
                continue
            facts.append(
                {
                    "symbol": symbol,
                    "label": str(raw.get("label") or symbol).strip()[:80],
                    "price": _finite_observation(raw.get("price")),
                    "change": _finite_observation(raw.get("change")),
                    "change_pct": _finite_observation(raw.get("change_pct")),
                }
            )

    if not symbols:
        return {
            "engine": "unavailable",
            "summary": "No symbols provided for AI analysis.",
            "sections": [],
        }

    system_prompt = (
        f"You are a skeptical market analyst. Assess this {scope} of {len(symbols)} instruments "
        "using only the observations supplied by the terminal. Do not infer current prices, "
        "performance, fundamentals, technical signals, sectors, or a market regime when those "
        "facts are absent. Explicitly identify evidence limits. Provide exactly these sections: "
        "'Observed Posture' (tone neutral), 'Relative Strength' (tone positive or neutral), and "
        "'Risks & Unknowns' (tone negative or neutral)."
    )
    facts_block = json.dumps(facts, default=str) if facts else "No current observations were supplied."
    user_content = (
        f"Symbols: {', '.join(symbols)}\n"
        f"Scope: {scope}\n"
        f"Current terminal observations (JSON):\n{facts_block}"
    )

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
        "You are a skeptical portfolio risk analyst. Interpret only the metrics and "
        "portfolio observations supplied by the terminal. Do not infer volatility, "
        "concentration, correlation clustering, factor exposure, or tail risk when the "
        "corresponding evidence is absent; name those limits explicitly. Do not give "
        "direct buy or sell advice. Provide exactly these sections: 'Risk Posture' "
        "(tone neutral), 'Observed Exposures' (tone negative or neutral), and "
        "'Risks & Unknowns' (tone neutral or negative)."
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
