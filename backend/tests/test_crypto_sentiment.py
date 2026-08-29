"""`/news/sentiment/{ticker}` for a coin must not read junk-tagged DB rows.

The ingestor's crypto DB tags were historically unreliable, so a coin's sentiment
is computed from the live blended crypto firehose instead of the DB — same
rationale as the /news/by-ticker crypto fix. Equities keep the DB-first path.
"""
from __future__ import annotations

import pytest

from backend.api.routes import news


async def _async_none(*args, **kwargs):
    return None


@pytest.mark.asyncio
async def test_crypto_sentiment_bypasses_db_and_uses_firehose(monkeypatch) -> None:
    calls = {"db": 0, "feed": 0}

    class _Boom:
        def __call__(self, *a, **k):
            calls["db"] += 1
            raise AssertionError("crypto sentiment must not open the DB")

    async def fake_feed(symbol, market, limit=50):
        calls["feed"] += 1
        return [
            {"sentiment": {"score": 0.5, "label": "Bullish", "confidence": 0.9}, "published_at": "2026-08-20T00:00:00+00:00"},
            {"sentiment": {"score": -0.3, "label": "Bearish", "confidence": 0.8}, "published_at": "2026-08-21T00:00:00+00:00"},
        ]

    monkeypatch.setattr(news, "SessionLocal", _Boom())
    monkeypatch.setattr(news, "_fetch_ticker_news", fake_feed)
    monkeypatch.setattr(news.cache_instance, "get", _async_none)
    monkeypatch.setattr(news.cache_instance, "set", _async_none)

    payload = await news.get_news_sentiment("BTC-USD", days=7, market=None)
    assert calls["db"] == 0
    assert calls["feed"] == 1
    assert payload["ticker"] == "BTC-USD"
    assert payload["total_articles"] == 2
    assert payload["bullish_pct"] == 50.0
    assert payload["bearish_pct"] == 50.0


@pytest.mark.asyncio
async def test_equity_sentiment_still_hits_db_first(monkeypatch) -> None:
    opened = {"db": 0}

    class _FakeQuery:
        def filter(self, *a, **k):
            return self

        def order_by(self, *a, **k):
            return self

        def all(self):
            return []  # empty DB → falls through to web fallback

    class _FakeSession:
        def query(self, *a, **k):
            return _FakeQuery()

        def close(self):
            pass

    def fake_session():
        opened["db"] += 1
        return _FakeSession()

    async def fake_fallback(term, limit=50):
        return []

    monkeypatch.setattr(news, "SessionLocal", fake_session)
    monkeypatch.setattr(news, "_fetch_news_fallback", fake_fallback)
    monkeypatch.setattr(news.cache_instance, "get", _async_none)
    monkeypatch.setattr(news.cache_instance, "set", _async_none)

    payload = await news.get_news_sentiment("AAPL", days=7, market=None)
    assert opened["db"] == 1  # equity opens the DB (unlike crypto)
    assert payload["ticker"] == "AAPL"
    assert payload["total_articles"] == 0
