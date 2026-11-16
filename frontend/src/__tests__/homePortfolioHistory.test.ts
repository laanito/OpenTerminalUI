import { describe, expect, it } from "vitest";
import { buildHomeHistory } from "../components/home/homePortfolioHistory";
const NOW = Date.parse("2026-11-16T16:30:00Z");
const point = (date: string, portfolio: number | null = 100, benchmark: number | null = 200) => ({ date, portfolio, benchmark,
  benchmark_as_of: date, net_liquidation_value: 1000, cash_balance: 500, holdings_value: 500, external_flow: 0, price_dates: { A: date } });
function history(equity_curve: unknown[], changes = {}) {
  return { status: "degraded", methodology: "daily_ledger_reconstruction", base_currency: "USD", benchmark: "SPY", issues: [], degraded_reasons: [], equity_curve, ...changes };
}
describe("Home actual ledger history", () => {
  it("keeps thirty daily values despite yesterday's new holding and separates NAV from returns", () => {
    const curve = Array.from({ length: 30 }, (_, i) => ({ ...point(new Date(Date.UTC(2026, 9, 18 + i)).toISOString().slice(0, 10), 100 + i), net_liquidation_value: 1000 + i * 20 }));
    const result = buildHomeHistory(history(curve), NOW);
    expect(result.navPoints).toHaveLength(30); expect(result.points).toHaveLength(30);
    expect(result.navPoints.at(-1)?.value).toBe(1580); expect(result.points.at(-1)?.value).toBe(129);
    expect(result.start).toBe("2026-10-18"); expect(result.end).toBe("2026-11-16");
    expect(result.valuations[0].cash).toBe(500);
  });
  it("does not rebase NAV as performance when deposits change its value", () => {
    const result = buildHomeHistory(history([point("2026-11-15"), { ...point("2026-11-16"), net_liquidation_value: 1500, external_flow: 500 }]), NOW);
    expect(result.navPoints.map(p => p.value)).toEqual([1000, 1500]);
    expect(result.points.map(p => p.value)).toEqual([100, 100]);
  });
  it("preserves portfolio values when a benchmark fails or an index cannot be calculated", () => {
    const missingBenchmark = buildHomeHistory(history([point("2026-11-15", 100, null), point("2026-11-16", 101, null)]), NOW);
    expect(missingBenchmark.navPoints).toHaveLength(2); expect(missingBenchmark.points).toHaveLength(2);
    expect(missingBenchmark.benchmarkPoints).toEqual([]);
    const noIndex = buildHomeHistory(history([point("2026-11-15", null), { ...point("2026-11-16", null), net_liquidation_value: -5 }]), NOW);
    expect(noIndex.navPoints).toHaveLength(2); expect(noIndex.points).toEqual([]);
  });
  it.each([[], [point("2026-11-16")], [point("2025-01-01"), point("2025-01-02")]])("does not invent absent or short history", (...curve) => {
    expect(buildHomeHistory(history(curve), NOW).navPoints).toEqual([]);
  });
  it("rejects gaps, duplicate dates and invalid NAV", () => {
    for (const curve of [[point("2026-11-14"), point("2026-11-16")], [point("2026-11-15"), point("2026-11-15")],
      [point("2026-11-15"), { ...point("2026-11-16"), net_liquidation_value: NaN }]]) {
      expect(buildHomeHistory(history(curve), NOW).status).toBe("unavailable");
    }
  });
  it("keeps benchmark source dates visible and rejects future source quotes", () => {
    const curve = [{ ...point("2026-11-15"), benchmark_as_of: "2026-11-13" }, { ...point("2026-11-16"), benchmark_as_of: "2026-11-13" }];
    expect(buildHomeHistory(history(curve), NOW).benchmarkAsOf).toBe("2026-11-13");
    expect(buildHomeHistory(history(curve.map(p => ({ ...p, benchmark_as_of: "2026-11-17" }))), NOW).benchmarkPoints).toEqual([]);
  });
  it("explains unmatched ledger quantities without showing a partial curve", () => {
    const result = buildHomeHistory(history([point("2026-11-15"), point("2026-11-16")], { status: "partial", issues: [{ code: "ledger_holdings_mismatch", symbol: "A" }] }), NOW);
    expect(result.navPoints).toEqual([]); expect(result.notes).toContain("Ledger quantities do not match current holdings (A)");
  });
  it.each([{}, { methodology: "current_open_holdings_constant_quantity" }, null])("rejects legacy or missing metadata", (value) => {
    expect(buildHomeHistory(value, NOW).status).toBe("unavailable");
  });
});
