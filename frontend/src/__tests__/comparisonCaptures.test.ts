import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteComparisonCapture, getComparisonCapture, listComparisonCaptures, streamComparisonCapture, validateComparisonCapture, streamCaptureFollowup } from "../api/comparisonCaptures";
import { streamComparisonBriefing } from "../api/comparisonBriefing";
import { makeCapture, makeCaptureFollowup, captureSummary } from "./fixtures/comparisonCaptures";
import { briefingSelection } from "./fixtures/comparisonBriefing";
const mocks = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn(), fetch: vi.fn() }));
vi.mock("../api/base", () => ({ api: { get: mocks.get, delete: mocks.delete }, fetchApi: mocks.fetch }));
function response(saved = makeCapture(), phase = "saving_capture") {
  return new Response([
    { type: "start", deadlines: { evidence_seconds: 45, context_seconds: 40, model_seconds: 240 } },
    { type: "progress", phase }, { type: "result", result: saved },
  ].map((event) => JSON.stringify(event)).join("\n"), { headers: { "Content-Type": "application/x-ndjson" } });
}

describe("saved comparison capture contract", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each([false, true])("validates original %s contents without adding defaults", (context) => {
    const value = makeCapture(context);
    expect(validateComparisonCapture(value)).toBe(value);
  });
  it.each([
    (value: any) => { value.content.schema_version = 99; },
    (value: any) => { value.content.selection.anchor = "MSFT"; },
    (value: any) => { value.status = "unavailable"; },
    (value: any) => { value.content.result.observations[0].citation_ids = ["P6"]; },
    (value: any) => { value.content.selection.context = { news: true, macro_regions: [] }; },
  ])("rejects unsupported/mismatched saved evidence without fetching sources", (change) => {
    const value = makeCapture(); change(value);
    expect(() => validateComparisonCapture(value)).toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("lists, reopens and deletes only through capture endpoints", async () => {
    const value = makeCapture();
    mocks.get.mockResolvedValueOnce({ data: [captureSummary(value)] }).mockResolvedValueOnce({ data: value });
    expect(await listComparisonCaptures()).toEqual([captureSummary(value)]);
    expect(await getComparisonCapture(value.id)).toEqual(value);
    await deleteComparisonCapture(value.id);
    expect(mocks.get.mock.calls.map(([path]) => path)).toEqual(["/market-context/briefing-captures", "/market-context/briefing-captures/saved-1"]);
    expect(mocks.delete).toHaveBeenCalledWith("/market-context/briefing-captures/saved-1", { signal: undefined });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("streams a saved result, forwards save progress and accepts bounded retained inputs larger than ephemeral results", async () => {
    const value = makeCapture(); value.content.generation.attempts[0].body.large = "x".repeat(600000);
    mocks.fetch.mockResolvedValue(response(value));
    const progress = vi.fn();
    expect(await streamComparisonCapture(briefingSelection, { news: false, macro_regions: [] }, { onProgress: progress })).toEqual(value);
    expect(progress.mock.calls).toEqual([["queued"], ["saving_capture"]]);
    expect(mocks.fetch.mock.calls[0][0]).toBe("/market-context/briefing-captures/stream");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ ...briefingSelection, context: null });
  });
  it("keeps capture progress invalid for the existing ephemeral contract", async () => {
    mocks.fetch.mockResolvedValue(response());
    await expect(streamComparisonBriefing(briefingSelection)).rejects.toThrow();
  });
  it("requires a final committed record and never silently retries an interrupted save", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ type: "start", deadlines: { evidence_seconds: 45, model_seconds: 240 } }) + "\n",
      { headers: { "Content-Type": "application/x-ndjson" } }));
    await expect(streamComparisonCapture(briefingSelection, { news: false, macro_regions: [] })).rejects.toThrow("Refresh saved briefings");
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it("reports a known size rejection as unsaved rather than an ambiguous acknowledgement", async () => {
    mocks.fetch.mockResolvedValue(new Response([
      { type: "start", deadlines: { evidence_seconds: 45, model_seconds: 240 } },
      { type: "error", error: { code: "capture_too_large", message: "ignored raw server text" } },
    ].map((event) => JSON.stringify(event)).join("\n"), { headers: { "Content-Type": "application/x-ndjson" } }));
    await expect(streamComparisonCapture(briefingSelection, { news: false, macro_regions: [] })).rejects.toThrow("Nothing was saved");
  });

});

describe("linked saved run contract", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each(["rerun", "refresh"] as const)("explicit %s selects the owned source without resending inputs", async (kind) => {
    const source = makeCapture(); const child = makeCaptureFollowup(source, kind);
    mocks.fetch.mockResolvedValue(response(child));
    expect(await streamCaptureFollowup(source, kind)).toEqual(child);
    expect(mocks.fetch.mock.calls[0][0]).toBe(`/market-context/briefing-captures/saved-1/${kind}/stream`);
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({});
    expect(source.content.generation.profile.model).not.toBe("current-deep");
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it.each([
    (child: ReturnType<typeof makeCapture>) => { child.lineage!.parent_id = "other"; },
    (child: ReturnType<typeof makeCapture>) => { child.lineage!.parent_content_hash = "a".repeat(64); },
    (child: ReturnType<typeof makeCapture>) => { child.content.generation.attempts[0].body.temperature = 0.9; },
    (child: ReturnType<typeof makeCapture>) => { child.content.result.evidence!.packet_id = "silently-refetched"; },
    (child: ReturnType<typeof makeCapture>) => { child.content.generation.attempts.push(child.content.generation.attempts[0]); },
  ])("rejects altered provenance/frozen inputs without automatically retrying", async (change) => {
    const source = makeCapture(); const child = makeCaptureFollowup(source); change(child);
    mocks.fetch.mockResolvedValue(response(child));
    await expect(streamCaptureFollowup(source, "rerun")).rejects.toThrow("source run is unchanged");
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
});
