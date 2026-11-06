"""A bounded model input must not hide conflicts behind inspector display caps."""
from copy import deepcopy
from datetime import date, datetime, timezone

import pytest
from pydantic import ValidationError

from backend.services.filing_briefing_evidence import (
    DISCLOSURE_LIMIT, GROUP_LIMIT, build_filing_evidence, unavailable_filing_evidence,
)

START, END = date(2025, 1, 1), date(2025, 12, 31)
WHEN = datetime(2026, 1, 2, tzinfo=timezone.utc)


def row(index=1, value=100, **changes):
    return {**dict(start='2025-01-01', end='2025-03-31', filed='2025-05-02',
                   accn=f'0000320193-25-{index:06d}', form='10-Q', val=value), **changes}


def payload(rows):
    return {'cik': 320193, 'facts': {'us-gaap': {'Revenues': {'units': {'USD': rows}}}}}


def build(raw):
    return build_filing_evidence(raw, symbol='AAPL', cik=320193, start=START, end=END, retrieved_at=WHEN)


def test_retains_exact_identity_dates_and_zero_without_inventing_history():
    packet = build(payload([row(value=0), row(2, value=0, filed='2025-08-01')]))
    assert packet.status == 'available'
    group = packet.groups[0]
    assert (group.concept, group.unit, group.period_start, group.period_end, group.value) == (
        'Revenues', 'USD', START, date(2025, 3, 31), 0)
    assert group.disclosure_count == 2
    assert {d.accession for d in group.disclosures} == {'0000320193-25-000001', '0000320193-25-000002'}
    assert group.disclosures[0].filed_date == date(2025, 8, 1)
    assert group.disclosures[0].filing_url.endswith('/320193/000032019325000002/0000320193-25-000002-index.html')
    assert packet.historical_availability == packet.revision_order == 'not_established'
    assert packet.schema_version == '1'
    assert len(packet.packet_id) == len(packet.source_records_id) == 64
    assert packet == type(packet).model_validate_json(packet.model_dump_json())


def test_conflict_beyond_existing_inspector_cap_withholds_every_value():
    rows = [row(i) for i in range(1, 61)]
    # Oldest sort position falls outside the existing 50-fact inspector cap.
    rows.append(row(0, 999))
    packet = build(payload(rows))
    assert packet.matched_fact_count == 61
    assert packet.conflicting_group_count == 1
    assert packet.status == 'empty'
    group = packet.groups[0]
    assert group.status == 'conflicting_values' and group.value is None
    assert group.distinct_value_count == 2
    assert len(group.disclosures) == DISCLOSURE_LIMIT
    assert group.omitted_disclosure_count == 61 - DISCLOSURE_LIMIT
    assert all('value' not in disclosure.model_dump() for disclosure in group.disclosures)


def test_different_values_across_accessions_are_not_inferred_revisions():
    packet = build(payload([row(value=100), row(2, 120, filed='2025-08-01')]))
    assert packet.groups[0].value is None
    assert packet.groups[0].status == 'conflicting_values'
    assert packet.revision_order == 'not_established'


def test_equal_integer_and_float_duplicates_have_order_independent_identity():
    rows = [row(value=100), row(value=100.0)]
    assert build(payload(rows)) == build(payload(list(reversed(rows))))


def test_metadata_conflict_hash_is_order_independent():
    rows = [row(), row(form='10-Q/A')]
    assert build(payload(rows)) == build(payload(list(reversed(rows))))


def test_conflicting_metadata_for_one_accession_is_withheld_even_when_values_match():
    packet = build(payload([row(), row(form='10-Q/A')]))
    assert packet.groups[0].status == 'conflicting_filing_metadata'
    assert packet.groups[0].value is None


def test_separate_concepts_durations_and_units_are_never_collapsed():
    raw = payload([row(), row(2, 500, start='2024-04-01')])
    raw['facts']['us-gaap']['RevenueFromContractWithCustomerExcludingAssessedTax'] = {
        'units': {'USD': [row(value=200)]}}
    raw['facts']['us-gaap']['EarningsPerShareDiluted'] = {'units': {'USD/shares': [row(value=-2)]}}
    raw['facts']['us-gaap']['Revenues']['units']['EUR'] = [row(value=999)]
    packet = build(raw)
    assert len(packet.groups) == 4 and packet.conflicting_group_count == 0
    assert {g.unit for g in packet.groups} == {'USD', 'USD/shares'}
    assert {g.value for g in packet.groups} == {100, 200, 500, -2}


def test_invalid_undated_out_of_window_and_duplicate_rows_do_not_become_evidence():
    rows = [row(), row(), row(2, True), row(3, float('inf')),
            row(4, filed='2025-03-01'), row(5, filed='2026-01-01'),
            row(6, filed='invalid'), row(7, start='2025-04-01'),
            row(8, form='8-K'), row(9, start=None), row(10, accn='invalid')]
    packet = build(payload(rows))
    assert packet.matched_fact_count == packet.matched_group_count == 1
    assert packet.examined_count == len(rows)
    assert packet.groups[0].value == 100


def test_full_group_counts_and_omitted_changes_are_fingerprinted():
    rows = [row(i, i, start=f'2025-01-{i:02d}', end=f'2025-01-{i:02d}')
            for i in range(1, GROUP_LIMIT + 3)]
    first = build(payload(rows))
    assert first.status == 'partial'
    assert first.matched_group_count == GROUP_LIMIT + 2
    assert first.omitted_group_count == 2 and len(first.groups) == GROUP_LIMIT
    assert first.packet_id == build(payload(list(reversed(rows)))).packet_id
    changed = deepcopy(rows)
    changed[0]['val'] = 1234  # A group beyond the display limit.
    second = build(payload(changed))
    assert first.groups == second.groups
    assert first.source_records_id != second.source_records_id
    assert first.packet_id != second.packet_id
    changed[0]['val'] = 1
    changed.append(row(999, 900, start='2025-01-01', end='2025-01-01'))
    assert build(payload(changed)).conflicting_group_count == 1


def test_no_eligible_values_is_distinct_from_feed_failure_and_non_gaap_scope():
    for raw in [payload([]), {'cik': 320193, 'facts': {'ifrs-full': {}}}]:
        packet = build(raw)
        assert packet.status == 'empty' and packet.reason is None and packet.groups == []
    for reason in ['configuration_required', 'not_covered', 'ambiguous_ticker', 'provider_error', 'timed_out']:
        packet = unavailable_filing_evidence(symbol='BTC-USD', start=START, end=END, retrieved_at=WHEN, reason=reason)
        assert packet.status == 'unavailable' and packet.reason == reason
        assert packet.source_records_id is None and packet.groups == []
    with pytest.raises(ValidationError):
        unavailable_filing_evidence(symbol='AAPL', start=START, end=END, retrieved_at=WHEN, reason='secret provider URL')


@pytest.mark.parametrize('raw', [{'cik': 42, 'facts': {}}, {'cik': True, 'facts': {}},
                                  {'cik': 320193}, {'cik': 320193, 'facts': {'us-gaap': []}}])
def test_rejects_mismatched_identity_or_malformed_payload(raw):
    with pytest.raises(ValueError):
        build(raw)


@pytest.mark.parametrize('changes', [dict(symbol='aapl'), dict(cik=True), dict(cik=0),
    dict(retrieved_at=WHEN.replace(tzinfo=None)), dict(start=END, end=START),
    dict(end=date(2026, 2, 1)), dict(start=date(2020, 1, 1))])
def test_rejects_ambiguous_scope(changes):
    args = dict(symbol='AAPL', cik=320193, start=START, end=END, retrieved_at=WHEN)
    args.update(changes)
    with pytest.raises(ValueError):
        build_filing_evidence(payload([row()]), **args)
