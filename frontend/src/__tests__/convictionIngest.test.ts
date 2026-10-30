import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestSecurityConviction } from "../api/conviction";

const fetchApi = vi.hoisted(() => vi.fn());
vi.mock("../api/base", () => ({ fetchApi, api: { get: vi.fn() } }));
const model_profile = { requested_profile: "deep", resolved_profile: "deep", model: "deep-model" };
function response(result: unknown) {
  return new Response([
    { type: "start", phase: "queued", model_profile, deadlines: { operation_seconds: 645 } },
    { type: "result", result },
  ].map((value) => JSON.stringify(value)).join("\n") + "\n", { headers: { "content-type": "application/x-ndjson" } });
}
const report = { symbol: "AAPL", engine: "llm", summary: "A saved filing extraction", source_count: 1, catalysts: [], model_profile };

describe("filing ingest lifecycle", () => {
  beforeEach(() => { fetchApi.mockReset(); });
  it("uses the announced lifecycle for long model calls while preserving the native result shape", async () => {
    fetchApi.mockResolvedValue(response(report));
    const payload = { symbol: " aapl ", documents: [{ text: "Supplied text" }] };
    await expect(ingestSecurityConviction(payload)).resolves.toEqual(report);
    expect(fetchApi.mock.calls[0][0]).toBe("/stock-picking/conviction/ingest/stream");
    expect(JSON.parse(fetchApi.mock.calls[0][1].body)).toEqual(payload);
  });
  it("accepts explicit lexical mode and rejects mismatched model provenance without replay", async () => {
    fetchApi.mockResolvedValueOnce(response({ ...report, engine: "lexical", model_profile: null }));
    await expect(ingestSecurityConviction({ symbol: "AAPL", use_llm: false })).resolves.toMatchObject({ engine: "lexical" });
    fetchApi.mockResolvedValueOnce(response({ ...report, model_profile: { ...model_profile, model: "other" } }));
    await expect(ingestSecurityConviction({ symbol: "AAPL" })).rejects.toThrow("identity");
    expect(fetchApi).toHaveBeenCalledTimes(2);
  });
});
