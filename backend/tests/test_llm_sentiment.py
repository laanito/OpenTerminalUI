"""Per-article LLM news sentiment (v1.2).

Batched into one structured call, cached per headline, and degrading per-item to
the always-on lexical scorer when the model is off — every item tagged with the
engine that produced it (never a fabricated LLM label).
"""
from __future__ import annotations

import pytest

from backend.services import llm_sentiment as ls


def test_prompt_is_trader_framed_and_numbers_each_article() -> None:
    arts = ls._normalize_articles(
        [
            {"id": "a", "title": "Acme beats but guides down", "summary": ""},
            {"title": "Regulator probes Beta", "summary": "shares fall"},
        ]
    )
    system, user = ls._sentiment_prompt(arts)
    assert "market sentiment" in system.lower()
    assert "guidance" in system.lower()  # reads like a trader, not generic tone
    assert "[0]" in user and "[1]" in user  # each article numbered for index mapping


def test_normalize_assigns_stable_ids_and_drops_empty() -> None:
    arts = ls._normalize_articles(
        [{"title": "X", "summary": "y"}, {"title": "", "summary": ""}, "junk", {"id": "keep", "title": "Z"}]
    )
    assert len(arts) == 2
    assert arts[1]["id"] == "keep"
    # same content -> same hash (per-article cache key is content-stable)
    assert ls._content_hash({"title": "X", "summary": "y"}) == arts[0]["hash"]


def test_coerce_label_falls_back_to_score_on_bad_label() -> None:
    assert ls._coerce_label("Bullish", 0.5) == "Bullish"
    assert ls._coerce_label("garbage", -0.4) == "Bearish"  # off-schema -> derive from score
    assert ls._coerce_label(None, 0.0) == "Neutral"


def test_clamp_score_bounds_and_tolerates_junk() -> None:
    assert ls._clamp_score(5) == 1.0
    assert ls._clamp_score(-9) == -1.0
    assert ls._clamp_score("nope") == 0.0


@pytest.mark.asyncio
async def test_score_articles_empty_input() -> None:
    out = await ls.score_articles([])
    assert out["engine"] == "unavailable"
    assert out["items"] == []


@pytest.mark.asyncio
async def test_score_articles_falls_back_to_lexical_when_llm_off(monkeypatch) -> None:
    # Force the batch LLM path to yield nothing (model off / unreachable).
    async def _no_llm(articles):  # noqa: ANN001, ANN202
        return {}

    async def _cache_miss(key):  # noqa: ANN001, ANN202
        return None

    async def _cache_noop(key, value, ttl):  # noqa: ANN001, ANN202
        return None

    monkeypatch.setattr(ls, "_score_batch_llm", _no_llm)
    monkeypatch.setattr(ls.cache_instance, "get", _cache_miss)
    monkeypatch.setattr(ls.cache_instance, "set", _cache_noop)

    out = await ls.score_articles(
        [{"id": "a1", "title": "Acme surges on record profit", "summary": ""}]
    )
    assert out["engine"] == "lexical"
    assert len(out["items"]) == 1
    item = out["items"][0]
    assert item["engine"] == "lexical"
    assert item["id"] == "a1"
    assert set(item) >= {"id", "label", "score", "confidence", "rationale", "engine"}


@pytest.mark.asyncio
async def test_score_articles_uses_llm_verdicts_and_caches(monkeypatch) -> None:
    cache: dict[str, dict] = {}

    async def _cache_get(key):  # noqa: ANN001, ANN202
        return cache.get(key)

    async def _cache_set(key, value, ttl):  # noqa: ANN001, ANN202
        cache[key] = value

    async def _fake_llm(articles):  # noqa: ANN001, ANN202
        # Return an LLM verdict for the first article only; the second must fall
        # back to lexical -> overall engine "mixed".
        return {
            articles[0]["id"]: {
                "label": "Bearish",
                "score": -0.6,
                "confidence": 0.9,
                "rationale": "Beat but guided down",
                "engine": "llm",
            }
        }

    monkeypatch.setattr(ls, "_score_batch_llm", _fake_llm)
    monkeypatch.setattr(ls.cache_instance, "get", _cache_get)
    monkeypatch.setattr(ls.cache_instance, "set", _cache_set)

    articles = [
        {"id": "a1", "title": "Acme beats but guides down", "summary": ""},
        {"id": "a2", "title": "Beta routine update", "summary": ""},
    ]
    out = await ls.score_articles(articles)
    assert out["engine"] == "mixed"
    by_id = {it["id"]: it for it in out["items"]}
    assert by_id["a1"]["engine"] == "llm" and by_id["a1"]["label"] == "Bearish"
    assert by_id["a1"]["rationale"] == "Beat but guided down"
    assert by_id["a2"]["engine"] == "lexical"
    # The LLM verdict was cached; a second call needs no LLM at all and stays "llm"
    # for that item.
    assert len(cache) == 1
