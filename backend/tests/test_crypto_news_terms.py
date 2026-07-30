"""Crypto-aware news search terms.

`/news/by-ticker`, the AI briefing, the interrogation, and per-ticker sentiment
all gather headlines via `_ticker_fallback_terms`. For a coin, "BTC-USD stock"
returns nothing useful — so crypto symbols must resolve to the coin name + the
word crypto instead. Equity/India term generation must be unchanged.
"""
from __future__ import annotations

from backend.api.routes import news


def test_is_crypto_symbol() -> None:
    assert news._is_crypto_symbol("BTC-USD")
    assert news._is_crypto_symbol("eth-usd")
    assert not news._is_crypto_symbol("AAPL")
    assert not news._is_crypto_symbol("RELIANCE.NS")
    assert not news._is_crypto_symbol("^GSPC")


def test_known_coin_resolves_to_name() -> None:
    terms = news._ticker_fallback_terms("BTC-USD")
    # The human coin name drives the search, not the ticker or "stock".
    assert "Bitcoin crypto" in terms
    assert "Bitcoin" in terms
    assert all("stock" not in t for t in terms)
    # Name-free fallbacks are always present for robustness.
    assert "BTC crypto" in terms


def test_unknown_coin_still_searches_sensibly() -> None:
    terms = news._ticker_fallback_terms("FOO-USD")
    assert "FOO crypto" in terms
    assert "FOO cryptocurrency" in terms
    assert all("stock" not in t for t in terms)


def test_equity_terms_unchanged() -> None:
    assert news._ticker_fallback_terms("AAPL") == ["AAPL stock", "AAPL"]


def test_india_terms_unchanged() -> None:
    terms = news._ticker_fallback_terms("RELIANCE", "NSE")
    assert terms[0] == "RELIANCE NSE India stock"
    assert "RELIANCE" in terms


def test_terms_are_deduped_and_nonempty() -> None:
    for symbol in ("BTC-USD", "AAPL", "FOO-USD"):
        terms = news._ticker_fallback_terms(symbol)
        assert terms == list(dict.fromkeys(terms))  # no duplicates
        assert all(t.strip() for t in terms)  # no blanks
