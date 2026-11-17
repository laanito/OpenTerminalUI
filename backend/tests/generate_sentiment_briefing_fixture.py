"""Regenerate shared browser fixtures from deterministic retained-evidence models.

Run with PYTHONPATH=. and the backend test environment. No provider/model calls.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile

if __name__ == "__main__":
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{Path(tempfile.gettempdir()) / 'openterminalui_sentiment_fixture.db'}"
from backend.api.routes.comparison_captures import ContextCaptureContent, CapturedGeneration, CaptureLineage
from backend.services.captured_headline_sentiment import SelectedHeadlines, select_headlines, baseline
from backend.services.comparison_context_briefing import ComparisonContextBriefingResult, validate_context_briefing, context_scope_notice
from backend.services.news_evidence import RetainedHeadline, RetainedAssessment, SentimentAssessment
from backend.services.sentiment_context_evidence import build_sentiment_context
from backend.tests.test_comparison_context_briefing import packet, valid

DESTINATION = Path(__file__).resolve().parents[2] / 'frontend/src/__tests__/fixtures/retainedSentimentBriefing.json'
NOW = datetime(2026, 11, 17, 10, tzinfo=timezone.utc)


def generated(evidence):
    answer = valid(evidence)
    for pair in evidence.price.comparisons:
        refs = [item.citation_id for item in evidence.sentiment if item.pair_citation_id == pair.citation_id and item.assessment.status == 'complete']
        if refs:
            answer['possible_context'].append({'text': 'Retained text tone and asset implication differ; the selected opinions do not establish causation.', 'citation_ids': [pair.citation_id, *refs]})
    validate_context_briefing(json.dumps(answer), evidence)
    answer.pop('packet_id')
    return ComparisonContextBriefingResult(status='complete', engine='llm', model='fixture-deep',
        model_profile={'requested_profile': 'deep', 'resolved_profile': 'deep', 'model': 'fixture-deep'},
        generated_at=NOW, evidence=evidence, scope_notice=context_scope_notice(evidence), **answer)


def generation():
    return CapturedGeneration(profile={'requested_profile': 'deep', 'resolved_profile': 'deep', 'model': 'fixture-deep'},
        enabled=True, timeout_seconds=240, structured_output='auto', attempts=[{'dispatched_at': NOW, 'body': {
            'model': 'fixture-deep', 'messages': [{'role': 'user', 'content': 'Synthetic saved input'}],
            'stream': False, 'max_tokens': 6400, 'temperature': 0.2}}])


def receipt(content, identity):
    encoded = json.dumps(content.model_dump(mode='json'), ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
    selection = content.selection
    return {'id': identity, 'captured_at': NOW.isoformat().replace('+00:00', 'Z'), 'mode': 'context', 'status': 'complete',
        'anchor': selection.anchor, 'comparisons': selection.comparisons, 'period': selection.period,
        'content_hash': hashlib.sha256(encoded.encode()).hexdigest(), 'retention': 'retained_no_automatic_expiry',
        'lineage': content.lineage.model_dump(mode='json') if content.lineage else None,
        'content': content.model_dump(mode='json')}


def fixture():
    evidence = packet()
    parent_content = ContextCaptureContent(mode='context', selection={
        'anchor': evidence.price.anchor, 'comparisons': [pair.comparison.symbol for pair in evidence.price.comparisons],
        'period': evidence.price.period, 'context': evidence.requested}, generation=generation(), result=generated(evidence))
    parent = receipt(parent_content, 'sentiment-source')
    text = select_headlines(evidence, SelectedHeadlines(headlines=[{'citation_id': 'C1G1H1', 'target_symbol': 'AAPL'}]),
        capture_id=parent['id'], content_hash=parent['content_hash'])[0]
    tone = baseline(text).model_copy(update={'scored_at': NOW})
    asset = SentimentAssessment(meaning='asset_implication', target_symbol='AAPL', method='llm',
        method_version='saved-headline-asset-v1', provider='openai_compatible', model='fixture-fast',
        prompt_version='saved-headline-asset-v1', input_text=text.title, scored_at=NOW, status='complete',
        score=-0.5, label='bearish', rationale='A limited adverse implication from the retained headline.',
        generation={'profile': {'requested_profile': 'fast', 'resolved_profile': 'fast', 'model': 'fixture-fast'},
            'context_hash': 'e' * 64, 'attempts': [{'dispatched_at': NOW, 'body': {'model': 'fixture-fast',
                'messages': [{'role': 'user', 'content': '<script>untrusted retained input</script>'}], 'stream': False, 'max_tokens': 700}}]})
    source = RetainedHeadline(id='retained-headline', captured_at=NOW, content_hash=text.content_hash, payload=text, assessments=[
        RetainedAssessment(id='retained-tone', recorded_at=NOW, payload=tone),
        RetainedAssessment(id='retained-asset', recorded_at=NOW, payload=asset)])
    enriched = build_sentiment_context(evidence, [source], capture_id=parent['id'], content_hash=parent['content_hash'], prepared_at=NOW)
    content = ContextCaptureContent(mode='context', selection=parent_content.selection, generation=generation(),
        result=generated(enriched), sentiment_sources=[source], lineage=CaptureLineage(kind='retained_sentiment_interpretation',
            parent_id=parent['id'], parent_content_hash=parent['content_hash'], source_generated_at=parent_content.result.generated_at))
    return {'source': parent, 'headlines': [source.model_dump(mode='json')], 'child': receipt(content, 'sentiment-child')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    encoded = json.dumps(fixture(), ensure_ascii=False, indent=2) + '\n'
    if args.check:
        if not DESTINATION.exists() or DESTINATION.read_text() != encoded:
            raise SystemExit('Stale retained sentiment fixture; rerun without --check.')
        print('Retained sentiment fixture is current.')
    else:
        DESTINATION.write_text(encoded)
        print(f'Wrote {DESTINATION}')


if __name__ == '__main__':
    main()
