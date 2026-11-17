import { api } from "./base";
import { briefingValidation as v, streamBriefing, type BriefingModelProfile, type BriefingPhase } from "./comparisonBriefing";
import type { ComparisonCapture } from "./comparisonCaptures";
import type { ContextHeadline } from "./comparisonContextBriefing";

export type HeadlineChoice = ContextHeadline & { target_symbol: string; retrieved_at: string };
export type HeadlineSelection = { citation_id: string; target_symbol: string };
export type SentimentGeneration = {
  protocol: "openai_compatible_chat_completions"; profile: BriefingModelProfile; context_hash: string;
  attempts: Array<{ dispatched_at: string; body: Record<string, unknown> }>;
};
export type RetainedAssessment = {
  id: string; recorded_at: string; payload: {
    schema_version: 1; generation?: SentimentGeneration | null; reused_from_cache?: boolean;
    target_symbol: string | null; meaning: "text_tone" | "asset_implication"; method: string; method_version: string;
    provider: string | null; model: string | null; prompt_version: string | null; input_text: string; scored_at: string;
    status: "complete" | "fallback" | "failed"; score: number | null; label: "bullish" | "bearish" | "neutral" | null;
    rationale: string | null; confidence: number | null; confidence_kind: "heuristic" | "not_provided"; failure_code: string | null;
  };
};
export type RetainedHeadline = {
  id: string; captured_at: string; content_hash: string;
  retention: "retained_no_automatic_expiry" | "pinned_by_saved_analysis" | "unreferenced_retention_window";
  lifecycle?: { state: "pinned" | "unreferenced" | "expired" | "expiry_disabled"; retention_days: number | null;
    expires_at: string | null; referencing_capture_ids: string[]; references_truncated: boolean };
  payload: {
    schema_version: 1; origin?: { kind: "saved_comparison_headlines"; capture_id: string; capture_content_hash: string; citation_ids: string[] } | null;
    title: string; summary: string; source_url: string; publisher: string; published_at: string | null;
    retrieved_at: string; text_scope: "headline_only" | "headline_and_summary"; truncated: boolean; symbols: string[];
  }; assessments: RetainedAssessment[];
};
export function retainedObservationKey(row: RetainedHeadline): string {
  const p = row.payload;
  return JSON.stringify([p.title, p.summary, p.source_url, p.publisher, p.published_at ? Date.parse(p.published_at) : null,
    Date.parse(p.retrieved_at), p.truncated, p.symbols]);
}
const captures = "/market-context/briefing-captures";
const invalid = () => new Error("The retained headline assessments could not be displayed safely. Stored records have not been changed.");
const bounded = (value: unknown, max: number, empty = false): value is string => typeof value === "string" && (empty || Boolean(value.trim())) && value.length <= max;
const nullable = (value: unknown, max: number) => value === null || bounded(value, max, true);
const id = (value: unknown) => bounded(value, 36);
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const score = (value: unknown) => v.finite(value) && value >= -1 && value <= 1;

export function savedHeadlineChoices(source: ComparisonCapture | null): HeadlineChoice[] {
  const result = source?.content.result;
  if (!result || !("possible_context" in result) || !result.evidence) return [];
  return result.evidence.sections.flatMap((section) => {
    const retrieved = section.retrieved_at;
    return section.kind === "headlines" && retrieved
      ? section.groups.flatMap((group) => group.headlines.map((headline) => ({ ...headline, target_symbol: group.symbol, retrieved_at: retrieved }))) : [];
  });
}
function validGeneration(value: unknown) {
  if (value === undefined || value === null) return true;
  if (!v.record(value) || value.protocol !== "openai_compatible_chat_completions" || !v.record(value.profile)
    || !v.choice(value.profile.requested_profile, ["fast", "deep"]) || !v.choice(value.profile.resolved_profile, ["fast", "deep"])
    || !bounded(value.profile.model, 256) || !hash(value.context_hash) || !Array.isArray(value.attempts) || value.attempts.length > 12) return false;
  return value.attempts.every((item) => v.record(item) && v.timestamp(item.dispatched_at) && v.record(item.body));
}
export function validAssessment(value: unknown, projected = false): boolean {
  if (!v.record(value) || !id(value.id) || !v.timestamp(value.recorded_at) || !v.record(value.payload)) return false;
  const p = value.payload;
  if (p.schema_version !== 1 || !validGeneration(p.generation) || (p.reused_from_cache !== undefined && typeof p.reused_from_cache !== "boolean")
    || !v.choice(p.meaning, ["text_tone", "asset_implication"]) || !(p.target_symbol === null || bounded(p.target_symbol, 64))
    || (p.meaning === "asset_implication" && !bounded(p.target_symbol, 64)) || !bounded(p.method, 128) || !bounded(p.method_version, 128)
    || !nullable(p.provider, 128) || !nullable(p.model, 256) || !nullable(p.prompt_version, 128)
    || (p.method === "llm" && (!v.text(p.provider) || !v.text(p.model) || !v.text(p.prompt_version)))
    || !bounded(p.input_text, 131072) || !v.timestamp(p.scored_at) || !v.choice(p.status, ["complete", "fallback", "failed"])
    || !nullable(p.rationale, 16384) || !nullable(p.failure_code, 128)
    || !v.choice(p.confidence_kind, ["heuristic", "not_provided"])
    || (p.confidence === null ? p.confidence_kind !== "not_provided" : !v.finite(p.confidence) || p.confidence < 0 || p.confidence > 1 || p.confidence_kind !== "heuristic")) return false;
  if (p.reused_from_cache === true && (p.status !== "complete" || (!projected && (!v.record(p.generation) || !Array.isArray(p.generation.attempts) || !p.generation.attempts.length)))) return false;
  if (v.record(p.generation) && v.record(p.generation.profile) && p.model !== p.generation.profile.model) return false;
  if (p.status === "failed") return v.text(p.failure_code) && [p.score, p.label, p.rationale, p.confidence].every((item) => item === null);
  return score(p.score) && v.choice(p.label, ["bullish", "bearish", "neutral"])
    && (p.status === "complete" ? p.failure_code === null : v.text(p.failure_code));
}
export function validateRetainedHeadline(value: unknown): RetainedHeadline {
  if (!v.record(value) || !id(value.id) || !v.timestamp(value.captured_at) || !hash(value.content_hash)
    || !validLifecycle(value) || !v.record(value.payload) || !Array.isArray(value.assessments)
    || value.assessments.some((item) => !validAssessment(item))
    || new Set(value.assessments.map((item: Record<string, unknown>) => item.id)).size !== value.assessments.length) throw invalid();
  const p = value.payload;
  if (p.schema_version !== 1 || !bounded(p.title, 16384, true) || !bounded(p.summary, 65536, true) || !(p.title.trim() || p.summary.trim())
    || !bounded(p.source_url, 8192, true) || !bounded(p.publisher, 1024, true) || !(p.published_at === null || v.timestamp(p.published_at))
    || !v.timestamp(p.retrieved_at) || !v.choice(p.text_scope, ["headline_only", "headline_and_summary"])
    || (p.text_scope === "headline_only" && p.summary !== "") || typeof p.truncated !== "boolean"
    || !Array.isArray(p.symbols) || p.symbols.length > 20 || p.symbols.some((symbol) => !bounded(symbol, 64))) throw invalid();
  if (p.origin !== undefined && p.origin !== null) {
    const o = p.origin;
    if (!v.record(o) || o.kind !== "saved_comparison_headlines" || !id(o.capture_id) || !hash(o.capture_content_hash)
      || !Array.isArray(o.citation_ids) || !o.citation_ids.length || o.citation_ids.length > 10
      || o.citation_ids.some((item) => !bounded(item, 64)) || new Set(o.citation_ids).size !== o.citation_ids.length) throw invalid();
  }
  return value as unknown as RetainedHeadline; // Keep retained JSON; do not invent current defaults.
}
function validLifecycle(value: Record<string, unknown>): boolean {
  const status = value.lifecycle;
  if (status === undefined) return value.retention === "retained_no_automatic_expiry";
  if (!v.record(status) || !v.choice(status.state, ["pinned", "unreferenced", "expired", "expiry_disabled"])
    || !(status.retention_days === null || (Number.isInteger(status.retention_days) && Number(status.retention_days) >= 1 && Number(status.retention_days) <= 3650))
    || !(status.expires_at === null || v.timestamp(status.expires_at)) || typeof status.references_truncated !== "boolean"
    || !Array.isArray(status.referencing_capture_ids) || status.referencing_capture_ids.length > 20
    || status.referencing_capture_ids.some(item => !id(item)) || new Set(status.referencing_capture_ids).size !== status.referencing_capture_ids.length) return false;
  if (status.state === "pinned") return value.retention === "pinned_by_saved_analysis" && status.referencing_capture_ids.length > 0 && status.expires_at === null;
  if (status.referencing_capture_ids.length || status.references_truncated) return false;
  if (status.state === "expiry_disabled") return value.retention === "retained_no_automatic_expiry" && status.retention_days === null && status.expires_at === null;
  return value.retention === "unreferenced_retention_window" && status.retention_days !== null && status.expires_at !== null;
}
function validateRows(value: unknown, sourceId?: string): RetainedHeadline[] {
  if (!Array.isArray(value) || value.length > 20) throw invalid();
  const rows = value.map(validateRetainedHeadline);
  if (new Set(rows.map((row) => row.id)).size !== rows.length
    || (sourceId && rows.some((row) => row.payload.origin?.capture_id !== sourceId))) throw invalid();
  return rows;
}
export async function listHeadlineAssessments(sourceId?: string, offset = 0, signal?: AbortSignal) {
  const { data } = await api.get(sourceId ? `${captures}/${encodeURIComponent(sourceId)}/sentiment` : "/news/evidence", { signal, params: { limit: 20, offset } });
  return validateRows(data, sourceId);
}
export async function getRetainedHeadline(snapshotId: string, signal?: AbortSignal) {
  const { data } = await api.get(`/news/evidence/${encodeURIComponent(snapshotId)}`, { signal });
  const row = validateRetainedHeadline(data);
  if (row.id !== snapshotId) throw invalid();
  return row;
}
export async function deleteRetainedHeadline(snapshotId: string, signal?: AbortSignal) {
  await api.delete(`/news/evidence/${encodeURIComponent(snapshotId)}`, { signal });
}
export async function streamHeadlineAssessments(source: ComparisonCapture, selection: HeadlineSelection[],
  options: { signal?: AbortSignal; onProgress?: (phase: BriefingPhase) => void } = {}): Promise<RetainedHeadline[]> {
  const choices = savedHeadlineChoices(source);
  const selected = selection.map((item) => choices.find((choice) => choice.citation_id === item.citation_id && choice.target_symbol === item.target_symbol));
  if (!selection.length || selection.length > 10 || selected.some((choice) => !choice)
    || new Set(selection.map((item) => `${item.citation_id}:${item.target_symbol}`)).size !== selection.length) throw new Error("Choose one to ten available saved headline references.");
  try {
    return await streamBriefing(source, options, {
      path: `${captures}/${encodeURIComponent(source.id)}/sentiment/stream`, context: false, capture: true,
      body: () => ({ headlines: selection.map(({ citation_id, target_symbol }) => ({ citation_id, target_symbol })) }),
      validate: (value) => {
        const rows = validateRows(value, source.id);
        const seen = new Set<string>(), observations = new Set<string>();
        if (!rows.length || rows.length > selection.length) throw invalid();
        for (const row of rows) {
          const p = row.payload, origin = p.origin!;
          if (origin.capture_content_hash !== source.content_hash || p.text_scope !== "headline_only" || p.summary !== ""
            || row.assessments.length !== 2 || row.assessments.filter((item) => item.payload.meaning === "text_tone").length !== 1
            || row.assessments.filter((item) => item.payload.meaning === "asset_implication").length !== 1) throw invalid();
          const identity = JSON.stringify([p.symbols, p.title, p.source_url, p.publisher, p.published_at ? Date.parse(p.published_at) : null, Date.parse(p.retrieved_at), p.truncated]);
          if (observations.has(identity)) throw invalid();
          observations.add(identity);
          for (const reference of origin.citation_ids) {
            const choice = selected.find((item) => item?.citation_id === reference);
            if (!choice || seen.has(reference) || p.title !== choice.title || p.source_url !== choice.url || p.publisher !== choice.source
              || Date.parse(p.published_at!) !== Date.parse(choice.published_at) || Date.parse(p.retrieved_at) !== Date.parse(choice.retrieved_at)
              || p.truncated !== choice.title_truncated || p.symbols.length !== 1 || p.symbols[0] !== choice.target_symbol
              || row.assessments.some((item) => item.payload.input_text !== choice.title
                || item.payload.target_symbol !== (item.payload.meaning === "asset_implication" ? choice.target_symbol : null))) throw invalid();
            seen.add(reference);
          }
        }
        if (seen.size !== selection.length) throw invalid();
        return rows;
      },
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error("Assessment saving could not be confirmed or displayed. Refresh retained assessments before retrying. The saved briefing is unchanged.");
  }
}
