import { api } from "./base";
import { streamModelOperation, type InsightRequestOptions } from "./insightLifecycle";
import type { InsightModelProfile } from "./types";

export type ConvictionCatalyst = {
  title?: string;
  description?: string;
  date?: string;
  expected_date?: string;
  impact?: "bullish" | "bearish" | "neutral" | string;
  confidence?: number;
  source?: string;
  [key: string]: unknown;
};

export type ConvictionResponse = {
  symbol: string;
  market?: string;
  bullish_score?: number;
  bearish_score?: number;
  conviction_score?: number;
  label?: "Bullish" | "Bearish" | "Neutral" | string;
  summary?: string;
  catalysts?: ConvictionCatalyst[];
  upcoming_catalysts?: ConvictionCatalyst[];
  updated_at?: string;
  engine?: string;
  source_count?: number;
  model_profile?: InsightModelProfile | null;
  failure?: { code: string; message: string; retryable: boolean } | null;
  [key: string]: unknown;
};

export async function fetchSecurityConviction(symbol: string): Promise<ConvictionResponse> {
  const normalized = symbol.trim().toUpperCase();
  const { data } = await api.get<ConvictionResponse>(`/stock-picking/conviction/${encodeURIComponent(normalized)}`);
  return data;
}

export async function ingestSecurityConviction(payload: Record<string, unknown>, options: InsightRequestOptions = {}): Promise<ConvictionResponse> {
  return streamModelOperation("/stock-picking/conviction/ingest/stream", payload, (value, profile) => {
    if (profile.requested_profile !== "deep") throw new Error("Filing model identity did not match. Retry manually.");
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid filing report. Retry manually.");
    const result = value as ConvictionResponse;
    if (typeof result.symbol !== "string" || result.symbol !== String(payload.symbol ?? "").trim().toUpperCase()
      || !["llm", "lexical"].includes(result.engine ?? "") || typeof result.summary !== "string" || !Array.isArray(result.catalysts)
      || !Number.isInteger(result.source_count) || result.source_count! < 0) throw new Error("Invalid filing report. Retry manually.");
    if (payload.use_llm !== false && (!result.model_profile || result.model_profile.model !== profile.model
      || result.model_profile.resolved_profile !== profile.resolved_profile || result.model_profile.requested_profile !== "deep")) throw new Error("Filing model identity did not match. Retry manually.");
    return result;
  }, options);
}
