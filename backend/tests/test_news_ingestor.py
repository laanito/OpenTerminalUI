from __future__ import annotations

import asyncio
import importlib.util
import json
from pathlib import Path
import sys

from backend.models import NewsArticle

_MODULE_PATH = Path(__file__).resolve().parents[1] / "bg_services" / "news_ingestor.py"
_SPEC = importlib.util.spec_from_file_location("test_news_ingestor_module", _MODULE_PATH)
assert _SPEC and _SPEC.loader
_NEWS_INGESTOR_MODULE = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = _NEWS_INGESTOR_MODULE
_SPEC.loader.exec_module(_NEWS_INGESTOR_MODULE)

NewsIngestor = _NEWS_INGESTOR_MODULE.NewsIngestor
NormalizedNews = _NEWS_INGESTOR_MODULE.NormalizedNews
normalize_news_record = _NEWS_INGESTOR_MODULE.normalize_news_record


def test_db_tickers_combines_held_and_watchlist_symbol_unions(monkeypatch) -> None:
    class _TickerSession:
        def close(self) -> None:
            return None

    session = _TickerSession()
    monkeypatch.setattr(_NEWS_INGESTOR_MODULE, "SessionLocal", lambda: session)
    monkeypatch.setattr(_NEWS_INGESTOR_MODULE, "all_held_symbols", lambda db, limit: ["MSFT", "AAPL"])
    monkeypatch.setattr(
        _NEWS_INGESTOR_MODULE,
        "all_watchlist_symbols",
        lambda db, limit: ["AAPL", "TSLA"],
    )

    assert _NEWS_INGESTOR_MODULE._db_tickers(limit=3) == ["MSFT", "AAPL", "TSLA"]


class _FakeExistingQuery:
    def filter(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return self

    def all(self):
        return []


class _FakeSession:
    def __init__(self) -> None:
        self.added: list[NewsArticle] = []
        self.committed = False
        self.closed = False

    def query(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return _FakeExistingQuery()

    def add(self, row: NewsArticle) -> None:
        self.added.append(row)

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        return None

    def close(self) -> None:
        self.closed = True


def test_normalize_news_record_finnhub() -> None:
    row = {
        "source": "Reuters",
        "headline": "Markets rally",
        "url": "https://example.com/a",
        "summary": "Stocks moved higher",
        "image": "https://img.example.com/a.jpg",
        "datetime": 1735603200,
        "related": "RELIANCE, INFY",
    }
    item = normalize_news_record(row, provider="finnhub")
    assert item is not None
    assert item.source == "Reuters"
    assert item.title == "Markets rally"
    assert item.url == "https://example.com/a"
    assert item.tickers == ["RELIANCE", "INFY"]
    assert item.published_at.endswith("+00:00")


def test_normalize_news_record_fmp() -> None:
    row = {
        "site": "Bloomberg",
        "title": "Oil edges lower",
        "url": "https://example.com/b",
        "text": "Crude declined after data release",
        "image": "https://img.example.com/b.jpg",
        "publishedDate": "2025-01-15 10:00:00",
        "symbol": "ONGC",
    }
    item = normalize_news_record(row, provider="fmp")
    assert item is not None
    assert item.source == "Bloomberg"
    assert item.title == "Oil edges lower"
    assert item.url == "https://example.com/b"
    assert item.tickers == ["ONGC"]


def test_news_dedupe_by_url_keeps_latest_seen() -> None:
    ingestor = NewsIngestor()
    one = NormalizedNews(
        source="SrcA",
        title="T1",
        url="https://example.com/same",
        summary="S1",
        image_url="",
        published_at="2025-01-01T00:00:00+00:00",
        tickers=["AAA"],
    )
    two = NormalizedNews(
        source="SrcB",
        title="T2",
        url="https://example.com/same",
        summary="S2",
        image_url="",
        published_at="2025-01-01T01:00:00+00:00",
        tickers=["BBB"],
    )
    out = ingestor._dedupe([one, two])  # noqa: SLF001
    assert len(out) == 1
    assert out[0].source == "SrcB"
    assert out[0].title == "T2"


class _FakeYahoo:
    def __init__(self, rows_by_query: dict[str, list[dict]]) -> None:
        self.rows_by_query = rows_by_query
        self.queries: list[str] = []

    async def search_news(self, query: str, limit: int = 10):  # noqa: ARG002
        self.queries.append(query)
        return self.rows_by_query.get(query, [])


class _FakeFetcher:
    def __init__(self, yahoo: _FakeYahoo) -> None:
        self.yahoo = yahoo


def test_fetch_yahoo_gates_crypto_junk(monkeypatch) -> None:
    """A coin's name-proxy search can surface off-topic stories — only the ones
    that actually name the coin get tagged, so no more BTC-USD on a mining story."""
    mod = _NEWS_INGESTOR_MODULE
    monkeypatch.setattr(mod, "_db_tickers", lambda limit=40: ["BTC-USD"])
    yahoo = _FakeYahoo(
        {
            "Bitcoin crypto": [
                {"title": "Bitcoin surges past $70k", "link": "https://x/btc", "publisher": "CoinDesk"},
                {"title": "Greenland Mines expands drilling", "link": "https://x/mine", "publisher": "Mining Weekly"},
            ]
        }
    )
    items = asyncio.run(mod.NewsIngestor()._fetch_yahoo(_FakeFetcher(yahoo)))  # noqa: SLF001
    titles = [i.title for i in items]
    assert "Bitcoin surges past $70k" in titles
    assert "Greenland Mines expands drilling" not in titles  # gated out
    assert all(i.tickers == ["BTC-USD"] for i in items)
    assert yahoo.queries[0] == "Bitcoin crypto"  # searched by name, not "BTC-USD stock news"


def test_fetch_yahoo_equity_trusts_query(monkeypatch) -> None:
    """Bare equities keep the reliable "{ticker} stock news" query + attribution."""
    mod = _NEWS_INGESTOR_MODULE
    monkeypatch.setattr(mod, "_db_tickers", lambda limit=40: ["AAPL"])
    yahoo = _FakeYahoo(
        {"AAPL stock news": [{"title": "Apple supplier update", "link": "https://x/aapl", "publisher": "Reuters"}]}
    )
    items = asyncio.run(mod.NewsIngestor()._fetch_yahoo(_FakeFetcher(yahoo)))  # noqa: SLF001
    assert [i.title for i in items] == ["Apple supplier update"]
    assert items[0].tickers == ["AAPL"]
    assert yahoo.queries == ["AAPL stock news"]


def test_store_news_persists_sentiment_fields(monkeypatch) -> None:
    ingestor = NewsIngestor()
    fake_db = _FakeSession()
    monkeypatch.setattr(_NEWS_INGESTOR_MODULE, "SessionLocal", lambda: fake_db)

    items = [
        NormalizedNews(
            source="Reuters",
            title="Strong demand ahead",
            url="https://example.com/c",
            summary="Order wins continue.",
            image_url="",
            published_at="2026-02-10T09:00:00+00:00",
            tickers=["RELIANCE", "INFY"],
            sentiment_score=0.72,
            sentiment_label="Bullish",
            sentiment_confidence=0.88,
        )
    ]

    inserted = ingestor._store_news(items)  # noqa: SLF001
    assert inserted == 1
    assert fake_db.committed is True
    assert fake_db.closed is True
    assert len(fake_db.added) == 1
    row = fake_db.added[0]
    assert row.sentiment_score == 0.72
    assert row.sentiment_label == "Bullish"
    assert row.sentiment_confidence == 0.88
    assert json.loads(row.tickers) == ["RELIANCE", "INFY"]
