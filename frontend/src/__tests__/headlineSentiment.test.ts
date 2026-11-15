import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRetainedHeadline, listHeadlineAssessments, savedHeadlineChoices, streamHeadlineAssessments, validateRetainedHeadline } from "../api/headlineSentiment";
import { makeCapture } from "./fixtures/comparisonCaptures";
import { makeRetainedHeadline } from "./fixtures/headlineSentiment";
const mocks = vi.hoisted(() => ({ get: vi.fn(), fetch: vi.fn() }));
vi.mock("../api/base", () => ({ api: { get: mocks.get }, fetchApi: mocks.fetch }));
const selection = [{ citation_id: "C1G1H1", target_symbol: "AAPL" }];
function stream(rows: unknown = [makeRetainedHeadline()]) {
  return new Response([
    { type: "start", deadlines: { evidence_seconds: 45, model_seconds: 240 } },
    { type: "progress", phase: "saving_capture" }, { type: "result", result: rows },
  ].map((event) => JSON.stringify(event)).join("\n"), { headers: { "Content-Type": "application/x-ndjson" } });
}
beforeEach(() => { vi.clearAllMocks(); });
describe("retained headline assessment contract", () => {
  it("keeps exact original times/JSON, distinguishes cache reuse, and does not hydrate older defaults", () => {
    const row = makeRetainedHeadline(); row.assessments[1].payload.reused_from_cache = true;
    expect(validateRetainedHeadline(row)).toBe(row);
    delete row.assessments[0].payload.generation; delete row.assessments[0].payload.reused_from_cache;
    expect(validateRetainedHeadline(row)).toBe(row);
    expect(row.assessments[0].payload).not.toHaveProperty("generation");
  });
  it.each([
    (r: any) => { r.payload.schema_version = 99; },
    (r: any) => { r.assessments[1].payload.score = Infinity; },
    (r: any) => { r.assessments[1].payload.confidence = 0.5; },
    (r: any) => { r.assessments[1].payload.status = "failed"; r.assessments[1].payload.failure_code = "timeout"; },
    (r: any) => { r.assessments[1].payload.scored_at = "not a date"; },
    (r: any) => { r.payload.origin.citation_ids = ["C1G1H1", "C1G1H1"]; },
    (r: any) => { r.assessments[1].payload.generation.profile.model = "other"; },
  ])("rejects unsupported, inconsistent and malformed provenance", (change) => {
    const row = makeRetainedHeadline(); change(row); expect(() => validateRetainedHeadline(row)).toThrow("Stored records have not been changed");
  });
  it("reads global/source pages and exact snapshot IDs without running a model", async () => {
    const row = makeRetainedHeadline(); const controller = new AbortController();
    mocks.get.mockResolvedValueOnce({ data: [row] }).mockResolvedValueOnce({ data: [row] }).mockResolvedValueOnce({ data: row });
    expect(await listHeadlineAssessments(undefined, 20, controller.signal)).toEqual([row]);
    expect(await listHeadlineAssessments("saved-1")).toEqual([row]);
    expect(await getRetainedHeadline(row.id)).toEqual(row);
    expect(mocks.get.mock.calls.map(([path]) => path)).toEqual(["/news/evidence", "/market-context/briefing-captures/saved-1/sentiment", "/news/evidence/snapshot-1"]);
    expect(mocks.get.mock.calls[0][1]).toEqual({ signal: controller.signal, params: { limit: 20, offset: 20 } });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects a mismatched read ID or source filter", async () => {
    mocks.get.mockResolvedValue({ data: makeRetainedHeadline() });
    await expect(getRetainedHeadline("different")).rejects.toThrow();
    mocks.get.mockResolvedValue({ data: [makeRetainedHeadline()] });
    await expect(listHeadlineAssessments("other-source")).rejects.toThrow();
  });
  it("scores only an explicit selection through the progress endpoint with no text/prompt replacement", async () => {
    const source = makeCapture(true), row = makeRetainedHeadline(source), progress = vi.fn();
    mocks.fetch.mockResolvedValue(stream([row]));
    expect(await streamHeadlineAssessments(source, selection, { onProgress: progress })).toEqual([row]);
    expect(mocks.fetch.mock.calls[0][0]).toBe("/market-context/briefing-captures/saved-1/sentiment/stream");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ headlines: selection });
    expect(progress.mock.calls).toEqual([["queued"], ["saving_capture"]]);
    expect(savedHeadlineChoices(makeCapture())).toEqual([]);
  });
  it.each([
    (r: any) => { r.payload.title = "replacement"; },
    (r: any) => { r.payload.origin.capture_content_hash = "a".repeat(64); },
    (r: any) => { r.payload.origin.citation_ids = ["C1G2H1"]; },
    (r: any) => { r.assessments[1].payload.target_symbol = "SPY"; },
    (r: any) => { r.assessments[0].payload.input_text = "different text"; },
    (r: any) => { r.payload.retrieved_at = "2026-11-15T10:00:00Z"; },
  ])("does not accept substituted saved text/targets or automatically repeat a model call", async (change) => {
    const row = makeRetainedHeadline(); change(row); mocks.fetch.mockResolvedValue(stream([row]));
    await expect(streamHeadlineAssessments(makeCapture(true), selection)).rejects.toThrow("Refresh retained assessments");
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it("retains failed verdicts without a score and accepts one deduplicated observation for several selected references", async () => {
    const source = makeCapture(true); const evidence = (source.content.result as any).evidence;
    evidence.sections[0].groups[0].headlines.push({ ...evidence.sections[0].groups[0].headlines[0], citation_id: "C1G1H2" });
    const row = makeRetainedHeadline(source); row.payload.origin!.citation_ids.push("C1G1H2");
    Object.assign(row.assessments[1].payload, { status: "failed", score: null, label: null, rationale: null, failure_code: "timeout" });
    mocks.fetch.mockResolvedValue(stream([row]));
    expect(await streamHeadlineAssessments(source, [...selection, { citation_id: "C1G1H2", target_symbol: "AAPL" }])).toEqual([row]);
  });
  it.each([[], [...selection, ...selection], [{ citation_id: "C1G1H1", target_symbol: "SPY" }]].map((items) => [items]))("rejects invalid selections before dispatch", async (items) => {
    await expect(streamHeadlineAssessments(makeCapture(true), items)).rejects.toThrow("Choose one to ten");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects duplicate source observations split across two receipts", async () => {
    const source = makeCapture(true); const evidence = (source.content.result as any).evidence;
    evidence.sections[0].groups[0].headlines.push({ ...evidence.sections[0].groups[0].headlines[0], citation_id: "C1G1H2" });
    const first = makeRetainedHeadline(source), second = JSON.parse(JSON.stringify(first));
    second.id = "duplicated"; second.payload.origin.citation_ids = ["C1G1H2"];
    mocks.fetch.mockResolvedValue(stream([first, second]));
    await expect(streamHeadlineAssessments(source, [...selection, { citation_id: "C1G1H2", target_symbol: "AAPL" }])).rejects.toThrow("Refresh retained assessments");
  });
  it("does not retry a stream that ends without a committed receipt", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ type: "start", deadlines: { evidence_seconds: 45, model_seconds: 240 } }) + "\n", { headers: { "Content-Type": "application/x-ndjson" } }));
    await expect(streamHeadlineAssessments(makeCapture(true), selection)).rejects.toThrow("Refresh retained assessments");
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
});
