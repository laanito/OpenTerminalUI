"""Keyless crypto-native RSS firehose blending.

Web search (Yahoo/Google) under-covers crypto beyond the largest coins, so for a
crypto symbol `_fetch_ticker_news` blends web results with the CoinDesk/
Cointelegraph/Decrypt firehose, filtered to the coin. Equities/indices are
untouched. These tests stub the network so they're deterministic and offline.
"""
from __future__ import annotations

import pytest

from backend.api.routes import news


@pytest.mark.asyncio
async def test_crypto_ticker_blends_web_and_firehose(monkeypatch) -> None:
    async def fake_fallback(query: str, limit: int = 50):
        return [{"url": "web1", "title": "Bitcoin ETF flows", "summary": "", "published_at": "2026-01-02T00:00:00+00:00"}]

    async def fake_firehose(limit: int = 80):
        return [
            {"url": "rss1", "title": "Bitcoin network upgrade", "summary": "", "published_at": "2026-01-03T00:00:00+00:00"},
            {"url": "rss2", "title": "Solana outage", "summary": "unrelated coin", "published_at": "2026-01-01T00:00:00+00:00"},
        ]

    monkeypatch.setattr(news, "_fetch_news_fallback", fake_fallback)
    monkeypatch.setattr(news, "_fetch_crypto_rss", fake_firehose)

    items = await news._fetch_ticker_news("BTC-USD", None, limit=10)
    urls = [i["url"] for i in items]
    # Web result AND the matching firehose row are present; the Solana row is filtered out.
    assert "web1" in urls
    assert "rss1" in urls
    assert "rss2" not in urls
    # Newest-first ordering across the blended sources.
    assert urls[0] == "rss1"


@pytest.mark.asyncio
async def test_equity_ticker_does_not_touch_firehose(monkeypatch) -> None:
    calls = {"firehose": 0}

    async def fake_fallback(query: str, limit: int = 50):
        return [{"url": "web1", "title": "Apple earnings", "summary": "", "published_at": "2026-01-02T00:00:00+00:00"}]

    async def fake_firehose(limit: int = 80):
        calls["firehose"] += 1
        return []

    monkeypatch.setattr(news, "_fetch_news_fallback", fake_fallback)
    monkeypatch.setattr(news, "_fetch_crypto_rss", fake_firehose)

    items = await news._fetch_ticker_news("AAPL", None, limit=10)
    assert [i["url"] for i in items] == ["web1"]
    assert calls["firehose"] == 0  # crypto firehose never consulted for equities


@pytest.mark.asyncio
async def test_crypto_rss_firehose_merges_and_caches_feeds(monkeypatch) -> None:
    captured: list[str] = []

    async def fake_feed(url: str, default_source: str, limit: int = 50):
        captured.append(default_source)
        return [{
            "url": f"{default_source}-1",
            "title": f"{default_source} headline",
            "summary": "",
            "published_at": "2026-01-01T00:00:00+00:00",
        }]

    monkeypatch.setattr(news, "_fetch_rss_feed", fake_feed)
    # Bypass the shared cache so the merge logic is what's under test.
    monkeypatch.setattr(news.cache_instance, "get", lambda *a, **k: _none())
    monkeypatch.setattr(news.cache_instance, "set", lambda *a, **k: _none())

    items = await news._fetch_crypto_rss(limit=50)
    sources = {i["url"] for i in items}
    # All three keyless feeds were consulted and merged.
    assert {"CoinDesk", "Cointelegraph", "Decrypt"} <= set(captured)
    assert len(sources) == 3


async def _none():
    return None
