import { briefingValidation as v } from "./comparisonBriefing";
import type { ContextEvidence } from "./comparisonContextBriefing";
import { validAssessment, validateRetainedHeadline, retainedObservationKey, type RetainedAssessment, type RetainedHeadline } from "./headlineSentiment";

export type SentimentContextItem = {
  citation_id: string; pair_citation_id: string; headline_citation_id: string;
  snapshot_id: string; content_hash: string; captured_at: string; headline: RetainedHeadline["payload"];
  assessment_id: string; recorded_at: string; assessment: Omit<RetainedAssessment["payload"], "generation">;
};
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (v.record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function validSentimentContext(packet: ContextEvidence): boolean {
  if (packet.schema_version !== "3") return packet.sentiment === undefined || (Array.isArray(packet.sentiment) && packet.sentiment.length === 0);
  if (!packet.requested.news || !Array.isArray(packet.sentiment) || !packet.sentiment.length || packet.sentiment.length > 100) return false;
  const sources = new Set<string>();
  for (const [index, item] of packet.sentiment.entries()) {
    if (!v.record(item) || item.citation_id !== `R${index + 1}` || !v.timestamp(item.recorded_at)
      || !validAssessment({ id: item.assessment_id, recorded_at: item.recorded_at, payload: item.assessment }, true)
      || ("generation" in item.assessment)) return false;
    try {
      validateRetainedHeadline({ id: item.snapshot_id, captured_at: item.captured_at, content_hash: item.content_hash,
        retention: "retained_no_automatic_expiry", payload: item.headline, assessments: [] });
    } catch { return false; }
    const section = packet.sections.find((s) => s.kind === "headlines" && s.pair_citation_id === item.pair_citation_id);
    const group = section?.kind === "headlines" ? section.groups.find((g) => g.symbol === item.headline.symbols[0]) : null;
    const headline = group?.headlines.find((h) => h.citation_id === item.headline_citation_id);
    if (!headline || item.headline.symbols.length !== 1 || !item.headline.origin?.citation_ids.includes(item.headline_citation_id)
      || item.headline.title !== headline.title || item.headline.source_url !== headline.url || item.headline.publisher !== headline.source
      || Date.parse(item.headline.published_at!) !== Date.parse(headline.published_at)
      || Date.parse(item.headline.retrieved_at) !== Date.parse(section!.retrieved_at!) || item.headline.truncated !== headline.title_truncated
      || item.headline.text_scope !== "headline_only" || item.headline.summary !== ""
      || item.assessment.input_text !== headline.title
      || item.assessment.target_symbol !== (item.assessment.meaning === "asset_implication" ? group!.symbol : null)) return false;
    sources.add(item.snapshot_id);
  }
  return sources.size <= 5;
}
export function validateSentimentSources(raw: unknown, packet: ContextEvidence, parentId?: string, parentHash?: string): RetainedHeadline[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 5 || packet.schema_version !== "3") throw v.invalid();
  const sources = raw.map(validateRetainedHeadline);
  if (new Set(sources.map(s => s.id)).size !== sources.length) throw v.invalid();
  const expected: unknown[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const p = source.payload, origin = p.origin;
    if (!origin || (parentId && origin.capture_id !== parentId) || (parentHash && origin.capture_content_hash !== parentHash)
      || source.assessments.length !== 2 || new Set(source.assessments.map(a => a.payload.meaning)).size !== 2) throw v.invalid();
    const identity = retainedObservationKey(source);
    if (seen.has(identity)) throw v.invalid();
    seen.add(identity);
    for (const assessment of source.assessments) for (const reference of origin.citation_ids) {
      const section = packet.sections.find(s => s.kind === "headlines" && s.groups.some(g => g.headlines.some(h => h.citation_id === reference)));
      if (!section) throw v.invalid();
      const { generation: _generation, ...projected } = assessment.payload;
      expected.push({ citation_id: `R${expected.length + 1}`, pair_citation_id: section.pair_citation_id, headline_citation_id: reference,
        snapshot_id: source.id, content_hash: source.content_hash, captured_at: source.captured_at, headline: p,
        assessment_id: assessment.id, recorded_at: assessment.recorded_at, assessment: projected });
    }
  }
  if (stableJson(expected) !== stableJson(packet.sentiment)) throw v.invalid();
  return sources;
}
