"""Pure news term/classification/matching helpers, shared across the codebase.

These live in the service layer (not in the `news` route module) so both the API
routes and the background news ingestor can build the SAME search terms and apply
the SAME relevance checks — one source of truth for "what does this symbol search
for" and "does this article actually mention this symbol". No network or cache I/O
here; those stay in the callers.
"""
from __future__ import annotations

import re

# Coin symbol -> human name, for crypto news queries (BTC-USD -> "Bitcoin").
# Sourced from the shared crypto universe so there's a single source of truth;
# guarded so a heavy/unavailable import never breaks news for equities.
try:
    from backend.services.crypto_universe import FALLBACK_META as _CRYPTO_FALLBACK_META

    CRYPTO_NAME_BY_SYMBOL: dict[str, str] = {
        sym: meta.get("name", "") for sym, meta in _CRYPTO_FALLBACK_META.items() if meta.get("name")
    }
except Exception:  # pragma: no cover - defensive: name-free crypto terms still work
    CRYPTO_NAME_BY_SYMBOL = {}

# Index symbol (Yahoo caret notation) -> human name, for index news queries.
# "^GSPC stock" returns nothing; "S&P 500" does. Same bug class as crypto.
INDEX_NAME_BY_SYMBOL: dict[str, str] = {
    "^GSPC": "S&P 500",
    "^DJI": "Dow Jones Industrial Average",
    "^IXIC": "Nasdaq Composite",
    "^NDX": "Nasdaq 100",
    "^RUT": "Russell 2000",
    "^VIX": "VIX volatility index",
    "^FTSE": "FTSE 100",
    "^GDAXI": "DAX",
    "^FCHI": "CAC 40",
    "^STOXX50E": "Euro Stoxx 50",
    "^N225": "Nikkei 225",
    "^HSI": "Hang Seng Index",
    "^NSEI": "Nifty 50",
    "^BSESN": "BSE Sensex",
}

# EU-listed equities carry an exchange suffix (SAP.DE, ASML.AS, MC.PA, SHELL.L).
# "SAP.DE stock" returns almost nothing; the coverage lives under the root ticker
# plus the exchange/city name people actually write. Same bug class as crypto and
# indices — resolve the suffix to a search-friendly exchange phrase. Longest
# suffixes are matched first so ".LS" (Lisbon) never collides with ".L" (London).
EU_EXCHANGE_BY_SUFFIX: dict[str, str] = {
    ".DE": "Frankfurt Xetra",
    ".F": "Frankfurt",
    ".PA": "Euronext Paris",
    ".AS": "Euronext Amsterdam",
    ".BR": "Euronext Brussels",
    ".LS": "Euronext Lisbon",
    ".IR": "Euronext Dublin",
    ".MI": "Borsa Italiana Milan",
    ".MC": "Bolsa de Madrid",
    ".L": "London Stock Exchange",
    ".SW": "SIX Swiss Exchange",
    ".VI": "Vienna Stock Exchange",
    ".ST": "Nasdaq Stockholm",
    ".HE": "Nasdaq Helsinki",
    ".CO": "Nasdaq Copenhagen",
    ".OL": "Oslo Bors",
    ".AT": "Athens Stock Exchange",
    ".WA": "Warsaw Stock Exchange",
}


def is_crypto_symbol(symbol: str) -> bool:
    # Crypto is quoted against USD (BTC-USD, ETH-USD, RENDER-USD, ...) — the same
    # convention the frontend's isCryptoSymbol and the /v1/crypto routes use.
    return symbol.strip().upper().endswith("-USD")


def is_index_symbol(symbol: str) -> bool:
    # Indices use Yahoo caret notation (^GSPC, ^IXIC, ^NSEI, ...) — matches the
    # frontend's isIndexSymbol.
    return symbol.strip().startswith("^")


def index_news_terms(symbol: str) -> list[str]:
    """News search terms for a market index.

    "^GSPC stock" is useless; index news lives under the index's name. Resolve the
    human name when known (^GSPC -> "S&P 500"), always including a caret-free
    fallback so unmapped indices still search sensibly."""
    full = symbol.strip().upper()
    name = INDEX_NAME_BY_SYMBOL.get(full)
    bare = full.lstrip("^")
    terms: list[str] = []
    if name:
        terms += [name, f"{name} index"]
    if bare:
        terms.append(f"{bare} index")
    return list(dict.fromkeys([t for t in terms if t.strip()])) or ["stock market"]


def crypto_news_terms(symbol: str) -> list[str]:
    """News search terms for a crypto symbol.

    "BTC-USD stock" returns nothing useful; crypto news lives under the coin's
    name and the word crypto. Resolve the human name from the shared crypto
    universe when known (BTC-USD -> Bitcoin), and always include name-free
    fallbacks so coins outside the curated map still search sensibly."""
    full = symbol.strip().upper()
    base = full.split("-")[0]
    name = CRYPTO_NAME_BY_SYMBOL.get(full)
    terms: list[str] = []
    if name:
        terms += [f"{name} crypto", f"{name} cryptocurrency", name]
    terms += [f"{base} crypto", f"{base} cryptocurrency", f"{base} coin"]
    return list(dict.fromkeys([t for t in terms if t.strip()]))


def eu_exchange_suffix(symbol: str) -> tuple[str, str] | None:
    """(root, exchange_phrase) if the symbol carries a known EU exchange suffix.

    Longest suffix wins so ".LS" (Lisbon) doesn't get shadowed by ".L" (London)."""
    base = symbol.strip().upper()
    for suffix in sorted(EU_EXCHANGE_BY_SUFFIX, key=len, reverse=True):
        if base.endswith(suffix) and len(base) > len(suffix):
            return base[: -len(suffix)], EU_EXCHANGE_BY_SUFFIX[suffix]
    return None


def eu_news_terms(root: str, exchange: str) -> list[str]:
    """News search terms for an EU-listed equity.

    We don't resolve the company name (a keyless name lookup is future work), so
    lead with the exchange phrase to disambiguate the root ticker, then broaden."""
    terms = [f"{root} {exchange}", f"{root} shares", f"{root} stock", root]
    return list(dict.fromkeys([t for t in terms if t.strip()]))


def ticker_fallback_terms(symbol: str, market: str | None = None) -> list[str]:
    base = symbol.strip().upper()
    if is_crypto_symbol(base):
        return crypto_news_terms(base)
    if is_index_symbol(base):
        return index_news_terms(base)
    eu = eu_exchange_suffix(base)
    if eu is not None:
        return eu_news_terms(*eu)
    mkt = (market or "").strip().upper()
    terms = [f"{base} stock", base]
    if mkt in {"NSE", "IN"}:
        terms = [f"{base} NSE India stock", f"{base} NSE", *terms]
    elif mkt == "BSE":
        terms = [f"{base} BSE India stock", f"{base} BSE", *terms]
    return list(dict.fromkeys([t for t in terms if t.strip()]))


def crypto_match_tokens(symbol: str) -> list[str]:
    """Whole-word tokens that mean 'this coin' in a headline (name + ticker root).

    Single-letter roots are dropped — too noisy to word-match reliably."""
    full = symbol.strip().upper()
    base = full.split("-")[0]
    tokens = {base}
    name = CRYPTO_NAME_BY_SYMBOL.get(full)
    if name:
        tokens.add(name.upper())
    return [t for t in tokens if len(t) >= 2]


def _mention_pattern(tokens: list[str]) -> re.Pattern[str] | None:
    if not tokens:
        return None
    return re.compile(r"\b(?:" + "|".join(re.escape(t) for t in tokens) + r")\b", re.IGNORECASE)


def crypto_mentions(text: str, symbol: str) -> bool:
    """True if the text actually names the coin (whole-word name or ticker root).

    Used to relevance-gate a broad news search before tagging an article with a
    coin, so a nonsense query like "BTC-USD stock news" that returns an unrelated
    story doesn't get mis-tagged as Bitcoin."""
    pattern = _mention_pattern(crypto_match_tokens(symbol))
    if pattern is None:
        return False
    return bool(pattern.search(text or ""))


def index_match_tokens(symbol: str) -> list[str]:
    """Whole-word tokens meaning 'this index' in a headline (name + bare root)."""
    full = symbol.strip().upper()
    tokens: set[str] = set()
    name = INDEX_NAME_BY_SYMBOL.get(full)
    if name:
        tokens.add(name.upper())
    bare = full.lstrip("^")
    if bare:
        tokens.add(bare)
    return [t for t in tokens if len(t) >= 2]


def index_mentions(text: str, symbol: str) -> bool:
    """True if the text actually names the index (whole-word name or bare root)."""
    pattern = _mention_pattern(index_match_tokens(symbol))
    if pattern is None:
        return False
    return bool(pattern.search(text or ""))
