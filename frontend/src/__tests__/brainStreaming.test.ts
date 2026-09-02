import { beforeEach, describe, expect, it, vi } from "vitest";

import { askBrainStream, type BrainAskResponse } from "../api/brain";

const fetchApiMock = vi.fn();
const apiPostMock = vi.fn();

vi.mock("../api/base", () => ({
  fetchApi: (...args: unknown[]) => fetchApiMock(...args),
  api: { post: (...args: unknown[]) => apiPostMock(...args) },
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

const fallback: BrainAskResponse = {
  answer: "Complete fallback",
  citations: [],
  sources: ["journal"],
  error: "llm_unavailable",
};

describe("askBrainStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiPostMock.mockResolvedValue({ data: fallback });
  });

  it("assembles NDJSON deltas and reports progressive updates", async () => {
    fetchApiMock.mockResolvedValue(
      streamedResponse([
        '{"type":"start","citations":[],"sources":["journal"],"llm":true}\n',
        '{"type":"delta","text":"Patterns "}\n{"type":"delta","text":"repeat."}\n',
        '{"type":"done"}\n',
      ]),
    );
    const updates: BrainAskResponse[] = [];

    const result = await askBrainStream("What repeats?", 6, ["journal"], (update) =>
      updates.push({ ...update }),
    );

    expect(result).toEqual({
      answer: "Patterns repeat.",
      citations: [],
      sources: ["journal"],
      llm: true,
    });
    expect(updates.map((update) => update.answer)).toContain("Patterns ");
    expect(updates.at(-1)).toEqual(result);
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it("retries the stable endpoint after a browser transport interruption", async () => {
    fetchApiMock.mockResolvedValue(
      streamedResponse([
        '{"type":"start","citations":[],"sources":["journal"],"llm":true}\n',
        '{"type":"delta","text":"Partial"}\n',
        new Error("connection lost"),
      ]),
    );
    const updates: BrainAskResponse[] = [];

    const result = await askBrainStream("What repeats?", 6, ["journal"], (update) =>
      updates.push({ ...update }),
    );

    expect(result).toEqual(fallback);
    expect(apiPostMock).toHaveBeenCalledWith(
      "/brain/ask",
      { question: "What repeats?", k: 6, sources: ["journal"] },
      { timeout: 180000 },
    );
    expect(updates.at(-1)).toEqual(fallback);
  });
});
