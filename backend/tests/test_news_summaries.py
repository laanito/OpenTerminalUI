"""Publisher-summary enrichment for headline-only feeds.

The keyless Yahoo search path returns rows with no summary. Rather than fabricate
one from the title, we lift the article's own Open Graph / meta description. These
tests pin the extraction (og preferred, meta fallback, graceful empties) and the
batch endpoint's caching / caps — all without real network I/O.
"""
from __future__ import annotations

import pytest

from backend.api.routes import news


async def _async_none(*args, **kwargs):
    return None


class _FakeResp:
    def __init__(self, text: str, content_type: str = "text/html; charset=utf-8", status: int = 200):
        self.text = text
        self.headers = {"content-type": content_type}
        self._status = status

    def raise_for_status(self) -> None:
        if self._status >= 400:
            raise RuntimeError(f"HTTP {self._status}")


class _FakeClient:
    """Minimal async context-manager stand-in for httpx.AsyncClient."""

    def __init__(self, resp: _FakeResp | Exception):
        self._resp = resp

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, **kwargs):
        if isinstance(self._resp, Exception):
            raise self._resp
        return self._resp


def _patch_http(monkeypatch, resp):
    monkeypatch.setattr(news.cache_instance, "get", _async_none)
    monkeypatch.setattr(news.cache_instance, "set", _async_none)
    monkeypatch.setattr(news.httpx, "AsyncClient", lambda *a, **k: _FakeClient(resp))


OG_HTML = '<html><head><meta property="og:description" content="Real publisher blurb about the deal &amp; its impact."></head></html>'
META_HTML = '<html><head><meta name="description" content="Fallback meta description text."></head></html>'


@pytest.mark.asyncio
async def test_og_description_preferred(monkeypatch) -> None:
    _patch_http(monkeypatch, _FakeResp(OG_HTML))
    out = await news._fetch_og_summary("https://example.com/a")
    assert out == "Real publisher blurb about the deal & its impact."


@pytest.mark.asyncio
async def test_meta_description_fallback(monkeypatch) -> None:
    _patch_http(monkeypatch, _FakeResp(META_HTML))
    out = await news._fetch_og_summary("https://example.com/b")
    assert out == "Fallback meta description text."


@pytest.mark.asyncio
async def test_non_http_url_skipped(monkeypatch) -> None:
    _patch_http(monkeypatch, _FakeResp(OG_HTML))
    assert await news._fetch_og_summary("javascript:alert(1)") == ""
    assert await news._fetch_og_summary("") == ""


@pytest.mark.asyncio
async def test_fetch_error_degrades_to_empty(monkeypatch) -> None:
    _patch_http(monkeypatch, RuntimeError("boom"))
    assert await news._fetch_og_summary("https://example.com/c") == ""


@pytest.mark.asyncio
async def test_summary_truncated(monkeypatch) -> None:
    long = "word " * 200
    html = f'<html><head><meta property="og:description" content="{long.strip()}"></head></html>'
    _patch_http(monkeypatch, _FakeResp(html))
    out = await news._fetch_og_summary("https://example.com/d")
    assert len(out) <= news._SUMMARY_MAX_CHARS + 1  # +1 for the ellipsis
    assert out.endswith("…")


@pytest.mark.asyncio
async def test_batch_endpoint_dedupes_caps_and_drops_empties(monkeypatch) -> None:
    async def fake_summary(url: str) -> str:
        return "" if url.endswith("blank") else f"summary::{url}"

    monkeypatch.setattr(news, "_fetch_og_summary", fake_summary)

    urls = ["https://x/1", "https://x/1", "https://x/blank", "https://x/2"]
    payload = await news.get_news_summaries(urls=urls)
    summaries = payload["summaries"]
    assert summaries == {"https://x/1": "summary::https://x/1", "https://x/2": "summary::https://x/2"}
    assert "https://x/blank" not in summaries  # empties dropped


@pytest.mark.asyncio
async def test_batch_endpoint_empty_input() -> None:
    assert await news.get_news_summaries(urls=[]) == {"summaries": {}}
