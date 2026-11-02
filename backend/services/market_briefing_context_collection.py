"""Bounded collection from existing context paths, without model or storage work."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from backend.api.routes import market_context as sources
from backend.services.economic_data import EconomicDataService
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
) -> ComparisonContextEvidence:
    # At most 18 jobs. Macro requests are shared only for identical region/window
    # keys within this operation, never between users or generations.
    jobs = {}
    for pair in price.comparisons:
        if pair.returns is None:
            continue
        start, end = pair.returns.start_date, pair.returns.end_date
        if options.news:
            key = ("news", start, end, pair.anchor.symbol, pair.comparison.symbol)
            jobs.setdefault(key, []).append(pair.citation_id)
        for region in options.macro_regions:
            jobs.setdefault((region, start, end), []).append(pair.citation_id)
    results = {key: ContextFetchFailure(reason="timed_out") for key in jobs}
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_SOURCES)

    async def load(key):
        kind, start, end, *_ = key
        async with semaphore:
            try:
                async with asyncio.timeout(SOURCE_TIMEOUT_SECONDS):
                    if kind == "news":
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
    news, macro = {}, {}
    for key, pairs in jobs.items():
        for pair_id in pairs:
            if key[0] == "news":
                news[pair_id] = results[key]
            else:
                macro[pair_id, key[0]] = results[key]
    return build_context_evidence(price, options, prepared_at=datetime.now(timezone.utc), news=news, macro=macro,
                                  technical_snapshot=technical_snapshot)
