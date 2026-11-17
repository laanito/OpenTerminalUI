import { api } from "./base";
import {
  briefingValidation as v, BriefingNotRetainedError, streamBriefing, validateBriefingResult,
  type BriefingModelProfile, type BriefingPhase, type BriefingSelection, type ComparisonBriefingResult,
} from "./comparisonBriefing";
import { validateContextBriefingResult, type BriefingContextOptions, type ContextBriefingResult } from "./comparisonContextBriefing";
import { validateSentimentSources } from "./sentimentContext";
import type { RetainedHeadline } from "./headlineSentiment";

export type CaptureLineage = {
  kind: "saved_input_rerun" | "fresh_refresh" | "retained_sentiment_interpretation"; parent_id: string; parent_content_hash: string;
  source_generated_at: string; replay_request_index: number | null; model_policy: "current_deep";
};
export type CaptureSummary = BriefingSelection & {
  id: string; captured_at: string; mode: "price" | "context"; status: "complete" | "unavailable";
  lineage?: CaptureLineage | null; content_hash: string; retention: "retained_no_automatic_expiry";
};
export type ComparisonCapture = CaptureSummary & {
  content: {
    schema_version: 1; lineage?: CaptureLineage | null; mode: "price" | "context";
    selection: BriefingSelection & { context: BriefingContextOptions | null };
    generation: {
      contract_version: "comparison-capture-v1"; protocol: "openai_compatible_chat_completions";
      profile: BriefingModelProfile; enabled: boolean; timeout_seconds: number; structured_output: string;
      prepared_request?: Record<string, unknown> | null; attempts: Array<{ dispatched_at: string; body: Record<string, unknown> }>;
    };
    result: ComparisonBriefingResult | ContextBriefingResult;
    sentiment_sources?: RetainedHeadline[] | null;
  };
};
const path = "/market-context/briefing-captures";
const invalid = () => new Error("This saved briefing could not be displayed safely. Its stored contents have not been changed.");

function validLineage(value: unknown): boolean {
  return value === null || value === undefined || (v.record(value)
    && v.choice(value.kind, ["saved_input_rerun", "fresh_refresh", "retained_sentiment_interpretation"]) && v.text(value.parent_id)
    && v.text(value.parent_content_hash) && /^[a-f0-9]{64}$/.test(value.parent_content_hash)
    && v.timestamp(value.source_generated_at) && value.model_policy === "current_deep"
    && (value.replay_request_index === null || (Number.isInteger(value.replay_request_index) && Number(value.replay_request_index) >= 0))
    && (value.kind === "saved_input_rerun" || value.replay_request_index === null));
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (v.record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function validateCaptureSummary(value: unknown): CaptureSummary {
  if (!v.record(value) || !v.text(value.id) || !v.timestamp(value.captured_at)
    || !v.text(value.anchor) || !v.strings(value.comparisons) || !value.comparisons.length || value.comparisons.length > 6
    || !v.choice(value.period, ["1M", "3M", "6M"]) || !v.choice(value.mode, ["price", "context"])
    || !v.choice(value.status, ["complete", "unavailable"]) || !v.text(value.content_hash) || !/^[a-f0-9]{64}$/.test(value.content_hash)
    || value.retention !== "retained_no_automatic_expiry" || !validLineage(value.lineage)) throw invalid();
  return value as unknown as CaptureSummary;
}
export function validateComparisonCapture(value: unknown): ComparisonCapture {
  const summary = validateCaptureSummary(value);
  if (!v.record(value) || !v.record(value.content)) throw invalid();
  const content = value.content;
  if (content.schema_version !== 1 || content.mode !== summary.mode || !v.record(content.selection)
    || !v.record(content.generation) || content.selection.anchor !== summary.anchor || content.selection.period !== summary.period
    || JSON.stringify(content.selection.comparisons) !== JSON.stringify(summary.comparisons)) throw invalid();
  if (!validLineage(content.lineage) || stableJson(content.lineage ?? null) !== stableJson(summary.lineage ?? null)) throw invalid();
  const generation = content.generation;
  if (generation.contract_version !== "comparison-capture-v1" || generation.protocol !== "openai_compatible_chat_completions"
    || !v.record(generation.profile) || !v.choice(generation.profile.requested_profile, ["fast", "deep"])
    || !v.choice(generation.profile.resolved_profile, ["fast", "deep"]) || !v.text(generation.profile.model)
    || typeof generation.enabled !== "boolean" || !v.finite(generation.timeout_seconds) || generation.timeout_seconds <= 0
    || !v.text(generation.structured_output) || !Array.isArray(generation.attempts)
    || (generation.prepared_request !== undefined && generation.prepared_request !== null && !v.record(generation.prepared_request))
    || generation.attempts.some((attempt) => !v.record(attempt) || !v.timestamp(attempt.dispatched_at) || !v.record(attempt.body))) throw invalid();
  const context = content.selection.context;
  if (context !== null && (!v.record(context) || typeof context.news !== "boolean" || !Array.isArray(context.macro_regions)
    || context.macro_regions.length > 2 || context.macro_regions.some((region) => !v.choice(region, ["us", "euro_area"]))
    || new Set(context.macro_regions).size !== context.macro_regions.length
    || (context.technical !== undefined && typeof context.technical !== "boolean")
    || (context.fundamentals !== undefined && typeof context.fundamentals !== "boolean"))) throw invalid();
  const selectedContext = v.record(context) && (context.news || (context.macro_regions as unknown[]).length || context.technical || context.fundamentals);
  if (Boolean(selectedContext) !== (summary.mode === "context")) throw invalid();
  if (summary.mode === "context") {
    if (!v.record(context) || typeof context.news !== "boolean" || !Array.isArray(context.macro_regions)) throw invalid();
    validateContextBriefingResult(content.result, summary, context as unknown as BriefingContextOptions);
  } else validateBriefingResult(content.result, summary);
  if (!v.record(content.result) || content.result.status !== summary.status) throw invalid();
  const result = content.result as unknown as ContextBriefingResult;
  if (summary.mode === "context" && result.evidence?.schema_version === "3") {
    const origin = summary.lineage?.kind === "retained_sentiment_interpretation" ? summary.lineage : null;
    validateSentimentSources(content.sentiment_sources, result.evidence, origin?.parent_id, origin?.parent_content_hash);
  } else if (content.sentiment_sources !== undefined && content.sentiment_sources !== null) throw invalid();
  return value as unknown as ComparisonCapture; // Preserve the original JSON; do not hydrate new defaults.
}

export async function listComparisonCaptures(signal?: AbortSignal, offset = 0): Promise<CaptureSummary[]> {
  const { data } = await api.get(path, { signal, params: { limit: 20, offset } });
  if (!Array.isArray(data)) throw invalid();
  return data.map(validateCaptureSummary);
}
export async function getComparisonCapture(id: string, signal?: AbortSignal): Promise<ComparisonCapture> {
  const { data } = await api.get(`${path}/${encodeURIComponent(id)}`, { signal });
  const result = validateComparisonCapture(data);
  if (result.id !== id) throw invalid();
  return result;
}
export async function deleteComparisonCapture(id: string, signal?: AbortSignal): Promise<void> {
  await api.delete(`${path}/${encodeURIComponent(id)}`, { signal });
}
export async function streamComparisonCapture(selection: BriefingSelection, context: BriefingContextOptions,
  options: { signal?: AbortSignal; onProgress?: (phase: BriefingPhase) => void } = {}): Promise<ComparisonCapture> {
  const hasContext = Boolean(context.news || context.macro_regions.length || context.technical || context.fundamentals);
  try {
    return await streamBriefing(selection, options, {
      path: `${path}/stream`, context: hasContext, capture: true,
      body: (normalized) => ({ ...normalized, context: hasContext ? context : null }),
      validate: (value, normalized) => {
        const saved = validateComparisonCapture(value);
        if (saved.anchor !== normalized.anchor || saved.period !== normalized.period
          || JSON.stringify(saved.comparisons) !== JSON.stringify(normalized.comparisons) || saved.mode !== (hasContext ? "context" : "price")) throw invalid();
        if (hasContext) validateContextBriefingResult(saved.content.result, normalized, context);
        return saved;
      },
    });
  } catch (error) {
    if (options.signal?.aborted || error instanceof BriefingNotRetainedError) throw error;
    throw new Error("Saving could not be confirmed or the saved result could not be displayed. Refresh saved briefings before retrying.");
  }
}


export async function streamCaptureFollowup(source: ComparisonCapture, kind: "rerun" | "refresh",
  options: { signal?: AbortSignal; onProgress?: (phase: BriefingPhase) => void } = {}): Promise<ComparisonCapture> {
  try {
    return await streamBriefing(source.content.selection, options, {
      path: `${path}/${encodeURIComponent(source.id)}/${kind}/stream`, context: source.mode === "context", capture: true,
      body: () => ({}),
      validate: (value) => {
        const saved = validateComparisonCapture(value);
        const lineage = saved.lineage;
        if (saved.id === source.id || !lineage || lineage.kind !== (kind === "rerun" ? "saved_input_rerun" : "fresh_refresh")
          || lineage.parent_id !== source.id || lineage.parent_content_hash !== source.content_hash
          || Date.parse(lineage.source_generated_at) !== Date.parse(source.content.result.generated_at)
          || saved.mode !== source.mode || stableJson(saved.content.selection) !== stableJson(source.content.selection)) throw invalid();
        if (kind === "rerun") {
          const attempts = source.content.generation.attempts;
          const index = attempts.length ? attempts.length - 1 : null;
          const original = index !== null ? attempts[index].body : source.content.generation.prepared_request;
          const next = saved.content.generation.attempts[0]?.body ?? saved.content.generation.prepared_request;
          if (!original || !next || saved.content.generation.attempts.length > 1 || lineage.replay_request_index !== index
            || next.model !== saved.content.generation.profile.model
            || stableJson({ ...original, model: next.model }) !== stableJson(next)
            || stableJson(saved.content.result.evidence) !== stableJson(source.content.result.evidence)) throw invalid();
        }
        return saved;
      },
    });
  } catch (error) {
    if (options.signal?.aborted || error instanceof BriefingNotRetainedError) throw error;
    throw new Error("The follow-up could not be confirmed or displayed. Refresh saved briefings before retrying; the source run is unchanged.");
  }
}

export async function streamSentimentBriefing(source: ComparisonCapture, snapshotIds: string[],
  options: { signal?: AbortSignal; onProgress?: (phase: BriefingPhase) => void } = {}): Promise<ComparisonCapture> {
  if (!snapshotIds.length || snapshotIds.length > 5 || new Set(snapshotIds).size !== snapshotIds.length) throw new Error("Choose one to five distinct retained headline observations.");
  try {
    return await streamBriefing(source.content.selection, options, {
      path: `${path}/${encodeURIComponent(source.id)}/sentiment-briefing/stream`, context: true, capture: true,
      body: () => ({ snapshot_ids: snapshotIds }),
      validate: (value) => {
        const child = validateComparisonCapture(value), lineage = child.lineage;
        const evidence = child.content.result.evidence;
        const original = source.content.result.evidence;
        if (!lineage || lineage.kind !== "retained_sentiment_interpretation" || child.id === source.id
          || lineage.parent_id !== source.id || lineage.parent_content_hash !== source.content_hash
          || Date.parse(lineage.source_generated_at) !== Date.parse(source.content.result.generated_at)
          || child.mode !== "context" || stableJson(child.content.selection) !== stableJson(source.content.selection)
          || !evidence || !("sentiment" in evidence) || !original || !("price" in original)
          || stableJson(evidence.price) !== stableJson(original.price) || stableJson(evidence.sections) !== stableJson(original.sections)
          || stableJson(evidence.requested) !== stableJson(original.requested)
          || stableJson(child.content.sentiment_sources?.map(row => row.id)) !== stableJson(snapshotIds)) throw invalid();
        return child;
      },
    });
  } catch (error) {
    if (options.signal?.aborted || error instanceof BriefingNotRetainedError) throw error;
    throw new Error("Interpretation saving could not be confirmed or displayed. Refresh saved briefings before retrying; the original is unchanged.");
  }
}
