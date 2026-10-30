import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askBrainStream, type BrainAskResponse } from "../api/brain";

const fetchApiMock = vi.hoisted(() => vi.fn());
const apiPostMock = vi.hoisted(() => vi.fn());
vi.mock("../api/base", () => ({ fetchApi: fetchApiMock, api: { post: apiPostMock } }));
const profile = { requested_profile: "deep", resolved_profile: "deep", model: "deep-model" } as const;
const metadata = { generated_at: "2026-10-29T12:00:00+00:00", llm_provider: "openai-compatible", llm_model: "deep-model", model_profile: profile };
const citation = { n: 1, source: "note", title: "My note", snippet: "A sourced observation.", ref_id: "note-1", score: 0.9 };
const queued = (seconds = 720) => JSON.stringify({ type: "queued", sources: ["note"], deadlines: { operation_seconds: seconds }, ...metadata }) + "\n";
const start = JSON.stringify({ type: "start", sources: ["note"], citations: [citation], llm: true, ...metadata }) + "\n";
const delta = JSON.stringify({ type: "delta", text: "A grounded answer [1]." }) + "\n";
const done = JSON.stringify({ type: "done" }) + "\n";
const encoder = new TextEncoder();
function stream(chunks: (string | Uint8Array)[], close = true) {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    source = controller;
    for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
    if (close) controller.close();
  }, cancel });
  return { response: new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }), source: () => source, cancel };
}

describe("askBrainStream", () => {
  beforeEach(() => { fetchApiMock.mockReset(); apiPostMock.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it("announces identity before retrieval and streams provisional updates until done", async () => {
    fetchApiMock.mockResolvedValue(stream([queued(), start, delta, done]).response);
    const updates: BrainAskResponse[] = [];
    const result = await askBrainStream("What changed?", 6, ["note"], (value) => updates.push(value));
    expect(result).toEqual({ answer: "A grounded answer [1].", citations: [citation], sources: ["note"], llm: true, ...metadata });
    expect(updates.map((value) => value.answer)).toEqual(["", "", "A grounded answer [1].", "A grounded answer [1]."]);
    expect(updates[0].model_profile).toEqual(profile);
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it("replaces provisional text with the server's same-profile completion or degraded result", async () => {
    const result = { answer: "Sources retained after model failure.", citations: [citation], sources: ["note"], error: "timeout", ...metadata };
    // Final record without newline is only complete once its transport closes.
    const response = stream([queued(), start, delta, JSON.stringify({ type: "result", result })]);
    fetchApiMock.mockResolvedValue(response.response);
    await expect(askBrainStream("why", 6, ["note"])).resolves.toEqual(result);
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it("allows a retrieval-only response without a synthesis start", async () => {
    const result = { answer: "The model is disabled; here are your sources.", citations: [citation], sources: ["note"], llm: false, ...metadata };
    fetchApiMock.mockResolvedValue(stream([queued(), JSON.stringify({ type: "result", result }) + "\n"]).response);
    await expect(askBrainStream("why", 6, ["note"])).resolves.toEqual(result);
  });

  it("handles split UTF-8 and returns on done while the connection is still open", async () => {
    const encoded = encoder.encode(queued() + start + JSON.stringify({ type: "delta", text: "Euro € [1]." }) + "\n" + done);
    const response = stream(Array.from(encoded, (byte) => new Uint8Array([byte])), false);
    fetchApiMock.mockResolvedValue(response.response);
    await expect(askBrainStream("why", 6, ["note"])).resolves.toMatchObject({ answer: "Euro € [1]." });
    expect(response.cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ["no completion", queued() + start + delta],
    ["bad JSON", queued() + "bad\n"],
    ["wrong scope", queued() + start.replace('"sources":["note"]', '"sources":["journal"]')],
    ["delta before start", queued() + delta],
    ["done before start", queued() + done],
    ["duplicate queue", queued() + queued()],
    ["wrong model", queued() + start.replace('"llm_model":"deep-model"', '"llm_model":"other"')],
    ["oversized record", queued() + "x".repeat(262_145)],
  ])("rejects %s without replaying inference", async (_, body) => {
    fetchApiMock.mockResolvedValue(stream([body]).response);
    await expect(askBrainStream("why", 6, ["note"])).rejects.toThrow();
    expect(fetchApiMock).toHaveBeenCalledOnce();
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it("propagates transport failure instead of replaying the POST", async () => {
    const response = stream([queued(), start, delta], false);
    fetchApiMock.mockResolvedValue(response.response);
    const pending = askBrainStream("why", 6, ["note"]);
    const checked = expect(pending).rejects.toThrow("connection lost");
    await Promise.resolve(); response.source().error(new Error("connection lost")); await checked;
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it("honors Deep's longer operation budget without extending it for heartbeats", async () => {
    vi.useFakeTimers();
    const response = stream([queued(720)], false); fetchApiMock.mockResolvedValue(response.response);
    const pending = askBrainStream("why", 6, ["note"]);
    await vi.advanceTimersByTimeAsync(300_001);
    expect(fetchApiMock.mock.calls[0][1].signal.aborted).toBe(false);
    response.source().enqueue(encoder.encode('{"type":"heartbeat"}\n'));
    const checked = expect(pending).rejects.toThrow("time limit");
    await vi.advanceTimersByTimeAsync(435_000); await checked;
    expect(response.cancel).toHaveBeenCalledOnce(); expect(apiPostMock).not.toHaveBeenCalled();
  });

  it("bounds stalled response headers", async () => {
    vi.useFakeTimers(); fetchApiMock.mockReturnValue(new Promise(() => undefined));
    const checked = expect(askBrainStream("why", 6, ["note"])).rejects.toThrow("time limit");
    await vi.advanceTimersByTimeAsync(300_001); await checked;
  });

  it("cancels stalled reads and rejects pre-cancelled requests", async () => {
    const controller = new AbortController();
    const response = stream([queued()], false); fetchApiMock.mockResolvedValue(response.response);
    const pending = askBrainStream("why", 6, ["note"], undefined, { signal: controller.signal });
    const checked = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve(); controller.abort(); await checked;
    expect(response.cancel).toHaveBeenCalledOnce();
    await expect(askBrainStream("why", 6, ["note"], undefined, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchApiMock).toHaveBeenCalledOnce(); expect(apiPostMock).not.toHaveBeenCalled();
  });
});
