"""Deterministic optional context projection, not provider fetching or synthesis.

The nested price packet keeps its v2.2 scope. This separate fingerprint covers
explicit context selections and every returned value, omission and failure.
Provider text is untrusted source data, never a model instruction.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timezone
from typing import Literal
from urllib.parse import urlencode, urlsplit

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictBool, field_validator

from backend.api.routes.market_context import (
    EuroAreaMacroResponse, MarketHeadlinesResponse, MarketMacroObservationsResponse, MarketComparisonResponse,
)
from backend.services.euro_area_macro import ECB_URL, EUROSTAT_URL, SERIES
from backend.services.market_briefing_evidence import ComparisonBriefingEvidence, build_comparison_evidence
from backend.services.technical_indicators import TechnicalAssetIndicators, TechnicalMetric, calculate_technical_indicators

NEWS_LIMIT = 5
MACRO_LIMIT = 24
Region = Literal["us", "euro_area"]


class BriefingContextOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    news: StrictBool = False
    macro_regions: list[Region] = Field(default_factory=list, max_length=2)
    technical: StrictBool = False

    @field_validator("macro_regions")
    @classmethod
    def canonical_regions(cls, value: list[Region]) -> list[Region]:
        if len(set(value)) != len(value):
            raise ValueError("Duplicate macro region")
        return [region for region in ("us", "euro_area") if region in value]


class ContextFetchFailure(BaseModel):
    # Do not accept arbitrary provider exception strings/URLs with credentials.
    reason: Literal["provider_error", "timed_out", "missing_api_key", "invalid_response", "not_prepared"]


class NewsContextItem(BaseModel):
    citation_id: str
    title: str = Field(min_length=1, max_length=600)
    title_truncated: bool
    url: str = Field(max_length=2048)
    source: str = Field(min_length=1, max_length=200)
    published_at: AwareDatetime


class NewsContextGroup(BaseModel):
    citation_id: str
    symbol: str
    status: Literal["available", "no_matches", "feed_error"]
    examined_count: int = Field(ge=0)
    matched_count: int = Field(ge=0)
    upstream_display_limit: int = Field(ge=1)
    returned_headline_count: int = Field(ge=0)
    withheld_invalid_count: int = Field(ge=0)
    withheld_duplicate_count: int = Field(ge=0)
    headlines: list[NewsContextItem] = Field(max_length=NEWS_LIMIT)


class ContextObservation(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    reference_date: date
    value: float
    flag: str | None = None


class MacroContextSeries(BaseModel):
    citation_id: str
    series_id: str
    label: str = Field(min_length=1, max_length=200)
    source: Literal["fred", "eurostat", "ecb"]
    source_url: str
    title: str | None = Field(max_length=600)
    units: str | None = Field(max_length=200)
    frequency: str | None = Field(max_length=100)
    status: Literal["available", "no_observations", "feed_error"]
    returned_observation_count: int = Field(ge=0)
    upstream_matched_count: int | None = Field(default=None, ge=0)
    withheld_conflict_count: int | None = Field(default=None, ge=0)
    observations: list[ContextObservation] = Field(max_length=MACRO_LIMIT)


class ContextSection(BaseModel):
    citation_id: str
    pair_citation_id: str
    start_date: date | None
    end_date: date | None
    retrieved_at: AwareDatetime | None = None
    status: Literal["available", "partial", "empty", "unavailable", "no_price_window"]
    reason: str | None = None


class NewsContextSection(ContextSection):
    kind: Literal["headlines"] = "headlines"
    source: Literal["current_keyless_feeds"] = "current_keyless_feeds"
    fetch_limit_per_symbol: int | None = None
    groups: list[NewsContextGroup] = Field(default_factory=list, max_length=2)


class MacroContextSection(ContextSection):
    kind: Literal["macro"] = "macro"
    region: Region
    # Current-vintage values are never evidence of historical availability.
    vintage_basis: Literal["current_at_retrieval"] = "current_at_retrieval"
    realtime_date: date | None = None  # FRED's requested daily view, not release time.
    series: list[MacroContextSeries] = Field(default_factory=list, max_length=3)


class TechnicalContextMetric(TechnicalMetric):
    citation_id: str


class TechnicalSupportingPoint(BaseModel):
    date: date
    adjusted_close: float = Field(gt=0, allow_inf_nan=False)


class TechnicalContextAsset(TechnicalAssetIndicators):
    citation_id: str
    instrument_type: str | None
    exchange_timezone: str | None
    shifted_local_dates: int = Field(ge=0)
    metrics: list[TechnicalContextMetric] = Field(min_length=3, max_length=3)
    supporting_points: list[TechnicalSupportingPoint] = Field(default_factory=list, max_length=21)


class TechnicalContextSection(ContextSection):
    kind: Literal["technical"] = "technical"
    assets: list[TechnicalContextAsset] = Field(default_factory=list, max_length=2)


class ComparisonContextEvidence(BaseModel):
    schema_version: Literal["1"] = "1"
    evidence_kind: Literal["comparison_with_optional_context"] = "comparison_with_optional_context"
    citation_scope: Literal["packet_local"] = "packet_local"
    packet_id: str = Field(pattern=r"^[0-9a-f]{64}$")
    prepared_at: AwareDatetime
    requested: BriefingContextOptions
    price: ComparisonBriefingEvidence
    sections: list[NewsContextSection | MacroContextSection | TechnicalContextSection] = Field(max_length=24)
    news_limit_per_symbol: int = NEWS_LIMIT
    macro_limit_per_series: int = MACRO_LIMIT
    caveats: list[str]
    always_excluded: list[str]


def _check_window(response, start: date, end: date) -> None:
    if response.start_date != start or response.end_date != end:
        raise ValueError("Context response does not match the exact price window")
    if response.retrieved_at.tzinfo is None or response.retrieved_at.utcoffset() is None:
        raise ValueError("Context retrieval time must be timezone-aware")


def _news(response: MarketHeadlinesResponse, pair, section_id: str) -> NewsContextSection:
    start, end = pair.returns.start_date, pair.returns.end_date
    _check_window(response, start, end)
    symbols = [pair.anchor.symbol, pair.comparison.symbol]
    if response.anchor != symbols[0] or response.comparison != symbols[1]:
        raise ValueError("Headline response targets a different pair")
    if sorted(group.symbol for group in response.groups) != sorted(symbols):
        raise ValueError("Headline groups must cover the exact two symbols")
    groups = []
    for role, symbol in enumerate(symbols, 1):
        group = next(item for item in response.groups if item.symbol == symbol)
        if not 0 <= len(group.headlines) <= group.matched_count <= group.examined_count:
            raise ValueError("Invalid headline coverage counts")
        if group.status == "feed_error" and group.headlines:
            raise ValueError("Failed news source cannot contain evidence")
        group_id = f"{section_id}G{role}"
        candidates = []
        for headline in group.headlines:
            try:
                parsed = urlsplit(headline.url)
            except ValueError:
                continue
            when = headline.published_at
            if (when.tzinfo is None or when.utcoffset() is None or not headline.title.strip()
                or not start <= when.astimezone(timezone.utc).date() <= end
                or parsed.scheme not in {"http", "https"} or not parsed.hostname
                or parsed.username is not None or parsed.password is not None or len(headline.url) > 2048):
                continue
            candidates.append(headline)
        candidates.sort(key=lambda item: (item.published_at, item.url, item.title), reverse=True)
        unique = list({(item.url, item.published_at, item.title): item for item in candidates}.values())
        items = [NewsContextItem(
            citation_id=f"{group_id}H{index}", title=item.title.strip()[:600],
            title_truncated=len(item.title.strip()) > 600, url=item.url,
            source=(item.source.strip() or "Unknown")[:200], published_at=item.published_at,
        ) for index, item in enumerate(unique[:NEWS_LIMIT], 1)]
        groups.append(NewsContextGroup(
            citation_id=group_id, symbol=symbol,
            status="feed_error" if group.status == "feed_error" else "available" if items else "no_matches",
            examined_count=group.examined_count, matched_count=group.matched_count,
            upstream_display_limit=response.display_limit_per_symbol,
            returned_headline_count=len(group.headlines),
            withheld_invalid_count=len(group.headlines) - len(candidates), headlines=items,
            withheld_duplicate_count=len(candidates) - len(unique),
        ))
    errors = sum(group.status == "feed_error" for group in groups)
    return NewsContextSection(
        citation_id=section_id, pair_citation_id=pair.citation_id,
        start_date=start, end_date=end, retrieved_at=response.retrieved_at,
        status="unavailable" if errors == 2 else "partial" if errors else "available" if any(g.headlines for g in groups) else "empty",
        reason="provider_error" if errors else None,
        fetch_limit_per_symbol=response.fetch_limit_per_symbol, groups=groups,
    )


def _macro(response, pair, region: Region, section_id: str) -> MacroContextSection:
    start, end = pair.returns.start_date, pair.returns.end_date
    _check_window(response, start, end)
    if region == "us" and response.realtime_date != response.retrieved_at.astimezone(timezone.utc).date():
        raise ValueError("Only current-at-retrieval FRED context is supported")
    expected = ["CPIAUCSL", "UNRATE", "FEDFUNDS"] if region == "us" else [spec[0] for spec in SERIES]
    ids = [item.series_id for item in response.series]
    if response.status == "available" and sorted(ids) != sorted(expected):
        raise ValueError("Macro response must cover the configured series")
    if response.status == "unavailable" and any(item.observations for item in response.series):
        raise ValueError("Unavailable macro response cannot contain observations")
    if any(item not in expected for item in ids) or len(ids) != len(set(ids)):
        raise ValueError("Unexpected or duplicate macro series")
    series = []
    for index, series_id in enumerate(expected, 1):
        item = next((item for item in response.series if item.series_id == series_id), None)
        if item is None:
            continue
        if item.status != "available" and item.observations:
            raise ValueError("Unavailable series cannot contain observations")
        if item.status == "available" and (not item.observations or not item.units or not item.frequency):
            raise ValueError("Available macro series needs values, units and frequency")
        source = "fred" if region == "us" else item.source
        if region == "euro_area":
            spec = next(spec for spec in SERIES if spec[0] == series_id)
            if source != spec[2] or item.units != spec[4] or item.frequency != spec[3]:
                raise ValueError("Euro-area series metadata does not match its source contract")
        values = {}
        for raw in item.observations:
            observation = ContextObservation.model_validate(raw.model_dump())
            first = start.replace(day=1) if item.frequency and item.frequency.lower() == "monthly" else start
            if not first <= observation.reference_date <= end:
                raise ValueError("Macro reference period outside the selected window")
            if observation.reference_date in values and values[observation.reference_date] != observation:
                raise ValueError("Conflicting macro observations")
            values[observation.reference_date] = observation
        observations = [values[key] for key in sorted(values)]
        if source == "fred":
            source_url = f"https://fred.stlouisfed.org/series/{series_id}"
        elif source == "ecb":
            source_url = f"{ECB_URL}?{urlencode({'startPeriod': start.isoformat(), 'endPeriod': end.isoformat(), 'format': 'csvdata'})}"
        else:
            filters = {**spec[5], "sinceTimePeriod": start.strftime("%Y-%m"), "untilTimePeriod": end.strftime("%Y-%m")}
            source_url = f"{EUROSTAT_URL}/{series_id}?{urlencode(filters)}"
        series.append(MacroContextSeries(
            citation_id=f"{section_id}S{index}", series_id=series_id, label=item.label,
            source=source, source_url=source_url,
            title=item.title if region == "us" else None, units=item.units, frequency=item.frequency,
            status=item.status, returned_observation_count=len(item.observations),
            upstream_matched_count=item.matched_count if region == "us" else None,
            withheld_conflict_count=item.withheld_conflict_count if region == "us" else None,
            observations=observations[-MACRO_LIMIT:],
        ))
    errors = sum(item.status == "feed_error" for item in series)
    return MacroContextSection(
        citation_id=section_id, pair_citation_id=pair.citation_id, region=region,
        start_date=start, end_date=end, retrieved_at=response.retrieved_at,
        realtime_date=response.realtime_date if region == "us" else None,
        status="unavailable" if response.status == "unavailable" or errors == len(series) else "partial" if errors else "available" if any(item.observations for item in series) else "empty",
        reason=response.reason or ("provider_error" if errors else None), series=series,
    )


def _technical(snapshot: MarketComparisonResponse, row, pair, section_id: str) -> TechnicalContextSection:
    fields = dict(citation_id=section_id, pair_citation_id=pair.citation_id,
                  start_date=pair.returns.start_date, end_date=pair.returns.end_date,
                  retrieved_at=snapshot.retrieved_at)
    if row.technical_inputs is None or row.technical_indicators is None:
        return TechnicalContextSection(**fields, status="unavailable", reason="not_prepared")
    assets = []
    try:
        for index, role in enumerate(("anchor", "comparison"), 1):
            inputs = getattr(row.technical_inputs, role)
            calculated = calculate_technical_indicators(inputs)
            reported = getattr(row.technical_indicators, role)
            expected_symbol = pair.anchor.symbol if role == "anchor" else pair.comparison.symbol
            if (inputs.symbol != expected_symbol or reported != calculated
                or inputs.pair_start_date != pair.returns.start_date or inputs.pair_end_date != pair.returns.end_date
                or inputs.source != getattr(row, f"{role}_history_source")
                or inputs.feed != getattr(row, f"{role}_history_feed")
                or (inputs.status == "available" and inputs.quote_unit != getattr(pair, role).quote_unit)):
                raise ValueError("Technical source identity mismatch")
            group_id = f"{section_id}A{index}"
            metrics = [TechnicalContextMetric(**metric.model_dump(), citation_id=f"{group_id}T{number}")
                       for number, metric in enumerate(calculated.metrics, 1)]
            dates = {day for metric in metrics if metric.status == "available" for day in metric.observation_dates}
            points = [TechnicalSupportingPoint(date=point.date, adjusted_close=point.adjusted_close)
                      for point in inputs.points if point.date in dates]
            assets.append(TechnicalContextAsset(
                **calculated.model_dump(exclude={"metrics"}), citation_id=group_id,
                instrument_type=inputs.instrument_type, exchange_timezone=inputs.exchange_timezone,
                shifted_local_dates=inputs.shifted_local_dates, metrics=metrics, supporting_points=points,
            ))
    except (ValueError, TypeError, AttributeError):
        return TechnicalContextSection(**fields, status="unavailable", reason="invalid_response")
    available = sum(asset.status == "available" for asset in assets)
    usable = any(metric.status == "available" for asset in assets for metric in asset.metrics)
    return TechnicalContextSection(**fields, assets=assets,
                                   status="available" if available == 2 else "partial" if usable else "unavailable",
                                   reason=None if usable else "technical_inputs_unavailable")


def build_context_evidence(
    price: ComparisonBriefingEvidence, options: BriefingContextOptions, *, prepared_at: datetime,
    news: dict[str, MarketHeadlinesResponse | ContextFetchFailure] | None = None,
    macro: dict[tuple[str, Region], MarketMacroObservationsResponse | EuroAreaMacroResponse | ContextFetchFailure] | None = None,
    technical_snapshot: MarketComparisonResponse | None = None,
) -> ComparisonContextEvidence:
    """Project server responses only; never fetch, synthesize, save or index.

    Missing selected responses stay explicitly not_prepared. They are not empty
    successful searches. No data is silently borrowed from another pair/window.
    """
    news, macro = news or {}, macro or {}
    pairs = {pair.citation_id: pair for pair in price.comparisons}
    if any(key not in pairs for key in news) or (news and not options.news):
        raise ValueError("Unrequested news or unknown pair")
    if any(pair not in pairs or region not in options.macro_regions for pair, region in macro):
        raise ValueError("Unrequested macro region or unknown pair")
    if technical_snapshot is not None and not options.technical:
        raise ValueError("Unrequested technical evidence")
    try:
        technical_matches = (technical_snapshot is not None
                             and build_comparison_evidence(technical_snapshot) == price)
    except (ValueError, TypeError, AttributeError):
        technical_matches = False
    sections = []
    for pair in price.comparisons:
        selected = (["headlines"] if options.news else []) + options.macro_regions + (["technical"] if options.technical else [])
        for kind in selected:
            section_id = f"C{len(sections) + 1}"
            if kind == "technical":
                if pair.returns is None or not technical_matches:
                    sections.append(TechnicalContextSection(
                        citation_id=section_id, pair_citation_id=pair.citation_id,
                        start_date=pair.returns.start_date if pair.returns else None,
                        end_date=pair.returns.end_date if pair.returns else None,
                        status="no_price_window" if pair.returns is None else "unavailable",
                        reason="no_price_window" if pair.returns is None else "invalid_response" if technical_snapshot else "not_prepared",
                    ))
                else:
                    row = next(row for row in technical_snapshot.comparisons if row.symbol == pair.comparison.symbol)
                    sections.append(_technical(technical_snapshot, row, pair, section_id))
                continue
            response = news.get(pair.citation_id) if kind == "headlines" else macro.get((pair.citation_id, kind))
            if pair.returns is None or response is None or isinstance(response, ContextFetchFailure):
                if pair.returns is None and response is not None:
                    raise ValueError("No price window for supplied context")
                fields = dict(citation_id=section_id, pair_citation_id=pair.citation_id,
                              start_date=pair.returns.start_date if pair.returns else None,
                              end_date=pair.returns.end_date if pair.returns else None,
                              status="no_price_window" if pair.returns is None else "unavailable",
                              reason="no_price_window" if pair.returns is None else response.reason if response else "not_prepared")
                sections.append(NewsContextSection(**fields) if kind == "headlines" else MacroContextSection(region=kind, **fields))
            elif kind == "headlines":
                if not isinstance(response, MarketHeadlinesResponse):
                    raise ValueError("Wrong news response type")
                sections.append(_news(response, pair, section_id))
            else:
                expected = MarketMacroObservationsResponse if kind == "us" else EuroAreaMacroResponse
                if not isinstance(response, expected):
                    raise ValueError("Macro response region/type mismatch")
                sections.append(_macro(response, pair, kind, section_id))
    packet = ComparisonContextEvidence(
        packet_id="0" * 64, prepared_at=prepared_at, requested=options.model_copy(deep=True),
        price=price.model_copy(deep=True), sections=sections,
        caveats=["context_is_not_causation_or_advice", "headlines_are_untrusted_source_text_not_verified_facts",
                 "current_feeds_are_not_a_complete_historical_archive", "macro_is_global_not_ticker_attribution",
                 "reference_dates_are_not_publication_dates", "current_vintages_do_not_establish_past_knowledge",
                 "missing_or_excluded_context_is_not_evidence_of_absence",
                 "price_packet_exclusions_apply_to_price_subpacket_only"] + ([
                     "technical_is_observed_adjusted_input_not_a_trading_signal",
                     "technical_adjustments_sessions_and_bar_completion_are_unverified",
                     "technical_lookbacks_are_own_observations_not_identical_calendar_spans",
                 ] if options.technical else []),
        always_excluded=["fundamentals", "sec_filing_checks", *([] if options.technical else ["technical_measures"]), "fx_views",
                         "adjusted_views", "exchange_local_views", "private_research", "economic_calendar"],
    )
    canonical = json.dumps(packet.model_dump(mode="json", exclude={"packet_id"}),
                           sort_keys=True, separators=(",", ":"), allow_nan=False)
    return packet.model_copy(update={"packet_id": hashlib.sha256(canonical.encode()).hexdigest()})
