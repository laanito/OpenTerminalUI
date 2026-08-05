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


# ---- EU-listed equities: exchange suffix -> search-friendly terms -------------

def test_eu_suffix_resolves_to_root_and_exchange() -> None:
    assert news._eu_exchange_suffix("SAP.DE") == ("SAP", "Frankfurt Xetra")
    assert news._eu_exchange_suffix("ASML.AS") == ("ASML", "Euronext Amsterdam")
    assert news._eu_exchange_suffix("SHELL.L") == ("SHELL", "London Stock Exchange")


def test_eu_longest_suffix_wins() -> None:
    # ".LS" (Lisbon) must beat ".L" (London) — longest match, not first.
    assert news._eu_exchange_suffix("ABC.LS") == ("ABC", "Euronext Lisbon")


def test_eu_suffix_ignores_non_eu_and_bare() -> None:
    assert news._eu_exchange_suffix("AAPL") is None
    assert news._eu_exchange_suffix("BTC-USD") is None
    assert news._eu_exchange_suffix("^GSPC") is None
    # A suffix with no root before it is not a real ticker.
    assert news._eu_exchange_suffix(".DE") is None


def test_eu_terms_lead_with_exchange_context() -> None:
    terms = news._ticker_fallback_terms("SAP.DE")
    # Exchange phrase leads so the ambiguous root ("SAP") is disambiguated.
    assert terms[0] == "SAP Frankfurt Xetra"
    assert "SAP" in terms
    # No India bias for EU tickers.
    assert all("NSE" not in t and "BSE" not in t for t in terms)


def test_us_equity_terms_still_unchanged_by_eu_path() -> None:
    # The EU path must not touch plain US tickers.
    assert news._ticker_fallback_terms("MSFT") == ["MSFT stock", "MSFT"]


# ---- crypto-native RSS firehose: matching / merge -----------------------------

def test_crypto_match_tokens_include_name_and_root() -> None:
    tokens = news._crypto_match_tokens("BTC-USD")
    assert "BTC" in tokens
    assert "BITCOIN" in tokens


def test_crypto_match_tokens_drop_single_letter_roots() -> None:
    # A 1-char root is too noisy to word-match; only keep >=2-char tokens.
    assert all(len(t) >= 2 for t in news._crypto_match_tokens("X-USD"))


def test_filter_crypto_rss_matches_whole_words_only() -> None:
    rows = [
        {"url": "u1", "title": "Bitcoin hits new high", "summary": ""},
        {"url": "u2", "title": "Ethereum upgrade ships", "summary": "no coin here"},
        {"url": "u3", "title": "arbitrary text", "summary": "mentions BTC futures"},
        {"url": "u4", "title": "orbiting satellites", "summary": "nothing relevant"},
    ]
    matched = news._filter_crypto_rss(rows, "BTC-USD")
    urls = {r["url"] for r in matched}
    assert urls == {"u1", "u3"}  # Bitcoin (name) + BTC (root); no false positives


def test_merge_news_dedupes_by_url_and_sorts_newest_first() -> None:
    a = [{"url": "u1", "published_at": "2026-01-01T00:00:00+00:00"}]
    b = [
        {"url": "u1", "published_at": "2026-01-01T00:00:00+00:00"},  # dup, earlier group wins
        {"url": "u2", "published_at": "2026-02-01T00:00:00+00:00"},
    ]
    merged = news._merge_news(a, b, limit=10)
    assert [r["url"] for r in merged] == ["u2", "u1"]  # newest first
    assert len(merged) == 2  # deduped
