import { beforeEach, describe, expect, it, vi } from "vitest";

import { streamInsight } from "../api/insightLifecycle";
import type { InsightData } from "../api/types";

const fetchApiMock = vi.fn();

vi.mock("../api/base", () => ({
  fetchApi: (...args: unknown[]) => fetchApiMock(...args),
}));

function streamedResponse(chunks: (string | Error)[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          const chunk = chunks[index++];
          if (chunk instanceof Error) throw chunk;
          if (chunk === undefined) return { done: true, value: undefined };
          return { done: false, value: encoder.encode(chunk) };
        },
      }),
    },
  } as unknown as Response;
}

const insight: InsightData = {
  engine: "llm",
  model: "test-model",
  summary: "A validated result.",
  sections: [
    { title: "Evidence", tone: "positive", points: ["Observed"] },
    { title: "Risk", tone: "negative", points: ["Limited"] },
  ],
};

describe("streamInsight", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses lifecycle progress and returns the complete result", async () => {
    fetchApiMock.mockResolvedValue(streamedResponse([
      '{"type":"start","phase":"queued"}\n{"type":"progress","phase":"generating","elapsed_seconds":0}\n',
      '{"type":"delta","text":"{\\"summary\\":","received_chars":12}\n',
      `${JSON.stringify({ type: "result", result: insight })}\n`,
    ]));
    const progress = vi.fn();
    const tokenProgress = vi.fn();
    const fallback = vi.fn();

    await expect(streamInsight("risk", { metrics: {} }, fallback, {
      onProgress: progress,
      onTokenProgress: tokenProgress,
    })).resolves.toEqual(insight);
    expect(progress).toHaveBeenCalledWith("queued", 0);
    expect(progress).toHaveBeenCalledWith("generating", 0);
    expect(tokenProgress).toHaveBeenLastCalledWith(12);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses the stable endpoint after an interrupted or malformed stream", async () => {
    fetchApiMock.mockResolvedValue(streamedResponse([
      '{"type":"start","phase":"queued"}\n',
      new Error("connection lost"),
    ]));
    const fallback = vi.fn().mockResolvedValue(insight);

    await expect(streamInsight("collection", { symbols: ["AAPL"] }, fallback)).resolves.toEqual(insight);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("does not restart a request that the user cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    fetchApiMock.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    const fallback = vi.fn();

    await expect(streamInsight("backtest", {}, fallback, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fallback).not.toHaveBeenCalled();
  });
});
