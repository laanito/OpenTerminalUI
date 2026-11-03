import { fetchApi } from "./base";
import type { InsightData, InsightModelProfile } from "./types";
import insightLimits from "./insightLimits.json";
import { validResearchTechnicalEvidence, validResearchTechnicalReferences } from "./researchTechnicalContext";

export type InsightKind = "backtest" | "collection" | "risk" | "briefing" | "interrogate";
export type InsightPhase = "queued" | "generating";
export type InsightRequestOptions = {
  signal?: AbortSignal;
  onProgress?: (phase: InsightPhase, elapsedSeconds: number) => void;
  onTokenProgress?: (receivedCharacters: number) => void;
  onModelProfile?: (profile: InsightModelProfile) => void;
};

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
// Python/schema character limits count Unicode code points, not UTF-16 units.
const characters = (value: string) => Array.from(value).length;
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && characters(value.trim()) <= max;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const invalid = () => new Error("The insight response was incomplete or invalid. Retry manually.");
function identity(value: unknown): InsightModelProfile {
  if (!record(value) || !["fast", "deep"].includes(String(value.requested_profile)) || !["fast", "deep"].includes(String(value.resolved_profile))
    || (value.requested_profile === "fast" && value.resolved_profile !== "fast") || !text(value.model, 256)) throw invalid();
  return value as InsightModelProfile;
}
function result(value: unknown, selected: InsightModelProfile, symbol?: string): InsightData {
  if (selected.requested_profile !== "deep") throw invalid();
  if (!record(value) || !["llm", "unavailable"].includes(String(value.engine)) || !text(value.model, 256)
    || !text(value.summary, insightLimits.summary) || !Array.isArray(value.sections) || value.sections.length > 4
    || (value.engine === "llm" ? value.sections.length < 2 : value.sections.length !== 0)) throw invalid();
  const profile = identity(value.model_profile);
  if (profile.requested_profile !== "deep" || profile.model !== value.model || profile.model !== selected.model || profile.resolved_profile !== selected.resolved_profile) throw invalid();
  let totalCharacters = characters(value.summary.trim());
  for (const section of value.sections) {
    if (!record(section) || !text(section.title, insightLimits.title) || typeof section.tone !== "string" || !["positive", "neutral", "negative"].includes(section.tone)
      || !Array.isArray(section.points) || !section.points.length || section.points.length > 5) throw invalid();
    totalCharacters += characters(section.title.trim());
    for (const point of section.points) {
      if (!text(point, insightLimits.point)) throw invalid();
      totalCharacters += characters(point.trim());
    }
    if (totalCharacters > insightLimits.totalText) throw invalid();
  }
  if (value.technical_context !== undefined && value.technical_context !== null) {
    if (!symbol || value.ticker !== symbol || !validResearchTechnicalEvidence(value.technical_context, symbol)) throw invalid();
    if (value.engine === "llm" && !validResearchTechnicalReferences(value.summary, value.sections as InsightData["sections"], value.technical_context)) throw invalid();
  }
  return value as InsightData;
}

export function validateFastResult<T extends object>(value: unknown, selected: InsightModelProfile): T {
  if (!record(value) || selected.requested_profile !== "fast" || selected.resolved_profile !== "fast") throw invalid();
  const profile = identity(value.model_profile);
  if (profile.requested_profile !== "fast" || profile.resolved_profile !== "fast" || profile.model !== selected.model || value.model !== profile.model) throw invalid();
  return value as T;
}

/** One cancellable request with server-announced deadlines; never replay inference. */
export async function streamInsight(kind: InsightKind, payload: Record<string, unknown>, options: InsightRequestOptions = {}): Promise<InsightData> {
  // Python NDJSON escapes non-ASCII characters (up to 12 ASCII chars for one
  // astral code point). Leave framing/metadata headroom above the raw limit.
  const symbol = ["briefing", "interrogate"].includes(kind) && typeof payload.ticker === "string" ? payload.ticker.trim().toUpperCase() : undefined;
  return streamModelOperation("/ai/insights/stream", { kind, payload }, (value, profile) => result(value, profile, symbol), options, insightLimits.rawResponse * 16);
}

export async function streamModelOperation<T extends object>(
  path: string, body: Record<string, unknown>, validate: (value: unknown, profile: InsightModelProfile) => T,
  options: InsightRequestOptions = {},
  maxRecordCharacters = 64_000,
): Promise<T> {
  if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const controller = new AbortController();
  const started = Date.now();
  let timedOut = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(timedOut ? new Error("The insight exceeded its time limit. Retry manually.") : new DOMException("Cancelled", "AbortError"));
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const externalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  const expire = () => { timedOut = true; controller.abort(); };
  let timer = setTimeout(expire, 300_000);
  let selected: InsightModelProfile | undefined;
  let final: T | undefined;
  try {
    const response = await Promise.race([fetchApi(path, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify(body), signal: controller.signal,
    }), aborted]);
    if (!response.ok) throw new Error(`Could not start insight (HTTP ${response.status}). Retry manually.`);
    if (!response.body || !response.headers.get("content-type")?.includes("application/x-ndjson")) throw invalid();
    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "";
    const apply = (line: string) => {
      if (!line.trim()) return;
      if (line.length > maxRecordCharacters || final) throw invalid();
      const event: unknown = JSON.parse(line);
      if (!record(event)) throw invalid();
      if (event.type === "start") {
        if (selected || !record(event.deadlines) || !finite(event.deadlines.operation_seconds) || event.deadlines.operation_seconds <= 0) throw invalid();
        const budget = (event.deadlines.operation_seconds + 15) * 1000;
        if (!Number.isSafeInteger(Math.ceil(budget)) || budget > 2_147_483_647) throw invalid();
        selected = identity(event.model_profile);
        clearTimeout(timer); timer = setTimeout(expire, Math.max(0, started + budget - Date.now()));
        options.onModelProfile?.(selected); options.onProgress?.("queued", 0);
      } else if (!selected) throw invalid();
      else if (event.type === "progress") {
        if (!["queued", "generating"].includes(String(event.phase)) || !finite(event.elapsed_seconds)) throw invalid();
        options.onProgress?.(event.phase as InsightPhase, event.elapsed_seconds);
        if (finite(event.received_chars)) options.onTokenProgress?.(event.received_chars);
      } else if (event.type === "delta") {
        if (typeof event.text !== "string" || !finite(event.received_chars)) throw invalid();
        options.onTokenProgress?.(event.received_chars); // Never publish unvalidated model text.
      } else if (event.type === "result") final = validate(event.result, selected);
      else if (event.type === "error") throw new Error("The insight failed before completion. Retry manually.");
      else throw invalid();
    };
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const line of lines) apply(line);
      if (buffer.length > maxRecordCharacters) throw invalid();
      if (done && buffer.trim()) { apply(buffer); buffer = ""; }
      if (final) { if (buffer.trim()) throw invalid(); return final; }
      if (done) throw invalid();
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", externalAbort);
    controller.signal.removeEventListener("abort", onAbort);
    controller.abort();
    if (reader) {
      void reader.cancel().catch(() => undefined);
      try { reader.releaseLock(); } catch { /* Cancelled reads may still be unwinding. */ }
    }
  }
}
