"""Crypto `/news/by-ticker` must not be suppressed by junk DB tags.

The ingestor tags news tickers loosely, so unrelated equities get mistagged with
a coin symbol (e.g. a Ford story tagged "XRP-USD"). The DB-first path would then
return that junk row and, having found *something*, never reach the keyless
crypto firehose. For a coin we skip the DB and serve the live blended feed.
"""
from __future__ import annotations

import pytest

from backend.api.routes import news


@pytest.mark.asyncio
async def test_crypto_by_ticker_bypasses_db_and_uses_firehose(monkeypatch) -> None:
    calls = {"firehose": 0, "db": 0}

    async def fake_ticker_news(symbol, market, limit=50):
        calls["firehose"] += 1
        return [{"id": "rss1", "title": "Bitcoin rallies", "url": "u1", "source": "CoinDesk", "published_at": "2026-08-05T00:00:00+00:00"}]

    class _Boom:  # opening a DB session at all would be the bug
        def __call__(self, *a, **k):
            calls["db"] += 1
            raise AssertionError("crypto path must not touch the DB")

    monkeypatch.setattr(news, "_fetch_ticker_news", fake_ticker_news)
    monkeypatch.setattr(news, "SessionLocal", _Boom())
    monkeypatch.setattr(news.cache_instance, "get", _async_none)
    monkeypatch.setattr(news.cache_instance, "set", _async_none)

    payload = await news.get_news_by_ticker("BTC-USD", limit=10, market=None)
    assert calls["firehose"] == 1
    assert calls["db"] == 0
    assert [i["id"] for i in payload["items"]] == ["rss1"]


@pytest.mark.asyncio
async def test_equity_by_ticker_still_hits_db_first(monkeypatch) -> None:
    """Non-crypto tickers keep the DB-first behaviour (no regression)."""
    opened = {"db": 0}

    class _FakeQuery:
        def filter(self, *a, **k):
            return self

        def order_by(self, *a, **k):
            return self

        def limit(self, *a, **k):
            return self

        def all(self):
            return []  # empty DB → falls through to live fetch

    class _FakeSession:
        def query(self, *a, **k):
            return _FakeQuery()

        def close(self):
            pass

    def fake_session():
        opened["db"] += 1
        return _FakeSession()

    async def fake_ticker_news(symbol, market, limit=50):
        return [{"id": "live", "title": "Apple", "url": "u", "source": "Yahoo", "published_at": "2026-08-05T00:00:00+00:00"}]

    monkeypatch.setattr(news, "SessionLocal", fake_session)
    monkeypatch.setattr(news, "_fetch_ticker_news", fake_ticker_news)
    monkeypatch.setattr(news.cache_instance, "get", _async_none)
    monkeypatch.setattr(news.cache_instance, "set", _async_none)

    payload = await news.get_news_by_ticker("AAPL", limit=10, market=None)
    assert opened["db"] == 1  # equity path opens the DB (unlike crypto)
    assert [i["id"] for i in payload["items"]] == ["live"]


async def _async_none(*args, **kwargs):
    return None
