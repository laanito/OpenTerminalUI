import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamInsight } from "../api/insightLifecycle";
import type { InsightData } from "../api/types";

const fetchApiMock = vi.hoisted(() => vi.fn());
vi.mock("../api/base", () => ({ fetchApi: fetchApiMock }));
const profile = { requested_profile: "deep", resolved_profile: "deep", model: "deep-model" } as const;
const insight: InsightData = {
  engine: "llm", model: "deep-model", model_profile: profile, summary: "A validated result.",
  sections: [{ title: "Evidence", tone: "positive", points: ["Observed"] }, { title: "Risk", tone: "negative", points: ["Limited"] }],
};
const start = (seconds = 660) => JSON.stringify({ type: "start", phase: "queued", model_profile: profile, deadlines: { operation_seconds: seconds } }) + "\n";
const final = () => JSON.stringify({ type: "result", result: insight }) + "\n";
const encoder = new TextEncoder();
function stream(chunks: (string | Uint8Array)[], close = true) {
  const cancel = vi.fn();
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { source = controller; for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk); if (close) controller.close(); },
    cancel,
  });
  return { response: new Response(body, { headers: { "content-type": "application/x-ndjson" } }), cancel, source };
}

describe("streamInsight", () => {
  beforeEach(() => { fetchApiMock.mockReset(); });
  afterEach(() => vi.useRealTimers());

  it("reports the selected model and token counts but returns only validated final content", async () => {
    fetchApiMock.mockResolvedValue(stream([start(), JSON.stringify({ type: "progress", phase: "generating", elapsed_seconds: 0 }) + "\n",
      JSON.stringify({ type: "delta", text: "unvalidated text", received_chars: 16 }) + "\n", final()]).response);
    const onProgress = vi.fn(), onTokenProgress = vi.fn(), onModelProfile = vi.fn();
    await expect(streamInsight("risk", {}, { onProgress, onTokenProgress, onModelProfile })).resolves.toEqual(insight);
    expect(onProgress.mock.calls).toEqual([["queued", 0], ["generating", 0]]);
    expect(onTokenProgress).toHaveBeenCalledWith(16);
    expect(onModelProfile).toHaveBeenCalledWith(profile);
    expect(fetchApiMock).toHaveBeenCalledOnce();
  });

  it("returns a final result without waiting for the connection to close", async () => {
    const response = stream([start(), final()], false);
    fetchApiMock.mockResolvedValue(response.response);
    await expect(streamInsight("collection", {})).resolves.toEqual(insight);
    expect(response.cancel).toHaveBeenCalledOnce();
  });

  it("handles split UTF-8 and an unterminated final record", async () => {
    const data = encoder.encode(start() + JSON.stringify({ type: "result", result: { ...insight, summary: "Euro € context." } }));
    fetchApiMock.mockResolvedValue(stream(Array.from(data, (byte) => new Uint8Array([byte]))).response);
    await expect(streamInsight("backtest", {})).resolves.toMatchObject({ summary: "Euro € context." });
  });

  it.each([
    ["incomplete", start()],
    ["malformed", start() + "bad JSON\n"],
    ["result before start", final()],
    ["duplicate start", start() + start()],
    ["wrong model", start() + JSON.stringify({ type: "result", result: { ...insight, model: "other" } }) + "\n"],
    ["incomplete sections", start() + JSON.stringify({ type: "result", result: { ...insight, sections: [] } }) + "\n"],
    ["error event", start() + JSON.stringify({ type: "error", error: { message: "provider details" } }) + "\n"],
    ["oversized", start() + "x".repeat(64_001)],
  ])("rejects %s without replaying inference", async (_, body) => {
    fetchApiMock.mockResolvedValue(stream([body]).response);
    await expect(streamInsight("risk", {})).rejects.toThrow();
    expect(fetchApiMock).toHaveBeenCalledOnce();
  });

  it("does not replay an HTTP failure or interrupted stream", async () => {
    fetchApiMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await expect(streamInsight("collection", {})).rejects.toThrow("503");
    expect(fetchApiMock).toHaveBeenCalledOnce();
    const response = stream([start()], false);
    fetchApiMock.mockResolvedValueOnce(response.response);
    const pending = streamInsight("collection", {});
    const checked = expect(pending).rejects.toThrow("connection lost");
    await Promise.resolve();
    response.source.error(new Error("connection lost"));
    await checked;
    expect(fetchApiMock).toHaveBeenCalledTimes(2);
  });

  it("honors longer Deep deadlines without extending them for progress", async () => {
    vi.useFakeTimers();
    const response = stream([start(600)], false);
    fetchApiMock.mockResolvedValue(response.response);
    const pending = streamInsight("risk", {});
    await vi.advanceTimersByTimeAsync(300_001);
    expect(fetchApiMock.mock.calls[0][1].signal.aborted).toBe(false);
    response.source.enqueue(encoder.encode(JSON.stringify({ type: "progress", phase: "generating", elapsed_seconds: 300 }) + "\n"));
    const checked = expect(pending).rejects.toThrow("time limit");
    await vi.advanceTimersByTimeAsync(315_000);
    await checked;
    expect(response.cancel).toHaveBeenCalledOnce();
    expect(fetchApiMock).toHaveBeenCalledOnce();
  });

  it("bounds a stalled fetch before headers", async () => {
    vi.useFakeTimers(); fetchApiMock.mockReturnValue(new Promise(() => undefined));
    const checked = expect(streamInsight("risk", {})).rejects.toThrow("time limit");
    await vi.advanceTimersByTimeAsync(300_001); await checked;
    expect(fetchApiMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("cancels a stalled reader and never starts a pre-cancelled request", async () => {
    const controller = new AbortController();
    const response = stream([start()], false);
    fetchApiMock.mockResolvedValue(response.response);
    const pending = streamInsight("interrogate", { ticker: "AAPL" }, { signal: controller.signal });
    const checked = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve(); controller.abort(); await checked;
    expect(response.cancel).toHaveBeenCalledOnce();
    await expect(streamInsight("briefing", {}, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchApiMock).toHaveBeenCalledOnce();
  });
});
