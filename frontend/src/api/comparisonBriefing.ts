import { fetchApi } from "./base";
import type { MarketContextPeriod } from "./marketContext";

export type BriefingSelection = { anchor: string; comparisons: string[]; period: MarketContextPeriod };
export const BRIEFING_CAVEATS = {
  native_quote_not_fx_normalized: "Returns are in native quote units, not FX-normalized.",
  utc_dates_not_simultaneous_sessions: "Shared UTC dates do not establish simultaneous trading sessions.",
  no_causal_or_investment_conclusion: "These observations establish neither causation nor an investment recommendation.",
  stale_history: "History is stale.",
  mixed_reported_price_basis: "Reported price bases differ; the returns are not confirmed like-for-like.",
  unverified_price_basis: "At least one price basis is unverified.",
  reported_basis_not_quality_verification: "Matching reported price bases do not verify returned-price quality.",
  unknown_quote_unit: "At least one selected history has an unknown quote unit.",
  withheld_conflicting_closes: "Conflicting closes were withheld from the fetched payload, possibly outside this pair window.",
  comparison_unavailable: "No comparison return was calculated; this is not a zero return.",
} as const;
export const BRIEFING_EXCLUSIONS = {
  headlines: "News headlines", fundamentals: "Fundamentals", sec_filing_checks: "SEC filing checks",
  macro: "Macro evidence", technical_measures: "Technical measures", fx_views: "FX views",
  adjusted_views: "Adjusted-price views", exchange_local_views: "Exchange-local views", private_research: "Private research",
} as const;
export type BriefingCaveat = keyof typeof BRIEFING_CAVEATS;
export interface BriefingAsset {
  symbol: string; history_adapter: string | null; history_feed: string | null; latest_date: string | null;
  quote_unit: string | null; quote_unit_source: "yahoo_chart_meta" | "unavailable";
  reported_adjustment_basis: "raw" | "non_split_adjusted" | "unspecified" | null;
  withheld_provider_close_count: number; withheld_date_scope: "selected_history_payload";
}
export interface BriefingPair {
  citation_id: string; status: "available" | "unavailable";
  reason: "missing_history" | "insufficient_overlap" | "provider_error" | null;
  anchor: BriefingAsset; comparison: BriefingAsset;
  pair_reported_basis_status: "matching_reported" | "mixed_reported" | "unverified" | "unavailable";
  returns: null | {
    start_date: string; end_date: string; observations: number; freshness: "current" | "stale";
    anchor_return_pct: number; comparison_return_pct: number; relative_return_pp: number;
  };
  caveats: BriefingCaveat[];
}
export interface BriefingEvidence {
  schema_version: "1"; citation_scope: "packet_local"; packet_id: string;
  status: "available" | "partial" | "unavailable"; anchor: string; period: MarketContextPeriod;
  retrieved_at: string; data_source: "unified_history"; method: "same_utc_date_daily_closes";
  return_basis: "native_quote_currency_provider_closes"; included_evidence: "shared_utc_provider_close_returns";
  not_included: (keyof typeof BRIEFING_EXCLUSIONS)[]; comparisons: BriefingPair[];
}
export type BriefingStatement = { text: string; citation_ids: string[] };
export type BriefingModelProfile = {
  requested_profile: "fast" | "deep"; resolved_profile: "fast" | "deep"; model: string;
};
export interface ComparisonBriefingResult {
  status: "complete" | "unavailable"; engine: "llm" | "unavailable"; model: string | null;
  model_profile?: BriefingModelProfile | null;
  generated_at: string; evidence: BriefingEvidence | null; scope_citation_id: "SCOPE";
  citation_validation: "references_only_not_fact_checked"; scope_notice: string;
  observations: BriefingStatement[]; limitations: BriefingStatement[]; unknowns: BriefingStatement[];
  failure: null | { code: string; message: string; retryable: boolean };
}
export type BriefingPhase = "queued" | "preparing_evidence" | "collecting_context" | "checking_model" | "generating" | "validating" | "retrying";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const nullableText = (value: unknown) => value === null || text(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const day = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const timestamp = (value: unknown) => text(value) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const choice = (value: unknown, values: readonly unknown[]) => values.includes(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const unique = (value: string[]) => new Set(value).size === value.length;
const hasKey = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const invalid = () => new Error("The briefing response was incomplete or did not match the selected evidence. No answer was kept; retry manually.");

function validAsset(value: unknown, symbol: string): value is BriefingAsset {
  return record(value) && value.symbol === symbol && nullableText(value.history_adapter) && nullableText(value.history_feed)
    && (value.latest_date === null || day(value.latest_date)) && nullableText(value.quote_unit)
    && choice(value.quote_unit_source, ["yahoo_chart_meta", "unavailable"])
    && choice(value.reported_adjustment_basis, [null, "raw", "non_split_adjusted", "unspecified"])
    && finite(value.withheld_provider_close_count) && Number.isInteger(value.withheld_provider_close_count)
    && value.withheld_provider_close_count >= 0 && value.withheld_date_scope === "selected_history_payload";
}

function validEvidence(value: unknown, selection: BriefingSelection): value is BriefingEvidence {
  if (!record(value) || value.schema_version !== "1" || value.citation_scope !== "packet_local"
    || !text(value.packet_id) || !/^[a-f0-9]{64}$/.test(value.packet_id)
    || value.anchor !== selection.anchor || value.period !== selection.period || !timestamp(value.retrieved_at)
    || value.data_source !== "unified_history" || value.method !== "same_utc_date_daily_closes"
    || value.return_basis !== "native_quote_currency_provider_closes" || value.included_evidence !== "shared_utc_provider_close_returns"
    || !strings(value.not_included) || !unique(value.not_included)
    || value.not_included.length !== Object.keys(BRIEFING_EXCLUSIONS).length
    || value.not_included.some((key) => !hasKey(BRIEFING_EXCLUSIONS, key))
    || !Array.isArray(value.comparisons) || value.comparisons.length !== selection.comparisons.length) return false;
  for (const [index, pair] of value.comparisons.entries()) {
    if (!record(pair)) return false;
    const caveats = pair.caveats;
    if (pair.citation_id !== `P${index + 1}` || !choice(pair.status, ["available", "unavailable"])
      || !choice(pair.reason, [null, "missing_history", "insufficient_overlap", "provider_error"])
      || !validAsset(pair.anchor, selection.anchor) || !validAsset(pair.comparison, selection.comparisons[index])
      || !choice(pair.pair_reported_basis_status, ["matching_reported", "mixed_reported", "unverified", "unavailable"])
      || !strings(caveats) || !unique(caveats) || caveats.some((key) => !hasKey(BRIEFING_CAVEATS, key))
      || !["native_quote_not_fx_normalized", "utc_dates_not_simultaneous_sessions", "no_causal_or_investment_conclusion"].every((key) => caveats.includes(key))) return false;
    if (pair.status === "available") {
      const returns = pair.returns;
      if (!record(returns) || !day(returns.start_date) || !day(returns.end_date) || returns.start_date > returns.end_date
        || !finite(returns.observations) || !Number.isInteger(returns.observations) || returns.observations < 2
        || !choice(returns.freshness, ["current", "stale"]) || !finite(returns.anchor_return_pct)
        || !finite(returns.comparison_return_pct) || !finite(returns.relative_return_pp)) return false;
    } else if (pair.returns !== null) return false;
  }
  const available = value.comparisons.filter((pair) => pair.status === "available").length;
  return value.status === (available === 0 ? "unavailable" : available === value.comparisons.length ? "available" : "partial");
}

/** Validate the transport envelope/identity/references, not the truth of model prose. */
export function validateBriefingResult(value: unknown, selection: BriefingSelection): ComparisonBriefingResult {
  if (!record(value) || !choice(value.status, ["complete", "unavailable"]) || !nullableText(value.model)
    || !timestamp(value.generated_at) || value.scope_citation_id !== "SCOPE"
    || value.citation_validation !== "references_only_not_fact_checked" || !text(value.scope_notice) || value.scope_notice.length > 1200
    || (value.evidence !== null && !validEvidence(value.evidence, selection))) throw invalid();
  if (value.model_profile != null && (!record(value.model_profile)
    || value.model_profile.requested_profile !== "deep"
    || !choice(value.model_profile.resolved_profile, ["fast", "deep"])
    || !text(value.model_profile.model) || value.model_profile.model !== value.model)) throw invalid();
  const packet = value.evidence as BriefingEvidence | null;
  const known = new Set(["SCOPE", ...(packet?.comparisons.map((pair) => pair.citation_id) ?? [])]);
  for (const name of ["observations", "limitations", "unknowns"]) {
    const points = value[name];
    if (!Array.isArray(points) || points.length > 6 || points.some((point) => !record(point)
      || !text(point.text) || point.text.trim().length < 10 || point.text.length > 600
      || !strings(point.citation_ids) || point.citation_ids.length < 1 || point.citation_ids.length > 7
      || !unique(point.citation_ids) || point.citation_ids.some((id) => !known.has(id)))) throw invalid();
  }
  if (value.status === "complete") {
    if (value.engine !== "llm" || !packet || packet.status === "unavailable" || value.failure !== null
      || [value.observations, value.limitations, value.unknowns].some((points) => (points as unknown[]).length === 0)) throw invalid();
    const observed = new Set((value.observations as BriefingStatement[]).flatMap((point) => point.citation_ids));
    const available = packet.comparisons.filter((pair) => pair.status === "available").map((pair) => pair.citation_id);
    if (observed.size !== available.length || available.some((id) => !observed.has(id))) throw invalid();
    const unknown = new Set((value.unknowns as BriefingStatement[]).flatMap((point) => point.citation_ids));
    const limited = new Set((value.limitations as BriefingStatement[]).flatMap((point) => point.citation_ids));
    if (!unknown.has("SCOPE") || available.some((id) => unknown.has(id))) throw invalid();
    for (const pair of packet.comparisons) {
      if (pair.status === "unavailable" && !unknown.has(pair.citation_id) && !limited.has(pair.citation_id)) throw invalid();
      if (pair.caveats.some((key) => ["stale_history", "mixed_reported_price_basis", "unverified_price_basis", "unknown_quote_unit", "withheld_conflicting_closes"].includes(key)) && !limited.has(pair.citation_id)) throw invalid();
    }
  } else if (value.engine !== "unavailable" || !record(value.failure) || !text(value.failure.code)
    || !text(value.failure.message) || typeof value.failure.retryable !== "boolean"
    || [value.observations, value.limitations, value.unknowns].some((points) => (points as unknown[]).length !== 0)) throw invalid();
  return value as unknown as ComparisonBriefingResult;
}

export const briefingValidation = { record, text, nullableText, finite, day, timestamp, choice, strings, unique, invalid, validEvidence };

type StreamOptions = { signal?: AbortSignal; onProgress?: (phase: BriefingPhase) => void };
/** No automatic replay: a new request would incur a new model run and snapshot. */
export function streamComparisonBriefing(selection: BriefingSelection, options: StreamOptions = {}): Promise<ComparisonBriefingResult> {
  return streamBriefing(selection, options, {
    path: "/market-context/briefing/stream", context: false,
    body: (requested) => requested, validate: validateBriefingResult,
  });
}

/** Shared bounded NDJSON lifecycle; each contract supplies its own validator. */
export async function streamBriefing<T>(
  selection: BriefingSelection,
  options: StreamOptions,
  contract: { path: string; context: boolean; body: (selection: BriefingSelection) => unknown;
    validate: (value: unknown, selection: BriefingSelection) => T },
): Promise<T> {
  if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const requested: BriefingSelection = {
    anchor: selection.anchor.trim().toUpperCase(),
    comparisons: [...new Set(selection.comparisons.map((symbol) => symbol.trim().toUpperCase()))],
    period: selection.period,
  };
  const symbol = /^[A-Z0-9^._=-]{1,40}$/;
  if (!symbol.test(requested.anchor) || requested.comparisons.length < 1 || requested.comparisons.length > 6
    || requested.comparisons.includes(requested.anchor) || requested.comparisons.some((item) => !symbol.test(item))
    || !choice(requested.period, ["1M", "3M", "6M"])) throw new Error("Choose a valid comparison before generating a briefing.");
  const controller = new AbortController();
  const started = Date.now();
  let timedOut = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onInternalAbort = () => rejectAbort(timedOut
    ? new Error("The briefing exceeded its time limit. No answer was kept; retry manually.")
    : new DOMException("Cancelled", "AbortError"));
  controller.signal.addEventListener("abort", onInternalAbort, { once: true });
  const externalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  const expire = () => { timedOut = true; controller.abort(); };
  let timer = setTimeout(expire, 300_000);
  let startedEvent = false;
  let result: T | null = null;
  const maxRecord = contract.context ? 512_000 : 256_000;
  try {
    const response = await Promise.race([fetchApi(contract.path, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify(contract.body(requested)), signal: controller.signal,
    }), aborted]);
    if (!response.ok) throw new Error(`Could not start briefing (HTTP ${response.status}). Retry manually.`);
    if (!response.headers.get("content-type")?.includes("application/x-ndjson") || !response.body) throw invalid();
    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "";
    const apply = (line: string) => {
      if (!line.trim()) return;
      if (line.length > maxRecord || result) throw invalid();
      let event: unknown;
      try { event = JSON.parse(line); } catch { throw invalid(); }
      if (!record(event)) throw invalid();
      if (event.type === "start") {
        if (startedEvent || !record(event.deadlines)) throw invalid();
        const evidence = event.deadlines.evidence_seconds;
        const model = event.deadlines.model_seconds;
        const context = contract.context ? event.deadlines.context_seconds : 0;
        if (!finite(evidence) || evidence <= 0 || !finite(model) || model <= 0) throw invalid();
        if (!finite(context) || (contract.context && context <= 0)) throw invalid();
        const budget = (evidence + context + model + 15) * 1000;
        if (!Number.isSafeInteger(Math.ceil(budget)) || budget > 2_147_483_647) throw invalid();
        clearTimeout(timer);
        timer = setTimeout(expire, Math.max(0, started + budget - Date.now()));
        startedEvent = true;
        options.onProgress?.("queued");
      } else if (!startedEvent) throw invalid();
      else if (event.type === "progress") {
        if (!choice(event.phase, ["preparing_evidence", "checking_model", "generating", "validating", "retrying", ...(contract.context ? ["collecting_context"] : [])])) throw invalid();
        options.onProgress?.(event.phase as BriefingPhase);
      } else if (event.type === "result") result = contract.validate(event.result, requested);
      else if (event.type === "error") throw new Error("The briefing failed before completion. No answer was kept; retry manually.");
      else throw invalid(); // In particular, never render unchecked provider deltas.
    };
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > maxRecord) throw invalid();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) apply(line);
      if (done && buffer.trim()) { apply(buffer); buffer = ""; }
      if (result) {
        if (buffer.trim()) throw invalid();
        return result;
      }
      if (done) throw new Error("The briefing stream ended before completion. No answer was kept; retry manually.");
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", externalAbort);
    controller.signal.removeEventListener("abort", onInternalAbort);
    controller.abort();
    if (reader) {
      void reader.cancel().catch(() => undefined);
      try { reader.releaseLock(); } catch { /* A cancelled read may still be unwinding. */ }
    }
  }
}
