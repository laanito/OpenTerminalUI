"""Regenerate browser filing fixtures from deterministic server projections.

Run from the repository root with PYTHONPATH=. and the backend test environment.
No live provider or model is used. --check verifies without writing.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.services.comparison_context_briefing import ComparisonContextBriefingResult
from backend.services.filing_briefing_evidence import unavailable_filing_evidence
from backend.services.llm_profiles import LLMProfileIdentity
from backend.services.market_briefing_context_evidence import BriefingContextOptions, build_context_evidence
from backend.tests.test_filing_context_synthesis import answer, packet
from backend.tests.test_market_briefing_context_evidence import NOW, prices

DESTINATION = Path(__file__).resolve().parents[2] / 'frontend/src/__tests__/fixtures/filingContextBriefing.json'


def fixture() -> dict:
    result = {'selection': {'anchor': 'AAPL', 'comparisons': ['SPY'], 'period': '1M'}}
    for mode in ['available', 'conflict', 'truncated', 'failed', 'empty', 'mixed', 'configuration_required', 'not_covered']:
        if mode in {'configuration_required', 'not_covered'}:
            price = prices()
            window = price.comparisons[0].returns
            filings = {('P1', symbol): unavailable_filing_evidence(
                symbol=symbol, start=window.start_date, end=window.end_date, retrieved_at=NOW, reason=mode,
            ) for symbol in ['AAPL', 'SPY']}
            evidence = build_context_evidence(price, BriefingContextOptions(fundamentals=True),
                                               prepared_at=NOW, filings=filings)
        else:
            evidence = packet(mode=mode if mode != 'mixed' else 'available', mixed=mode == 'mixed')
        generated = answer(evidence)
        generated.pop('packet_id')
        response = ComparisonContextBriefingResult(
            status='complete', engine='llm', model='fixture-deep-model',
            model_profile=LLMProfileIdentity(requested_profile='deep', resolved_profile='deep', model='fixture-deep-model'),
            generated_at=NOW, evidence=evidence, **generated,
        )
        result['complete' if mode == 'available' else mode] = response.model_dump(mode='json')
    failure = result['complete'].copy()
    failure.update(status='unavailable', engine='unavailable', failure={
        'code': 'invalid_response', 'message': 'Could not produce a checked briefing. Retry manually.', 'retryable': True,
    })
    for field in ['observations', 'hypotheses', 'possible_context', 'limitations', 'unknowns']:
        failure[field] = []
    result['model_failure'] = failure
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    content = json.dumps(fixture(), ensure_ascii=False, indent=2) + '\n'
    if args.check:
        if not DESTINATION.exists() or DESTINATION.read_text() != content:
            raise SystemExit('Stale filing briefing fixture; rerun without --check.')
        print('Filing briefing fixture is current.')
    else:
        DESTINATION.write_text(content)
        print(f'Wrote {DESTINATION}')


if __name__ == '__main__':
    main()
