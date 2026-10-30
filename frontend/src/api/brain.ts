import { api, fetchApi } from "./base";
import type { InsightModelProfile } from "./types";

export type BrainSource = "note" | "journal" | "portfolio" | "holding" | "transaction";

export interface BrainCitation {
  n: number;
  source: string;
  title: string;
  symbol?: string | null;
  snippet: string;
  score: number;
  effective_at?: string | null;
  recorded_at?: string | null;
  updated_at?: string | null;
  route?: string | null;
  ref_id: string;
  chunk_index?: number | null;
  content_hash?: string | null;
}

export interface BrainAskResponse {
  answer: string;
  citations: BrainCitation[];
  sources: BrainSource[];
  indexed_chunks?: number | null;
  llm?: boolean | null;
  error?: string | null;
  generated_at?: string | null;
  llm_provider?: string | null;
  llm_model?: string | null;
  model_profile?: InsightModelProfile | null;
}

export interface BrainStatus {
  indexed_chunks: number;
  source_counts: Record<BrainSource, number>;
  backend: string;
  embed_model: string;
}

export interface BrainReindexResult {
  indexed: number;
  removed: number;
  total: number;
  backend: string;
  dim: number;
  sources: number;
}

// Reindexing uses the independent embedding path, never a generation profile.
const SLOW = { timeout: 300000 } as const;
const SOURCES: BrainSource[] = ["note", "journal", "portfolio", "holding", "transaction"];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () => new Error("The Brain stream was incomplete or invalid. No answer was kept; retry manually.");
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function validScope(value: unknown, expected: BrainSource[]): value is BrainSource[] {
  return Array.isArray(value) && value.length === expected.length && value.every((source, index) => source === expected[index]);
}
function validCitations(value: unknown, scope: BrainSource[]): value is BrainCitation[] {
  return Array.isArray(value) && value.length <= 20 && new Set(value.map((item) => record(item) ? item.n : null)).size === value.length
    && value.every((item) => record(item) && Number.isInteger(item.n) && Number(item.n) >= 1 && Number(item.n) <= 20
      && scope.includes(item.source as BrainSource) && text(item.title, 10_000) && text(item.snippet, 10_000)
      && text(item.ref_id, 256) && finite(item.score));
}
function identity(value: unknown): InsightModelProfile {
  if (!record(value) || value.requested_profile !== "deep" || !["deep", "fast"].includes(String(value.resolved_profile))
    || !text(value.model, 256) || !value.model.trim()) throw invalid();
  return value as InsightModelProfile;
}
function generation(value: Record<string, unknown>, selected?: InsightModelProfile) {
  const profile = identity(value.model_profile);
  if (value.llm_model !== profile.model || (selected && (selected.model !== profile.model || selected.resolved_profile !== profile.resolved_profile))) throw invalid();
  if (!text(value.generated_at, 64) || !Number.isFinite(Date.parse(value.generated_at))
    || !["local", "openai-compatible"].includes(String(value.llm_provider))) throw invalid();
  return { model_profile: profile, llm_model: profile.model, llm_provider: value.llm_provider as string, generated_at: value.generated_at };
}

export async function askBrain(question: string, k = 6, sources?: BrainSource[], options: { signal?: AbortSignal } = {}): Promise<BrainAskResponse> {
  return askBrainStream(question, k, sources, undefined, options);
}

export async function askBrainStream(
  question: string, k = 6, sources?: BrainSource[], onUpdate?: (response: BrainAskResponse) => void,
  options: { signal?: AbortSignal } = {},
): Promise<BrainAskResponse> {
  if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const scope = sources ? [...new Set(sources)] : [...SOURCES];
  const payload = sources ? { question, k, sources: scope } : { question, k };
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectAbort!: (error: Error) => void;
  let timedOut = false;
  const startedAt = Date.now();
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(timedOut ? new Error("The Brain request exceeded its time limit. No answer was kept; retry manually.") : new DOMException("Cancelled", "AbortError"));
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const externalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  const expire = () => { timedOut = true; controller.abort(); };
  let timer = setTimeout(expire, 300_000);
  let queued = false, synthesizing = false;
  let answer = "";
  let citations: BrainCitation[] = [];
  let metadata: ReturnType<typeof generation> | undefined;
  let complete: BrainAskResponse | undefined;
  const current = (): BrainAskResponse => ({ answer, citations, sources: scope, llm: synthesizing, ...metadata });
  try {
    const response = await Promise.race([fetchApi("/brain/ask/stream", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify(payload), signal: controller.signal,
    }), aborted]);
    if (!response.ok) throw new Error(`Could not start Brain request (HTTP ${response.status}). Retry manually.`);
    if (!response.body || !response.headers.get("content-type")?.includes("application/x-ndjson")) throw invalid();
    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "";
    const apply = (line: string) => {
      if (!line.trim()) return;
      if (line.length > 262_144 || complete) throw invalid();
      const event: unknown = JSON.parse(line);
      if (!record(event)) throw invalid();
      if (event.type === "heartbeat") return; // Heartbeats never reset the deadline.
      if (event.type === "queued") {
        if (queued || !record(event.deadlines) || !finite(event.deadlines.operation_seconds) || event.deadlines.operation_seconds <= 0
          || !validScope(event.sources, scope)) throw invalid();
        const budget = (event.deadlines.operation_seconds + 15) * 1000;
        if (!Number.isSafeInteger(Math.ceil(budget)) || budget > 2_147_483_647) throw invalid();
        metadata = generation(event);
        clearTimeout(timer); timer = setTimeout(expire, Math.max(0, startedAt + budget - Date.now()));
        queued = true;
      } else if (!queued || !metadata) throw invalid();
      else if (event.type === "start") {
        if (synthesizing || !validScope(event.sources, scope) || !validCitations(event.citations, scope) || event.llm !== true) throw invalid();
        metadata = generation(event, metadata.model_profile);
        citations = event.citations; synthesizing = true;
      } else if (event.type === "delta") {
        if (!synthesizing || !text(event.text, 128_000)) throw invalid();
        answer += event.text;
        if (answer.length > 128_000) throw invalid();
      } else if (event.type === "result") {
        const result = event.result;
        if (!record(result) || !text(result.answer, 128_000) || !result.answer.trim()
          || !validScope(result.sources, scope) || !validCitations(result.citations, scope)
          || (result.llm != null && typeof result.llm !== "boolean")
          || (result.error != null && !text(result.error, 128))) throw invalid();
        complete = { ...result, ...generation(result, metadata.model_profile) } as unknown as BrainAskResponse;
      } else if (event.type === "done") {
        if (!synthesizing || !answer.trim()) throw invalid();
        complete = current();
      } else throw invalid();
      onUpdate?.(complete ?? current());
    };
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const line of lines) apply(line);
      if (buffer.length > 262_144) throw invalid();
      if (done && buffer.trim()) { apply(buffer); buffer = ""; }
      if (complete) { if (buffer.trim()) throw invalid(); return complete; }
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

export async function reindexBrain(): Promise<BrainReindexResult> {
  const { data } = await api.post<BrainReindexResult>("/brain/reindex", {}, SLOW);
  return data;
}
export async function fetchBrainStatus(): Promise<BrainStatus> {
  const { data } = await api.get<BrainStatus>("/brain/status");
  return data;
}
