import { beforeEach, describe, expect, it, vi } from "vitest";
import { askBrainStream, type BrainAskResponse } from "../api/brain";
import { brainTechnicalAnswer } from "./fixtures/brainTechnicalContext";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../api/base", () => ({ fetchApi: fetchMock, api: { post: vi.fn() } }));
const symbols = ["AAPL", "BTC-USD"];
function events(result: BrainAskResponse, start = true): Record<string, unknown>[] {
  const { answer, technical_context, citations, sources, ...metadata } = result;
  return [
    { type: "queued", sources, technical_symbols: symbols, deadlines: { operation_seconds: 300 }, ...metadata },
    ...(start ? [{ type: "start", sources, citations, technical_context, llm: true, ...metadata }, { type: "delta", text: answer }] : []),
    { type: "result", result },
  ];
}
function mockStream(records: Record<string, unknown>[]) {
  fetchMock.mockResolvedValue(new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(records.map((event) => JSON.stringify(event)).join("\n") + "\n"));
    controller.close();
  } }), { headers: { "Content-Type": "application/x-ndjson" } }));
}
const ask = () => askBrainStream("What do my dated claims mean today?", 6, ["note"], undefined, { technicalSymbols: symbols });

describe("Brain technical stream contract", () => {
  beforeEach(() => fetchMock.mockReset());
  it.each(["complete", "partial", "unavailable", "skipped"] as const)("accepts backend-produced %s coverage with exact private and per-asset references", async (kind) => {
    const result = brainTechnicalAnswer(kind);
    mockStream(events(result, kind !== "skipped"));
    await expect(ask()).resolves.toEqual(result);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ technical_symbols: symbols, sources: ["note"] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each([
    ["unknown metric", (value: BrainAskResponse) => { value.answer += " [T9.9]"; }],
    ["missing selected asset reference", (value: BrainAskResponse) => { value.answer = "Claim [1] [T1.1]."; }],
    ["missing private reference", (value: BrainAskResponse) => { value.answer = "Claim [T1.1] [T2.1]."; }],
    ["wrong private reference", (value: BrainAskResponse) => { value.answer = "Claim [9] [T1.1] [T2.1]."; }],
    ["substituted symbol", (value: BrainAskResponse) => { value.technical_context!.groups[0].symbol = "SPY"; }],
    ["false coverage", (value: BrainAskResponse) => { value.technical_context!.status = "unavailable"; }],
    ["missing capture", (value: BrainAskResponse) => { delete value.technical_context; }],
  ] as const)("rejects %s without replaying inference", async (_name, mutate) => {
    const value = brainTechnicalAnswer(); mutate(value); mockStream(events(value));
    await expect(ask()).rejects.toThrow("incomplete or invalid");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("rejects a different final snapshot even when both captures are independently valid", async () => {
    const records = events(brainTechnicalAnswer());
    const changed = brainTechnicalAnswer();
    changed.technical_context!.groups[0].snapshot_id = `ts_${"a".repeat(24)}`;
    records[records.length - 1] = { type: "result", result: changed };
    mockStream(records);
    await expect(ask()).rejects.toThrow("incomplete or invalid");
  });
  it("allows harmless object key order changes in the final capture", async () => {
    const records = events(brainTechnicalAnswer());
    const reordered = brainTechnicalAnswer();
    reordered.technical_context = Object.fromEntries(Object.entries(reordered.technical_context!).reverse()) as typeof reordered.technical_context;
    records[records.length - 1] = { type: "result", result: reordered };
    mockStream(records);
    await expect(ask()).resolves.toEqual(reordered);
  });
  it("rejects missing or unrequested queued technical scope", async () => {
    const records = events(brainTechnicalAnswer()); delete records[0].technical_symbols; mockStream(records);
    await expect(ask()).rejects.toThrow();
    mockStream(events(brainTechnicalAnswer()));
    await expect(askBrainStream("AI is a theme", 6, ["note"])).rejects.toThrow();
  });
  it("rejects unavailable metrics even when another measure is usable", async () => {
    const value = brainTechnicalAnswer("partial"); value.answer += " [T2.3]"; mockStream(events(value));
    await expect(ask()).rejects.toThrow();
  });
  it("validates scope before fetching", async () => {
    await expect(askBrainStream("why", 6, ["note"], undefined, { technicalSymbols: ["aapl", "AAPL"] })).rejects.toThrow("unique");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
