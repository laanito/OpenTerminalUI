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
    for symbol in ("BTC-USD", "AAPL", "FOO-USD", "^GSPC", "^ABCXYZ"):
        terms = news._ticker_fallback_terms(symbol)
        assert terms == list(dict.fromkeys(terms))  # no duplicates
        assert all(t.strip() for t in terms)  # no blanks


# ---- indices: same bug class as crypto ("^GSPC stock" is useless) -----------

def test_is_index_symbol() -> None:
    assert news._is_index_symbol("^GSPC")
    assert news._is_index_symbol("^NSEI")
    assert not news._is_index_symbol("AAPL")
    assert not news._is_index_symbol("BTC-USD")


def test_known_index_resolves_to_name() -> None:
    terms = news._ticker_fallback_terms("^GSPC")
    assert "S&P 500" in terms
    assert all("stock" not in t.lower() for t in terms)


def test_unknown_index_still_searches_sensibly() -> None:
    terms = news._ticker_fallback_terms("^ABCXYZ")
    assert terms == ["ABCXYZ index"]


# ---- de-biased DB aliasing (no-market must not assume India) -----------------

def test_aliases_do_not_india_bias_eu_crypto_or_index() -> None:
    # EU-suffixed, crypto and index symbols must NOT get .NS/.BO appended.
    assert news._ticker_aliases("JEIP.DE") == ["JEIP.DE"]
    assert news._ticker_aliases("BTC-USD") == ["BTC-USD"]
    assert news._ticker_aliases("^GSPC") == ["^GSPC"]


def test_aliases_still_guess_india_for_bare_ticker() -> None:
    # A bare equity ticker with no market hint keeps the India guess (unchanged).
    assert news._ticker_aliases("AAPL") == ["AAPL", "AAPL.BO", "AAPL.NS"]
    # An explicit market is honored regardless.
    assert news._ticker_aliases("RELIANCE", "NSE") == ["RELIANCE", "RELIANCE.NS"]
