"""Bounded collection from existing context paths, without model or storage work."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from backend.api.routes import market_context as sources
from backend.services.economic_data import EconomicDataService
from backend.core.sec_edgar_client import SecEdgarClient, get_sec_edgar_client
from backend.services.filing_briefing_collection import fetch_filing_windows
from backend.services.market_briefing_context_evidence import (
    BriefingContextOptions, ComparisonContextEvidence, ContextFetchFailure,
    build_context_evidence,
)
from backend.services.market_briefing_evidence import ComparisonBriefingEvidence

logger = logging.getLogger(__name__)
CONTEXT_TIMEOUT_SECONDS = 40.0
SOURCE_TIMEOUT_SECONDS = 12.0
MAX_CONCURRENT_SOURCES = 3


async def collect_context_evidence(
    price: ComparisonBriefingEvidence, options: BriefingContextOptions, *, user,
    economic_service: EconomicDataService,
    technical_snapshot: sources.MarketComparisonResponse | None = None,
    sec_client: SecEdgarClient | None = None,
) -> ComparisonContextEvidence:
    # At most 25 jobs: 6 news + 12 distinct macro windows + 7 SEC symbols.
    # SEC jobs share one aggregate across windows within this operation;
    # the existing provider client's cache remains independent of this dedup.
    jobs = {}
    pairs = {pair.citation_id: pair for pair in price.comparisons}
    for pair in price.comparisons:
        if pair.returns is None:
            continue
        start, end = pair.returns.start_date, pair.returns.end_date
        if options.news:
            key = ("news", start, end, pair.anchor.symbol, pair.comparison.symbol)
            jobs.setdefault(key, []).append(pair.citation_id)
        for region in options.macro_regions:
            jobs.setdefault((region, start, end), []).append(pair.citation_id)
        if options.fundamentals:
            for symbol in (pair.anchor.symbol, pair.comparison.symbol):
                jobs.setdefault(("fundamentals", None, None, symbol), []).append(pair.citation_id)
    if options.fundamentals and any(key[0] == "fundamentals" for key in jobs) and sec_client is None:
        sec_client = get_sec_edgar_client()
    results = {key: ContextFetchFailure(reason="timed_out") for key in jobs}
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_SOURCES)

    async def load(key):
        kind, start, end, *_ = key
        async with semaphore:
            try:
                async with asyncio.timeout(SOURCE_TIMEOUT_SECONDS):
                    if kind == "fundamentals":
                        windows = {(pairs[pair_id].returns.start_date, pairs[pair_id].returns.end_date)
                                   for pair_id in jobs[key]}
                        response = await fetch_filing_windows(sec_client, key[3], windows)
                    elif kind == "news":
                        raw = await sources.get_market_context_headlines(sources.MarketHeadlinesRequest(
                            anchor=key[3], comparison=key[4], start_date=start, end_date=end,
                        ), user)
                        response = sources.MarketHeadlinesResponse.model_validate(raw)
                    elif kind == "us":
                        raw = await sources.get_market_context_macro_observations(
                            sources.MarketMacroObservationsRequest(start_date=start, end_date=end),
                            user, economic_service,
                        )
                        response = sources.MarketMacroObservationsResponse.model_validate(raw)
                    else:
                        raw = await sources.get_market_context_euro_area_macro_observations(
                            sources.MarketMacroEventsRequest(start_date=start, end_date=end), user,
                        )
                        response = sources.EuroAreaMacroResponse.model_validate(raw)
                    # Validate semantic identity/window/counts as well as shape.
                    # A malformed source cannot discard valid price/other sources.
                    for pair_id in jobs[key]:
                        if kind == "fundamentals":
                            window = (pairs[pair_id].returns.start_date, pairs[pair_id].returns.end_date)
                            build_context_evidence(
                                price, BriefingContextOptions(fundamentals=True),
                                prepared_at=datetime.now(timezone.utc),
                                filings={(pair_id, key[3]): response[window]},
                            )
                            continue
                        build_context_evidence(
                            price, BriefingContextOptions(news=kind == "news", macro_regions=[] if kind == "news" else [kind]),
                            prepared_at=datetime.now(timezone.utc),
                            news={pair_id: response} if kind == "news" else None,
                            macro={(pair_id, kind): response} if kind != "news" else None,
                        )
                    results[key] = response
            except TimeoutError:
                pass  # Pre-initialized typed timeout, not a successful empty feed.
            except (ValueError, TypeError, AttributeError):
                results[key] = ContextFetchFailure(reason="invalid_response")
                logger.warning("Comparison context source returned invalid evidence (%s)", kind)
            except Exception as exc:
                results[key] = ContextFetchFailure(reason="provider_error")
                logger.warning("Comparison context source failed (%s, %s)", kind, type(exc).__name__)

    # gather cancels and joins its children on timeout or caller cancellation.
    # Completed sections survive the total deadline; no fetch outlives the caller.
    try:
        async with asyncio.timeout(CONTEXT_TIMEOUT_SECONDS):
            await asyncio.gather(*(load(key) for key in jobs))
    except TimeoutError:
        logger.warning("Comparison context collection reached its deadline")
    news, macro, filings = {}, {}, {}
    for key, pair_ids in jobs.items():
        for pair_id in pair_ids:
            if key[0] == "news":
                news[pair_id] = results[key]
            elif key[0] == "fundamentals":
                window = (pairs[pair_id].returns.start_date, pairs[pair_id].returns.end_date)
                response = results[key]
                filings[pair_id, key[3]] = response if isinstance(response, ContextFetchFailure) else response[window]
            else:
                macro[pair_id, key[0]] = results[key]
    return build_context_evidence(price, options, prepared_at=datetime.now(timezone.utc), news=news, macro=macro,
                                  technical_snapshot=technical_snapshot, filings=filings)
