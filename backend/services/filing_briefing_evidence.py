"""Internal SEC briefing projection; no fetching, historical reconstruction or LLM.

Call only after exact ticker/CIK resolution. Inspect the full eligible Company
Facts set before truncating. Conflicting groups provide coverage, never values.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timezone
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from backend.services.sec_filing_evidence import eligible_filed_facts

GROUP_LIMIT = 8
DISCLOSURE_LIMIT = 3
FailureReason = Literal['configuration_required', 'not_covered', 'ambiguous_ticker', 'provider_error', 'timed_out']


class FilingDisclosure(BaseModel):
    accession: str
    form: str
    filed_date: date
    filing_url: str


class FilingMetricGroup(BaseModel):
    citation_id: str
    taxonomy: Literal['us-gaap'] = 'us-gaap'
    concept: str
    unit: str
    period_start: date
    period_end: date
    status: Literal['available', 'conflicting_values', 'conflicting_filing_metadata']
    value: float | None = Field(allow_inf_nan=False)
    distinct_value_count: int
    disclosure_count: int
    omitted_disclosure_count: int
    disclosures: list[FilingDisclosure] = Field(max_length=DISCLOSURE_LIMIT)


class FilingBriefingEvidence(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schema_version: Literal['1'] = '1'
    evidence_kind: Literal['sec_filing_briefing'] = 'sec_filing_briefing'
    packet_id: str
    symbol: str
    cik: int | None
    filed_start: date
    filed_end: date
    retrieved_at: AwareDatetime
    source: Literal['sec_current_companyfacts'] = 'sec_current_companyfacts'
    historical_availability: Literal['not_established'] = 'not_established'
    revision_order: Literal['not_established'] = 'not_established'
    status: Literal['available', 'partial', 'empty', 'unavailable']
    reason: FailureReason | None = None
    examined_count: int = 0
    matched_fact_count: int = 0
    matched_group_count: int = 0
    conflicting_group_count: int = 0
    omitted_group_count: int = 0
    source_records_id: str | None = None
    group_limit: int = GROUP_LIMIT
    disclosure_limit: int = DISCLOSURE_LIMIT
    groups: list[FilingMetricGroup] = Field(default_factory=list, max_length=GROUP_LIMIT)
    caveats: list[str] = Field(default_factory=lambda: [
        'Current SEC aggregation, not an archived vintage or independently corroborated filing value.',
        'Filed dates are not verified publication instants or proof of investor knowledge.',
        'Conflicts are checked only among eligible records in the selected filed-date window.',
        'Equal concept/unit/exact duration identifies a group, not cross-issuer comparability.',
        'Different revenue concepts and fiscal durations are never merged; no growth rate is inferred.',
        'Later accessions do not automatically supersede earlier disclosures.',
        'Output is bounded; omitted records and provider coverage remain unknown to the briefing.',
    ])


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), default=str,
                                     allow_nan=False).encode()).hexdigest()


def _envelope(symbol: str, cik: int | None, start: date, end: date, retrieved_at: datetime) -> dict:
    if not re.fullmatch(r'[A-Z0-9][A-Z0-9.^=\-]{0,39}', symbol):
        raise ValueError('Expected a normalized market symbol')
    if cik is not None and (type(cik) is not int or not 1 <= cik <= 9_999_999_999):
        raise ValueError('Invalid CIK')
    if retrieved_at.tzinfo is None or retrieved_at.utcoffset() is None:
        raise ValueError('Retrieval time must be timezone-aware')
    if not start <= end <= retrieved_at.astimezone(timezone.utc).date() or (end - start).days > 730:
        raise ValueError('Invalid filed-date window')
    return dict(symbol=symbol, cik=cik, filed_start=start, filed_end=end, retrieved_at=retrieved_at)


def _finish(**values) -> FilingBriefingEvidence:
    packet = FilingBriefingEvidence(packet_id='', **values)
    return packet.model_copy(update={'packet_id': _digest(packet.model_dump(mode='json', exclude={'packet_id'}))})


def unavailable_filing_evidence(*, symbol: str, start: date, end: date, retrieved_at: datetime,
                                reason: FailureReason, cik: int | None = None) -> FilingBriefingEvidence:
    """Preserve failures as scope, with no invented values or exception text."""
    return _finish(**_envelope(symbol, cik, start, end, retrieved_at), status='unavailable', reason=reason)


def build_filing_evidence(payload: dict[str, Any], *, symbol: str, cik: int, start: date,
                          end: date, retrieved_at: datetime) -> FilingBriefingEvidence:
    envelope = _envelope(symbol, cik, start, end, retrieved_at)
    if type(payload.get('cik')) is not int or payload['cik'] != cik:
        raise ValueError('Company Facts CIK mismatch')
    if not isinstance(payload.get('facts'), dict) or (
        'us-gaap' in payload['facts'] and not isinstance(payload['facts']['us-gaap'], dict)
    ):
        raise ValueError('Malformed Company Facts taxonomy')
    records, examined = eligible_filed_facts(payload, start, end)
    grouped: dict[tuple, list[dict]] = {}
    for row in records:
        grouped.setdefault((row['concept'], row['unit'], row['period_start'], row['period_end']), []).append(row)
    ordered = sorted(grouped.items(), key=lambda item: (
        max(row['filed_date'] for row in item[1]), *item[0]), reverse=True)
    groups = []
    conflict_count = 0
    for index, ((concept, unit, period_start, period_end), rows) in enumerate(ordered, 1):
        values = {row['value'] for row in rows}
        by_accession: dict[str, set[tuple]] = {}
        for row in rows:
            by_accession.setdefault(row['accession'], set()).add((row['filed_date'], row['form']))
        status = ('conflicting_values' if len(values) > 1 else 'conflicting_filing_metadata'
                  if any(len(metadata) > 1 for metadata in by_accession.values()) else 'available')
        conflict_count += status != 'available'
        if index > GROUP_LIMIT:
            continue
        disclosures = sorted({(row['filed_date'], row['accession'], row['form']) for row in rows}, reverse=True)
        groups.append(FilingMetricGroup(
            citation_id=f'F{index}', concept=concept, unit=unit, period_start=period_start, period_end=period_end,
            status=status, value=next(iter(values)) if status == 'available' else None,
            distinct_value_count=len(values), disclosure_count=len(disclosures),
            omitted_disclosure_count=max(0, len(disclosures) - DISCLOSURE_LIMIT),
            disclosures=[FilingDisclosure(
                accession=accession, form=form, filed_date=filed,
                filing_url=f'https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace("-", "")}/{accession}-index.html',
            ) for filed, accession, form in disclosures[:DISCLOSURE_LIMIT]],
        ))
    usable = any(group.status == 'available' for group in groups)
    limited = conflict_count > 0 or len(ordered) > GROUP_LIMIT or any(group.omitted_disclosure_count for group in groups)
    # Equal int/float values deduplicate in the SEC selector. Hash their exact
    # ratios so input ordering cannot change which representation wins the hash.
    canonical_records = [dict(row, value=row['value'].as_integer_ratio()) for row in records]
    return _finish(**envelope, status=('partial' if limited else 'available') if usable else 'empty',
                   examined_count=examined, matched_fact_count=len(records), matched_group_count=len(ordered),
                   conflicting_group_count=conflict_count, omitted_group_count=max(0, len(ordered) - GROUP_LIMIT),
                   source_records_id=_digest(sorted(canonical_records, key=_digest)), groups=groups)
