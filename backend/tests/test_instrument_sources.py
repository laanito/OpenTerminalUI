from __future__ import annotations

import asyncio

from backend.instruments import sources


NASDAQ_LISTED = """Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
QQQ|Invesco QQQ Trust|Q|N|N|100|Y|N
TSTI|Test Issue Co|Q|Y|N|100|N|N
File Creation Time: 0101202512:00|||||||
"""

OTHER_LISTED = """ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
BRK.A|Berkshire Hathaway Inc.|N|BRK.A|N|1|N|
SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY
File Creation Time: 0101202512:00|||||||
"""


def test_parse_nasdaq_listed_skips_test_and_tags_etf():
    rows = sources.parse_nasdaq_listed(NASDAQ_LISTED)
    by_symbol = {r["display_symbol"]: r for r in rows}
    assert set(by_symbol) == {"AAPL", "QQQ"}  # test issue dropped
    assert by_symbol["AAPL"]["type"] == "equity"
    assert by_symbol["AAPL"]["name"] == "Apple Inc. - Common Stock"
    assert by_symbol["AAPL"]["exchange"] == "NASDAQ"
    assert by_symbol["AAPL"]["currency"] == "USD"
    assert by_symbol["AAPL"]["canonical_id"] == "NASDAQ:AAPL"
    assert by_symbol["AAPL"]["vendor_mappings_json"]["yahoo"] == "AAPL"
    assert by_symbol["QQQ"]["type"] == "etf"


def test_parse_other_listed_maps_exchange_codes():
    rows = sources.parse_other_listed(OTHER_LISTED)
    by_symbol = {r["display_symbol"]: r for r in rows}
    assert by_symbol["BRK.A"]["exchange"] == "NYSE"
    assert by_symbol["BRK.A"]["type"] == "equity"
    assert by_symbol["SPY"]["exchange"] == "NYSE ARCA"
    assert by_symbol["SPY"]["type"] == "etf"
    assert by_symbol["SPY"]["canonical_id"] == "NYSE ARCA:SPY"


def test_crypto_row_maps_fields():
    # load_universe yields BTC-USD-style symbols (kept consistent with the rest
    # of the app: isCryptoSymbol / fetchCryptoCandles depend on the -USD form).
    row = sources.crypto_row(
        {"symbol": "BTC-USD", "name": "Bitcoin", "coin_id": "bitcoin"}
    )
    assert row["canonical_id"] == "CRYPTO:BTC-USD"
    assert row["display_symbol"] == "BTC-USD"
    assert row["type"] == "crypto"
    assert row["exchange"] == "CRYPTO"
    assert row["vendor_mappings_json"] == {"coingecko": "bitcoin", "yahoo": "BTC-USD"}
    assert sources.crypto_row({"symbol": ""}) is None


def test_eu_row_maps_suffix_to_exchange_and_currency():
    ads = sources.eu_row(
        {"name": "Adidas", "symbol": "ADS.DE", "country": "Germany", "isins": ["DE000A1EWWW0"]}
    )
    assert ads["canonical_id"] == "XETRA:ADS.DE"
    assert ads["display_symbol"] == "ADS.DE"
    assert ads["exchange"] == "XETRA"
    assert ads["currency"] == "EUR"
    assert ads["type"] == "equity"
    assert ads["vendor_mappings_json"] == {"yahoo": "ADS.DE", "isin": "DE000A1EWWW0"}

    uk = sources.eu_row({"name": "3i", "symbol": "III.L", "country": "United Kingdom", "isins": []})
    assert uk["exchange"] == "LSE" and uk["currency"] == "GBP"
    assert uk["vendor_mappings_json"] == {"yahoo": "III.L"}  # no isin -> omitted

    swiss = sources.eu_row({"name": "Nestle", "symbol": "NESN.SW"})
    assert swiss["exchange"] == "SIX Swiss" and swiss["currency"] == "CHF"


def test_eu_row_skips_non_eu_symbols():
    assert sources.eu_row({"symbol": "AAPL"}) is None          # bare US ticker
    assert sources.eu_row({"symbol": "7203.T"}) is None         # Tokyo suffix
    assert sources.eu_row({"symbol": "AIR.PA.DE"}) is None       # malformed double suffix
    assert sources.eu_row({"symbol": ""}) is None


def test_eu_rows_from_stocks_dedupes_across_indices():
    stocks = [
        {"name": "Adidas", "symbol": "ADS.DE", "isins": ["DE000A1EWWW0"]},
        {"name": "Adidas", "symbol": "ADS.DE", "isins": ["DE000A1EWWW0"]},  # dup (other index)
        {"name": "Accor", "symbol": "AC.PA"},
        {"name": "Apple", "symbol": "AAPL"},  # filtered out
    ]
    rows = sources.eu_rows_from_stocks(stocks)
    assert sorted(r["display_symbol"] for r in rows) == ["AC.PA", "ADS.DE"]


def test_fetch_crypto_uses_universe(monkeypatch):
    async def _fake_universe(limit: int = 300):  # noqa: ARG001
        return [
            {"symbol": "BTC", "name": "Bitcoin", "coin_id": "bitcoin"},
            {"symbol": "ETH", "name": "Ethereum", "coin_id": "ethereum"},
        ]

    monkeypatch.setattr(sources, "load_universe", _fake_universe)
    rows = asyncio.run(sources.fetch_crypto(10))
    assert [r["display_symbol"] for r in rows] == ["BTC", "ETH"]
    assert all(r["type"] == "crypto" for r in rows)
