import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamInsight } from "../api/insightLifecycle";
import { portfolioInsight } from "./fixtures/portfolioTechnicalContext";
import type { InsightData } from "../api/types";
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../api/base", () => ({ fetchApi: fetchMock }));
const scope = { portfolio_id: "p1", technical_symbols: ["AAPL", "BTC-USD"] };
function response(value: InsightData) {
  fetchMock.mockResolvedValue(new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode([
      { type: "start", model_profile: value.model_profile, deadlines: { operation_seconds: 300 } }, { type: "result", result: value },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n")); controller.close();
  } }), { headers: { "content-type": "application/x-ndjson" } }));
}
describe("portfolio technical stream contract", () => {
  beforeEach(() => fetchMock.mockReset());
  it.each(["complete", "partial", "unavailable", "modelFailure"] as const)("accepts server-produced %s coverage", async (kind) => {
    const value = portfolioInsight(kind); response(value);
    await expect(streamInsight("risk", scope)).resolves.toEqual(value);
  });
  it.each([
    ["foreign portfolio", (v: InsightData) => { v.portfolio_technical_context!.portfolio_id = "p2"; }],
    ["wrong scope", (v: InsightData) => { v.portfolio_technical_context!.selected_symbols.reverse(); }],
    ["incomplete asset references", (v: InsightData) => { v.summary = "Only [H1.1]"; }],
    ["unknown reference", (v: InsightData) => { v.summary += " [H9.9]"; }],
    ["wrong coverage", (v: InsightData) => { v.portfolio_technical_context!.total_held_symbols = 1; }],
    ["invalid position", (v: InsightData) => { v.portfolio_technical_context!.positions[0].quantity = -1; }],
    ["missing evidence", (v: InsightData) => { delete v.portfolio_technical_context; }],
  ] as const)("rejects %s without replay", async (_, mutate) => {
    const value = portfolioInsight(); mutate(value); response(value);
    await expect(streamInsight("risk", scope)).rejects.toThrow("incomplete or invalid");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("rejects unrequested companions and unavailable metric references", async () => {
    response(portfolioInsight()); await expect(streamInsight("risk", {})).rejects.toThrow();
    const value = portfolioInsight("partial"); value.summary += " [H2.3]"; response(value);
    await expect(streamInsight("risk", scope)).rejects.toThrow();
  });
});
