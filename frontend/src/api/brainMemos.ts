import { api } from "./base";
import type { BrainCitation, BrainSource } from "./brain";
import type { Note } from "./notes";
import type { BrainTechnicalContext } from "./brainTechnical";

export interface BrainMemoSummary {
  id: string;
  title: string;
  question: string;
  answer_preview: string;
  symbol: string | null;
  tags: string[];
  annotation: string;
  pinned: boolean;
  citation_count: number;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

export interface BrainMemo extends BrainMemoSummary {
  answer: string;
  sources: BrainSource[];
  citations: BrainCitation[];
  llm: boolean | null;
  llm_provider: string | null;
  llm_model: string | null;
  technical_context?: BrainTechnicalContext | null;
}

export type BrainMemoCreate = Pick<
  BrainMemo,
  "question" | "answer" | "sources" | "citations" | "generated_at" | "llm" | "llm_provider" | "llm_model" | "technical_context"
>;
export type BrainMemoUpdate = Partial<Pick<BrainMemo, "title" | "tags" | "annotation" | "symbol" | "pinned">>;

export async function listBrainMemos(offset = 0, limit = 25, symbol?: string, pinned?: boolean): Promise<BrainMemoSummary[]> {
  const { data } = await api.get<BrainMemoSummary[]>("/brain/memos", { params: { offset, limit, symbol, pinned } });
  return data;
}

export async function getBrainMemo(id: string): Promise<BrainMemo> {
  const { data } = await api.get<BrainMemo>(`/brain/memos/${encodeURIComponent(id)}`);
  return data;
}

export type CitationEvidenceState = "current" | "changed" | "unavailable" | "unverifiable";

export interface BrainMemoEvidenceStatus {
  status: "current" | "stale" | "unverifiable";
  checked_at: string;
  citations: { n: number; status: CitationEvidenceState }[];
}

export async function getBrainMemoEvidenceStatus(id: string): Promise<BrainMemoEvidenceStatus> {
  const { data } = await api.get<BrainMemoEvidenceStatus>(`/brain/memos/${encodeURIComponent(id)}/evidence-status`);
  return data;
}

export async function createBrainMemo(payload: BrainMemoCreate): Promise<BrainMemo> {
  const { data } = await api.post<BrainMemo>("/brain/memos", payload);
  return data;
}

export async function updateBrainMemo(id: string, payload: BrainMemoUpdate): Promise<BrainMemo> {
  const { data } = await api.patch<BrainMemo>(`/brain/memos/${encodeURIComponent(id)}`, payload);
  return data;
}

export async function deleteBrainMemo(id: string): Promise<void> {
  await api.delete(`/brain/memos/${encodeURIComponent(id)}`);
}

export interface BrainMemoPromotion {
  title: string;
  body: string;
  symbol: string | null;
  tags: string[];
  effective_at: string | null;
}

export async function promoteBrainMemoToNote(id: string, payload: BrainMemoPromotion): Promise<Note> {
  const { data } = await api.post<Note>(`/brain/memos/${encodeURIComponent(id)}/promote-to-note`, payload);
  return data;
}
