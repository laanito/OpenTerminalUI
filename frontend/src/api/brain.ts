import { api } from "./base";

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

export async function reindexBrain(): Promise<BrainReindexResult> {
  const { data } = await api.post<BrainReindexResult>("/brain/reindex", {}, SLOW);
  return data;
}

export async function fetchBrainStatus(): Promise<BrainStatus> {
  const { data } = await api.get<BrainStatus>("/brain/status");
  return data;
}
