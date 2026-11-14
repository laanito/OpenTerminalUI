import { api } from "./base";
import {
  briefingValidation as v, BriefingNotRetainedError, streamBriefing, validateBriefingResult,
  type BriefingModelProfile, type BriefingPhase, type BriefingSelection, type ComparisonBriefingResult,
} from "./comparisonBriefing";
import { validateContextBriefingResult, type BriefingContextOptions, type ContextBriefingResult } from "./comparisonContextBriefing";

export type CaptureSummary = BriefingSelection & {
  id: string; captured_at: string; mode: "price" | "context"; status: "complete" | "unavailable";
  content_hash: string; retention: "retained_no_automatic_expiry";
};
export type ComparisonCapture = CaptureSummary & {
  content: {
    schema_version: 1; mode: "price" | "context";
    selection: BriefingSelection & { context: BriefingContextOptions | null };
    generation: {
      contract_version: "comparison-capture-v1"; protocol: "openai_compatible_chat_completions";
      profile: BriefingModelProfile; enabled: boolean; timeout_seconds: number; structured_output: string;
      attempts: Array<{ dispatched_at: string; body: Record<string, unknown> }>;
    };
    result: ComparisonBriefingResult | ContextBriefingResult;
  };
};
const path = "/market-context/briefing-captures";
const invalid = () => new Error("This saved briefing could not be displayed safely. Its stored contents have not been changed.");

export function validateCaptureSummary(value: unknown): CaptureSummary {
  if (!v.record(value) || !v.text(value.id) || !v.timestamp(value.captured_at)
    || !v.text(value.anchor) || !v.strings(value.comparisons) || !value.comparisons.length || value.comparisons.length > 6
    || !v.choice(value.period, ["1M", "3M", "6M"]) || !v.choice(value.mode, ["price", "context"])
    || !v.choice(value.status, ["complete", "unavailable"]) || !v.text(value.content_hash) || !/^[a-f0-9]{64}$/.test(value.content_hash)
    || value.retention !== "retained_no_automatic_expiry") throw invalid();
  return value as unknown as CaptureSummary;
}
export function validateComparisonCapture(value: unknown): ComparisonCapture {
  const summary = validateCaptureSummary(value);
  if (!v.record(value) || !v.record(value.content)) throw invalid();
  const content = value.content;
  if (content.schema_version !== 1 || content.mode !== summary.mode || !v.record(content.selection)
    || !v.record(content.generation) || content.selection.anchor !== summary.anchor || content.selection.period !== summary.period
    || JSON.stringify(content.selection.comparisons) !== JSON.stringify(summary.comparisons)) throw invalid();
  const generation = content.generation;
  if (generation.contract_version !== "comparison-capture-v1" || generation.protocol !== "openai_compatible_chat_completions"
    || !v.record(generation.profile) || !v.choice(generation.profile.requested_profile, ["fast", "deep"])
    || !v.choice(generation.profile.resolved_profile, ["fast", "deep"]) || !v.text(generation.profile.model)
    || typeof generation.enabled !== "boolean" || !v.finite(generation.timeout_seconds) || generation.timeout_seconds <= 0
    || !v.text(generation.structured_output) || !Array.isArray(generation.attempts)
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
