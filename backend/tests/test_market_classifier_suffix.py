from __future__ import annotations

import asyncio

from backend.shared.market_classifier import MarketClassifier


def test_foreign_suffix_classified_without_network():
    # Known foreign Yahoo suffixes resolve to their real country deterministically
    # (no FMP/NSE lookup), so a non-IN symbol never falls through to the India
    # default and never triggers a spurious NSE quote call.
    mc = MarketClassifier()

    async def run():
        cases = [
            ("III.L", "LSE", "GB"),
            ("ADS.DE", "XETRA", "DE"),
            ("NESN.SW", "SIX", "CH"),
            ("AC.PA", "EURONEXT", "FR"),
            ("ENI.MI", "BIT", "IT"),
            ("EQNR.OL", "OSE", "NO"),
        ]
        for sym, exch, cc in cases:
            c = await mc.classify(sym)
            assert c.country_code == cc, (sym, c.country_code)
            assert c.exchange == exch
            # base symbol keeps the full Yahoo ticker so quotes/charts route right
            assert c.symbol == sym
            # and yfinance_symbol echoes it verbatim (non-IN path)
            assert await mc.yfinance_symbol(sym) == sym

    asyncio.run(run())


def test_indian_suffix_still_classified_in():
    mc = MarketClassifier()

    async def run():
        c = await mc.classify("RELIANCE.NS")
        assert c.country_code == "IN" and c.exchange == "NSE"

    asyncio.run(run())
