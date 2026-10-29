import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { streamComparisonBriefing, validateBriefingResult } from "../api/comparisonBriefing";
import { briefingSelection, makeBriefing } from "./fixtures/comparisonBriefing";

const fetchApiMock = vi.hoisted(() => vi.fn());
vi.mock("../api/base", () => ({ fetchApi: fetchApiMock }));
const start = JSON.stringify({ type: "start", phase: "queued", deadlines: { evidence_seconds: 45, model_seconds: 240 } }) + "\n";
const final = () => JSON.stringify({ type: "result", result: makeBriefing() });
const encoder = new TextEncoder();

function stream(chunks: (string | Uint8Array)[], close = true) {
  const cancel = vi.fn();
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      source = controller;
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      if (close) controller.close();
    }, cancel,
  });
  return { response: new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }), cancel, source };
}

describe("comparison briefing transport", () => {
  beforeEach(() => { fetchApiMock.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it("handles split UTF-8 chunks, multiple records and a final record without a newline", async () => {
    const result = makeBriefing();
    result.observations[0].text += " Euro € context.";
    const encoded = encoder.encode(start + JSON.stringify({ type: "progress", phase: "checking_model" }) + "\n" + JSON.stringify({ type: "result", result }));
    const chunks = Array.from({ length: Math.ceil(encoded.length / 7) }, (_, i) => encoded.slice(i * 7, i * 7 + 7));
    fetchApiMock.mockResolvedValue(stream(chunks).response);
    const onProgress = vi.fn();
    await expect(streamComparisonBriefing(briefingSelection, { onProgress })).resolves.toEqual(result);
    expect(onProgress.mock.calls).toEqual([["queued"], ["checking_model"]]);
    expect(fetchApiMock).toHaveBeenCalledOnce();
    const [path, request] = fetchApiMock.mock.calls[0];
    expect(path).toBe("/market-context/briefing/stream");
    expect(JSON.parse(request.body)).toEqual(briefingSelection);
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns a valid final result without waiting for a stalled connection to close", async () => {
    const response = stream([start, final() + "\n"], false);
    fetchApiMock.mockResolvedValue(response.response);
    await expect(streamComparisonBriefing(briefingSelection)).resolves.toEqual(makeBriefing());
    expect(response.cancel).toHaveBeenCalledOnce();
  });

  it("normalizes and deduplicates the request without accepting a different result target", async () => {
    fetchApiMock.mockResolvedValue(stream([start, final() + "\n"]).response);
    await streamComparisonBriefing({ anchor: " aapl ", comparisons: ["spy", "SPY"], period: "1M" });
    expect(JSON.parse(fetchApiMock.mock.calls[0][1].body)).toEqual(briefingSelection);
  });

  it.each([
    { anchor: "bad symbol", comparisons: ["SPY"], period: "1M" as const },
    { anchor: "AAPL", comparisons: ["AAPL"], period: "1M" as const },
    { anchor: "AAPL", comparisons: [], period: "1M" as const },
  ])("rejects invalid selections before starting a request", async (selection) => {
    await expect(streamComparisonBriefing(selection)).rejects.toThrow("valid comparison");
    expect(fetchApiMock).not.toHaveBeenCalled();
  });

  it.each([
    [start], [start, '{"type":"result","result":'],
    [start, '{"type":"delta","text":"unchecked model prose"}\n'],
    [start, '{"type":"progress","phase":"invented"}\n'],
    [start, start], [final() + "\n"],
    [start, '{"type":"error","error":{"message":"unsafe raw provider detail"}}\n'],
    [start, "x".repeat(256_001)],
  ])("fails incomplete/malformed streams without automatically replaying inference", async (...chunks) => {
    fetchApiMock.mockResolvedValue(stream(chunks as string[]).response);
    await expect(streamComparisonBriefing(briefingSelection)).rejects.toThrow();
    expect(fetchApiMock).toHaveBeenCalledOnce();
  });

  it("does not expose raw terminal error text", async () => {
    fetchApiMock.mockResolvedValue(stream([start, '{"type":"error","error":{"message":"unsafe-provider-secret"}}\n']).response);
    await expect(streamComparisonBriefing(briefingSelection)).rejects.not.toThrow("unsafe-provider-secret");
  });

  it.each([401, 500])("rejects HTTP %s without replaying the request", async (status) => {
    fetchApiMock.mockResolvedValue(new Response("failed", { status }));
    await expect(streamComparisonBriefing(briefingSelection)).rejects.toThrow(`HTTP ${status}`);
    expect(fetchApiMock).toHaveBeenCalledOnce();
  });

  it("rejects a successful HTML response rather than treating 200 as completion", async () => {
    fetchApiMock.mockResolvedValue(new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } }));
    await expect(streamComparisonBriefing(briefingSelection)).rejects.toThrow("incomplete");
  });

  it("rejects missing or unusable deadline budgets", async () => {
    fetchApiMock.mockResolvedValue(stream(['{"type":"start","deadlines":{"evidence_seconds":45,"model_seconds":-1}}\n']).response);
    await expect(streamComparisonBriefing(briefingSelection)).rejects.toThrow("incomplete");
  });

  it("propagates user cancellation and cancels a reader even when it is stalled", async () => {
    const response = stream([start], false);
    fetchApiMock.mockResolvedValue(response.response);
    const controller = new AbortController();
    const result = streamComparisonBriefing(briefingSelection, { signal: controller.signal, onProgress: () => controller.abort() });
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchApiMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(response.cancel).toHaveBeenCalledOnce();
  });

  it("does not start an already cancelled request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(streamComparisonBriefing(briefingSelection, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchApiMock).not.toHaveBeenCalled();
  });

  it("uses server budgets and does not reset them when progress arrives", async () => {
    vi.useFakeTimers();
    const response = stream([JSON.stringify({ type: "start", deadlines: { evidence_seconds: 1, model_seconds: 1 } }) + "\n"], false);
    fetchApiMock.mockResolvedValue(response.response);
    const result = streamComparisonBriefing(briefingSelection);
    const checked = expect(result).rejects.toThrow("time limit");
    await vi.advanceTimersByTimeAsync(10_000);
    response.source.enqueue(encoder.encode('{"type":"progress","phase":"generating"}\n'));
    await vi.advanceTimersByTimeAsync(7_001);
    await checked;
    expect(response.cancel).toHaveBeenCalledOnce();
    expect(fetchApiMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("allows a configured server deadline longer than the default browser budget", async () => {
    vi.useFakeTimers();
    const response = stream([JSON.stringify({ type: "start", deadlines: { evidence_seconds: 45, model_seconds: 400 } }) + "\n"], false);
    fetchApiMock.mockResolvedValue(response.response);
    const result = streamComparisonBriefing(briefingSelection);
    await vi.advanceTimersByTimeAsync(300_001);
    expect(fetchApiMock.mock.calls[0][1].signal.aborted).toBe(false);
    response.source.enqueue(encoder.encode(final() + "\n"));
    await expect(result).resolves.toEqual(makeBriefing());
  });

  it("bounds a fetch that never produces response headers", async () => {
    vi.useFakeTimers();
    fetchApiMock.mockReturnValue(new Promise(() => undefined));
    const checked = expect(streamComparisonBriefing(briefingSelection)).rejects.toThrow("time limit");
    await vi.advanceTimersByTimeAsync(300_001);
    await checked;
    expect(fetchApiMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
});

describe("briefing response validation", () => {
  it("accepts additive profile identity and rejects a mismatched model or unknown profile", () => {
    const value = makeBriefing();
    value.model_profile = { requested_profile: "deep", resolved_profile: "deep", model: value.model! };
    expect(validateBriefingResult(value, briefingSelection).model_profile).toEqual(value.model_profile);
    value.model_profile.model = "different-model";
    expect(() => validateBriefingResult(value, briefingSelection)).toThrow();
    value.model_profile.model = value.model!;
    Object.assign(value.model_profile, { resolved_profile: "automatic" });
    expect(() => validateBriefingResult(value, briefingSelection)).toThrow();
  });
  it("accepts a complete result and a typed unavailable result retaining evidence", () => {
    expect(validateBriefingResult(makeBriefing(), briefingSelection).status).toBe("complete");
    const value = makeBriefing();
    value.status = "unavailable"; value.engine = "unavailable";
    value.observations = []; value.limitations = []; value.unknowns = [];
    value.failure = { code: "disabled", message: "Model synthesis is disabled.", retryable: false };
    expect(validateBriefingResult(value, briefingSelection).evidence).toEqual(value.evidence);
  });

  it.each([
    (r: any) => { r.evidence.anchor = "MSFT"; },
    (r: any) => { r.evidence.period = "3M"; },
    (r: any) => { r.evidence.comparisons[0].comparison.symbol = "QQQ"; },
    (r: any) => { r.evidence.schema_version = "2"; },
    (r: any) => { r.evidence.not_included = []; },
    (r: any) => { r.evidence.comparisons[0].returns.relative_return_pp = NaN; },
    (r: any) => { r.evidence.comparisons[0].returns.start_date = "2026-02-31"; },
    (r: any) => { r.observations[0].citation_ids = ["P6"]; },
    (r: any) => { r.observations[0].citation_ids = ["SCOPE"]; },
    (r: any) => { r.limitations[0].citation_ids = ["SCOPE"]; },
    (r: any) => { r.unknowns[0].citation_ids = ["P1"]; },
    (r: any) => { r.observations = []; },
    (r: any) => { r.status = "unavailable"; },
  ])("rejects malformed envelopes, wrong targets and unresolved citations", (mutate) => {
    const result = makeBriefing(); mutate(result);
    expect(() => validateBriefingResult(result, briefingSelection)).toThrow("incomplete");
  });
});
