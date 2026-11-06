"""One current SEC fetch per symbol, projected onto explicitly requested windows.

The owning context collector supplies concurrency, deadlines and cancellation.
No filing downloads, model calls, capture writes or private-source reads occur.
"""
from datetime import date, datetime, timezone

from backend.core.sec_edgar_client import SecEdgarClient
from backend.services.filing_briefing_evidence import build_filing_evidence, unavailable_filing_evidence


async def fetch_filing_windows(client: SecEdgarClient, symbol: str, windows: set[tuple[date, date]]):
    reason, cik, payload = None, None, None
    if not client.configured:
        reason = "configuration_required"
    else:
        ciks = await client.ticker_ciks(symbol)
        if not ciks:
            reason = "not_covered"
        elif len(ciks) > 1:
            reason = "ambiguous_ticker"
        else:
            cik = ciks[0]
            payload = await client.company_facts(cik)
    retrieved_at = datetime.now(timezone.utc)
    return {
        (start, end): (
            unavailable_filing_evidence(symbol=symbol, cik=cik, start=start, end=end,
                                        retrieved_at=retrieved_at, reason=reason)
            if reason else build_filing_evidence(payload, symbol=symbol, cik=cik, start=start,
                                                 end=end, retrieved_at=retrieved_at)
        ) for start, end in sorted(windows)
    }
