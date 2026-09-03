import logging
import os
import time

from backend.cockpit.schemas import (
    CockpitSummary,
    EventsSummary,
    NewsSummary,
    PortfolioSnapshot,
    RiskSummary,
    SignalSummary,
)
from backend.shared.cache import cache
from backend.shared.degraded import REASON_NO_LIVE_SOURCE, degraded_marker

logger = logging.getLogger(__name__)


async def get_cockpit_summary() -> CockpitSummary:
    cache_key = "openterminalui:cockpit:summary:aggregator"
    start_time = time.perf_counter()

    cached_data = await cache.get(cache_key)
    if cached_data:
        duration_ms = (time.perf_counter() - start_time) * 1000
        logger.info("cockpit_summary_request", extra={"cache_hit": True, "latency_ms": duration_ms})
        return CockpitSummary.model_validate_json(cached_data)

    # The aggregator contract predates the owner-scoped portfolio and the real
    # dashboard queries. Keep it honest and empty until it can compose those
    # services with the authenticated user's id; never cache a sample portfolio
    # or plausible market values as if they belonged to the caller.
    portfolio_snapshot = PortfolioSnapshot(
        positions=[],
        pnl=None,
        unavailable_reason="Owner-scoped portfolio aggregation is not wired.",
    )

    # 2. Pull from signal/scanner
    signal_summary = SignalSummary(
        top_signals=[],
        unavailable_reason="Scanners not fully integrated into cockpit yet",
    )

    # 3. Pull from risk
    risk_summary = RiskSummary(
        summary={},
        unavailable_reason="Cockpit risk aggregation is not wired.",
    )

    # 4. Pull events
    events_summary = EventsSummary(
        events=[],
        unavailable_reason="Cockpit event aggregation is not wired.",
    )

    # 5. Pull news
    news_summary = NewsSummary(
        news=[],
        unavailable_reason="Cockpit news aggregation is not wired.",
    )

    summary = CockpitSummary(
        portfolio_snapshot=portfolio_snapshot,
        signal_summary=signal_summary,
        risk_summary=risk_summary,
        events=events_summary,
        news=news_summary,
        degraded=degraded_marker(
            REASON_NO_LIVE_SOURCE,
            detail="The Cockpit aggregator is retained for compatibility but is not a supported product surface.",
        ),
    )

    ttl = int(os.getenv("COCKPIT_CACHE_TTL", "60"))
    await cache.set(cache_key, summary.model_dump_json(), ttl=ttl)

    duration_ms = (time.perf_counter() - start_time) * 1000
    logger.info("cockpit_summary_request", extra={"cache_hit": False, "latency_ms": duration_ms})

    return summary
