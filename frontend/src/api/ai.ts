import { api } from "./base";
import type {
  AIQueryResult,
} from "../types";

export async function aiQuery(query: string, context: Record<string, any>): Promise<AIQueryResult> {
  // LLM generation exceeds the api client's default 30s timeout — give it room.
  const { data } = await api.post<AIQueryResult>("/ai/query", { query, context }, { timeout: 180_000 });
  return data;
}
