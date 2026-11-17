"""Project explicitly selected retained opinions onto their original price pairs."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from backend.services.captured_headline_sentiment import SelectedHeadlines, select_headlines
from backend.services.news_evidence import NewsText, RetainedHeadline, SentimentAssessment


class SelectedSentiment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    snapshot_ids: list[str] = Field(min_length=1, max_length=5)

    @model_validator(mode="after")
    def unique(self):
        if any(not item or len(item) > 36 for item in self.snapshot_ids) or len(set(self.snapshot_ids)) != len(self.snapshot_ids):
            raise ValueError("Select one to five different retained headline observations")
        return self


class ProjectedAssessment(SentimentAssessment):
    # Full scoring requests are preserved in capture.sentiment_sources for offline
    # inspection, not repeated inside the Deep model's evidence input.
    generation: None = Field(default=None, exclude=True)


class SentimentContextItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    citation_id: str
    pair_citation_id: str
    headline_citation_id: str
    snapshot_id: str
    content_hash: str
    captured_at: AwareDatetime
    headline: NewsText
    assessment_id: str
    recorded_at: AwareDatetime
    assessment: ProjectedAssessment


def build_sentiment_context(evidence, sources: list[RetainedHeadline], *, capture_id: str, content_hash: str, prepared_at: datetime | None = None):
    """Keep price/context unchanged; attach each selected method to its source pair.

    Duplicate observations of the same source/target are rejected, not amplified.
    Original publication/retrieval/scoring times and failure status remain distinct.
    """
    if not evidence.requested.news or evidence.schema_version == "3":
        raise ValueError("Choose an original saved news briefing without retained sentiment")
    if not 1 <= len(sources) <= 5:
        raise ValueError("Choose one to five retained headline observations")
    references = {headline.citation_id: section.pair_citation_id
                  for section in evidence.sections if section.kind == "headlines"
                  for group in section.groups for headline in group.headlines}
    items, seen = [], set()
    for source in sources:
        text, origin = source.payload, source.payload.origin
        if (origin is None or origin.capture_id != capture_id or origin.capture_content_hash != content_hash
            or len(text.symbols) != 1 or source.content_hash != text.content_hash):
            raise ValueError("Retained source does not match this saved briefing")
        expected = select_headlines(evidence, SelectedHeadlines(headlines=[
            {"citation_id": ref, "target_symbol": text.symbols[0]} for ref in origin.citation_ids
        ]), capture_id=capture_id, content_hash=content_hash)
        if len(expected) != 1 or expected[0] != text:
            raise ValueError("Retained text differs from its saved headline observation")
        identity = (text.content_hash, text.source_url, text.publisher, text.published_at,
                    text.retrieved_at, text.truncated, text.symbols)
        if identity in seen:
            raise ValueError("Choose one assessment observation per source/target, not repeated reports")
        seen.add(identity)
        if (len(source.assessments) != 2
            or {item.payload.meaning for item in source.assessments} != {"text_tone", "asset_implication"}
            or len({item.id for item in source.assessments}) != 2):
            raise ValueError("Both independent retained methods are required")
        for item in source.assessments:
            assessment = item.payload
            if (assessment.input_text != text.title or assessment.target_symbol != (
                text.symbols[0] if assessment.meaning == "asset_implication" else None
            )):
                raise ValueError("Assessment target/input differs from the retained headline")
            if (assessment.generation is not None and assessment.model != assessment.generation.profile.model
                or assessment.reused_from_cache and (assessment.status != "complete" or assessment.generation is None or not assessment.generation.attempts)):
                raise ValueError("Assessment generation/cache identity is inconsistent")
            for ref in origin.citation_ids:
                items.append(SentimentContextItem(
                    citation_id=f"R{len(items) + 1}", pair_citation_id=references[ref], headline_citation_id=ref,
                    snapshot_id=source.id, content_hash=source.content_hash, captured_at=source.captured_at,
                    headline=text, assessment_id=item.id, recorded_at=item.recorded_at,
                    assessment=ProjectedAssessment.model_validate(assessment.model_dump(exclude={"generation"})),
                ))
    packet = evidence.model_copy(deep=True, update={
        "schema_version": "3", "prepared_at": prepared_at or datetime.now(timezone.utc), "sentiment": items,
    })
    canonical = json.dumps(packet.model_dump(mode="json", exclude={"packet_id"}), sort_keys=True,
                           separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return packet.model_copy(update={"packet_id": hashlib.sha256(canonical.encode()).hexdigest()})
