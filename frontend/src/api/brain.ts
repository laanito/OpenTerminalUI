import { api, fetchApi } from "./base";

export type BrainSource = "note" | "journal" | "portfolio" | "holding" | "transaction";

export interface BrainCitation {
  n: number;
  source: string;
  title: string;
  symbol?: string | null;
  snippet: string;
  score: number;
  route?: string | null;
  ref_id: string;
  chunk_index?: number | null;
}

export interface BrainAskResponse {
  answer: string;
  citations: BrainCitation[];
  sources: BrainSource[];
  indexed_chunks?: number | null;
  llm?: boolean | null;
  error?: string | null;
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

type BrainStreamEvent =
  | { type: "start"; citations: BrainCitation[]; sources: BrainSource[]; llm: true }
  | { type: "delta"; text: string }
  | { type: "result"; result: BrainAskResponse }
  | { type: "done" };

// Ask + reindex hit the local LLM / embedder, which can take a while — give them
// a generous timeout rather than the default 30s.
const SLOW = { timeout: 180000 } as const;

export async function askBrain(
  question: string,
  k = 6,
  sources?: BrainSource[],
): Promise<BrainAskResponse> {
  const payload = sources ? { question, k, sources } : { question, k };
  const { data } = await api.post<BrainAskResponse>("/brain/ask", payload, SLOW);
  return data;
}

export async function askBrainStream(
  question: string,
  k = 6,
  sources?: BrainSource[],
  onUpdate?: (response: BrainAskResponse) => void,
): Promise<BrainAskResponse> {
  const payload = sources ? { question, k, sources } : { question, k };
  try {
    const response = await fetchApi("/brain/ask/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Second Brain stream HTTP ${response.status}`);
    if (!response.body) throw new Error("Second Brain stream has no response body");

    let answer = "";
    let citations: BrainCitation[] = [];
    let activeSources = sources ?? [];
    let llm: boolean | null = null;
    let complete: BrainAskResponse | null = null;
    let buffer = "";
    const decoder = new TextDecoder();
    const reader = response.body.getReader();

    const applyEvent = (event: BrainStreamEvent) => {
      if (event.type === "start") {
        citations = event.citations;
        activeSources = event.sources;
        llm = event.llm;
      } else if (event.type === "delta") {
        answer += event.text;
      } else if (event.type === "result") {
        complete = event.result;
      } else if (event.type === "done") {
        complete = { answer, citations, sources: activeSources, llm };
      }
      if (event.type !== "done") {
        onUpdate?.(complete ?? { answer, citations, sources: activeSources, llm });
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (line.trim()) applyEvent(JSON.parse(line) as BrainStreamEvent);
      }
      if (done) break;
    }
    if (buffer.trim()) applyEvent(JSON.parse(buffer) as BrainStreamEvent);
    if (!complete) throw new Error("Second Brain stream ended before completion");
    onUpdate?.(complete);
    return complete;
  } catch {
    // A proxy/browser/provider can interrupt a stream. Retry through the stable
    // non-streaming contract so the user still receives a complete honest result.
    const fallback = await askBrain(question, k, sources);
    onUpdate?.(fallback);
    return fallback;
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
