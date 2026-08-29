"""Shared news term/classification/relevance helpers (backend/services/news_terms).

These back BOTH the API routes and the background ingestor, so pin the term
building and — critically — the whole-word relevance gates that stop a broad
name-proxy search from mis-tagging an unrelated story as a coin/index.
"""
from __future__ import annotations

from backend.services import news_terms as nt


def test_symbol_classification() -> None:
    assert nt.is_crypto_symbol("BTC-USD") is True
    assert nt.is_crypto_symbol("AAPL") is False
    assert nt.is_index_symbol("^GSPC") is True
    assert nt.is_index_symbol("BTC-USD") is False


def test_ticker_fallback_terms_by_type() -> None:
    assert nt.ticker_fallback_terms("BTC-USD")[0] == "Bitcoin crypto"
    assert nt.ticker_fallback_terms("^GSPC")[0] == "S&P 500"
    # EU suffix resolves to an exchange phrase, not "SAP.DE stock".
    assert nt.ticker_fallback_terms("SAP.DE")[0] == "SAP Frankfurt Xetra"
    # Bare US equity keeps the plain query.
    assert nt.ticker_fallback_terms("AAPL")[0] == "AAPL stock"


def test_crypto_mentions_whole_word() -> None:
    assert nt.crypto_mentions("Bitcoin surges past 70k", "BTC-USD") is True
    assert nt.crypto_mentions("BTC breaks out on ETF flows", "BTC-USD") is True
    # The classic false positive: a mining-company story that the proxy search
    # ("Bitcoin crypto") can surface must NOT be tagged as the coin.
    assert nt.crypto_mentions("Greenland Mines expands drilling program", "BTC-USD") is False
    # Substring, not whole word, must not match (BTCM ≠ BTC).
    assert nt.crypto_mentions("BTCM Corp reports earnings", "BTC-USD") is False


def test_index_mentions_whole_word() -> None:
    assert nt.index_mentions("S&P 500 closes at a record", "^GSPC") is True
    assert nt.index_mentions("GSPC futures slip", "^GSPC") is True
    assert nt.index_mentions("Apple unveils new iPhone", "^GSPC") is False


def test_unknown_coin_still_matches_on_root() -> None:
    # A coin outside the curated name map still gates on its ticker root.
    assert nt.crypto_mentions("FOO token launches staking", "FOO-USD") is True
    assert nt.crypto_mentions("Unrelated market wrap", "FOO-USD") is False
