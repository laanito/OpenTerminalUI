import { streamModelOperation, validateFastResult, type InsightRequestOptions } from "./insightLifecycle";
import type {
  AIQueryResult,
} from "../types";

export async function aiQuery(query: string, context: Record<string, any>, options: InsightRequestOptions = {}): Promise<AIQueryResult> {
  return streamModelOperation("/ai/query/stream", { query, context }, (value, profile) => {
    const result = validateFastResult<AIQueryResult>(value, profile);
    if (!["screener_results", "data_table", "chart_command", "text_answer"].includes(result.type)
      || typeof result.explanation !== "string") throw new Error("Invalid query result. Retry manually.");
    return result;
  }, options);
}
