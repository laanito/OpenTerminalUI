import { beforeEach, describe, expect, it, vi } from "vitest";
import { scoreNewsArticles, fetchStockEmotion } from "../api/sentiment";
import { aiQuery } from "../api/ai";
const fetchApi = vi.hoisted(() => vi.fn());
vi.mock("../api/base", () => ({ fetchApi, api: {} }));
const profile = { requested_profile: "fast", resolved_profile: "fast", model: "fast-model" };
function response(result: unknown, selected = profile) {
  return new Response([
    { type: "start", phase: "queued", model_profile: selected, deadlines: { operation_seconds: 660 } },
    { type: "result", result },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n", { headers: { "Content-Type": "application/x-ndjson" } });
}
describe("Fast task API lifecycles", () => {
  beforeEach(() => { fetchApi.mockReset(); });
  it("preserves sentiment, emotion and query result shapes and Fast identity", async () => {
    const metadata = { model: "fast-model", model_profile: profile };
    fetchApi.mockResolvedValueOnce(response({ engine: "lexical", items: [], ...metadata }));
    await expect(scoreNewsArticles([])).resolves.toMatchObject({ engine: "lexical" });
    expect(fetchApi.mock.calls[0][0]).toBe("/ai/news-sentiment/stream");
    fetchApi.mockResolvedValueOnce(response({ ticker: "AAPL", engine: "fallback", emotion_index: 50, ...metadata }));
    await expect(fetchStockEmotion("AAPL")).resolves.toMatchObject({ model_profile: profile });
    expect(fetchApi.mock.calls[1][0]).toBe("/sentiment/emotion/stream");
    fetchApi.mockResolvedValueOnce(response({ type: "chart_command", data: { url: "/equity/security/AAPL?tab=chart" }, explanation: "Open chart", ...metadata }));
    await expect(aiQuery("show AAPL", {})).resolves.toMatchObject({ type: "chart_command" });
    expect(fetchApi.mock.calls[2][0]).toBe("/ai/query/stream");
  });
  it("rejects a Deep task/model response without rerouting or replaying", async () => {
    fetchApi.mockResolvedValue(response({ engine: "llm", items: [], model: "fast-model", model_profile: { ...profile, requested_profile: "deep" } }));
    await expect(scoreNewsArticles([])).rejects.toThrow();
    expect(fetchApi).toHaveBeenCalledOnce();
  });
});
