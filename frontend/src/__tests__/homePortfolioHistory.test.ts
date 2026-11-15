import { describe, expect, it } from "vitest";
import { buildHomeHistory } from "../components/home/homePortfolioHistory";
const NOW = Date.parse("2026-11-15T16:30:00Z");
const point = (date: string, portfolio = 1, benchmark = 1) => ({ date, portfolio, benchmark });
function overlay(equity_curve: unknown[], changes = {}) {
  return { status: "complete", methodology: "current_open_holdings_constant_quantity", base_currency: "USD", benchmark: "SPY", issues: [], degraded_reasons: [], equity_curve, ...changes };
}
describe("Home current-open-holdings history", () => {
  it("uses exactly the last thirty UTC calendar days and independently rebases both lines at the same first date", () => {
    const result = buildHomeHistory(overlay([
      point("2026-10-16", 10, 10), point("2026-11-16", 50, 50),
      point("2026-11-15", 2.2, 3.15), point("2026-10-17", 2, 3), point("2026-11-01", 2.1, 3.1),
    ]), NOW);
    expect(result.status).toBe("complete");
    expect(result.points.map((p) => p.label)).toEqual(["2026-10-17", "2026-11-01", "2026-11-15"]);
    expect(result.points[0].value).toBe(100); expect(result.benchmarkPoints[0].value).toBe(100);
    expect(result.points[2].value).toBeCloseTo(110); expect(result.benchmarkPoints[2].value).toBeCloseTo(105);
    expect(result.start).toBe("2026-10-17"); expect(result.end).toBe("2026-11-15");
  });
  it.each([
    [point("2026-09-01"), point("2026-09-02")], [point("2026-11-15")], [],
  ].map((points) => [points]))("does not substitute older observations or invent a curve", (points) => {
    const result = buildHomeHistory(overlay(points), NOW);
    expect(result.status).toBe("unavailable"); expect(result.points).toEqual([]); expect(result.benchmarkPoints).toEqual([]);
  });
  it("filters both series together, withholds conflicting dates and rejects null, numeric strings and impossible dates", () => {
    const result = buildHomeHistory(overlay([
      point("2026-11-01", 1, 2), point("2026-11-15", 2, 3),
      point("2026-11-03", 1.1, 2.1), point("2026-11-03", 1.2, 2.1),
      { date: "2026-11-04", portfolio: null, benchmark: 2.1 },
      { date: "2026-11-05", portfolio: 1.1, benchmark: "2.1" },
      point("2026-11-06", NaN, 2), point("2026-11-07", 1, 0), point("2026-11-31"),
      point("2026-11-01", 1, 2),
    ]), NOW);
    expect(result.status).toBe("degraded"); expect(result.points.map((p) => p.label)).toEqual(["2026-11-01", "2026-11-15"]);
    expect(result.benchmarkPoints.map((p) => p.label)).toEqual(result.points.map((p) => p.label));
    expect(result.notes.join(" ")).toContain("withheld");
  });
  it("exposes backend FX/price/currency issues without presenting a partial basket", () => {
    const result = buildHomeHistory(overlay([point("2026-11-01"), point("2026-11-15")], {
      status: "partial", issues: [{ code: "instrument_currency_unknown", symbol: "BTC-USD" }, { code: "fx_history_unavailable", symbol: "SAP.DE" }],
    }), NOW);
    expect(result.status).toBe("unavailable"); expect(result.points).toEqual([]);
    expect(result.notes).toEqual(["Instrument currency unknown (BTC-USD)", "Historical FX unavailable (SAP.DE)"]);
  });
  it("keeps degraded-history disclosure with actual endpoint dates", () => {
    const result = buildHomeHistory(overlay([point("2026-11-01"), point("2026-11-05")], { status: "degraded", degraded_reasons: ["latest_past_rate"] }), NOW);
    expect(result.status).toBe("degraded"); expect(result.end).toBe("2026-11-05"); expect(result.notes).toContain("latest past rate");
  });
  it.each([{}, { methodology: "transaction_ledger" }, { status: "complete" }, null])("fails closed when methodology or accounting metadata is missing", (value) => {
    expect(buildHomeHistory(value, NOW).status).toBe("unavailable");
  });
});
