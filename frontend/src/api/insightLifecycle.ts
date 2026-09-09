import { fetchApi } from "./base";
import type { InsightData } from "./types";

export type InsightKind = "backtest" | "collection" | "risk";
export type InsightPhase = "queued" | "generating";

export type InsightRequestOptions = {
  signal?: AbortSignal;
  onProgress?: (phase: InsightPhase, elapsedSeconds: number) => void;
};

type LifecycleEvent =
  | { type: "start"; phase: InsightPhase }
  | { type: "progress"; phase: InsightPhase; elapsed_seconds?: number }
  | { type: "result"; result: InsightData }
  | { type: "error"; error: { code: string; message: string; retryable: boolean } };

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof DOMException && error.name === "AbortError");
}

/** Consume the shared NDJSON lifecycle and retry through the stable endpoint. */
export async function streamInsight(
  kind: InsightKind,
  payload: Record<string, unknown>,
  fallback: () => Promise<InsightData>,
  options: InsightRequestOptions = {},
): Promise<InsightData> {
  try {
    const response = await fetchApi("/ai/insights/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify({ kind, payload }),
      signal: options.signal,
    });
    if (!response.ok) throw new Error(`AI insight stream HTTP ${response.status}`);
    if (!response.body) throw new Error("AI insight stream has no response body");

    let result: InsightData | null = null;
    let buffer = "";
    const decoder = new TextDecoder();
    const reader = response.body.getReader();

    const apply = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as LifecycleEvent;
      if (event.type === "start") options.onProgress?.(event.phase, 0);
      if (event.type === "progress") options.onProgress?.(event.phase, event.elapsed_seconds ?? 0);
      if (event.type === "result") result = event.result;
      if (event.type === "error") throw new Error(event.error.message);
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) apply(line);
      if (done) break;
    }
    if (buffer.trim()) apply(buffer);
    if (!result) throw new Error("AI insight stream ended before completion");
    return result;
  } catch (error) {
    if (isAbort(error, options.signal)) throw error;
    return fallback();
  }
}
