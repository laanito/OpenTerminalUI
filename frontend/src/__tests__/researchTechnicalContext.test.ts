import { beforeEach, describe, expect, it, vi } from "vitest";
import { validResearchTechnicalEvidence, validResearchTechnicalReferences } from "../api/researchTechnicalContext";
import { streamInsight } from "../api/insightLifecycle";
import { researchInsight } from "./fixtures/researchTechnicalContext";

const fetchApiMock = vi.hoisted(() => vi.fn());
vi.mock("../api/base", () => ({ fetchApi: fetchApiMock }));

describe("instrument research technical evidence", () => {
  beforeEach(() => fetchApiMock.mockReset());
  it.each(["complete", "partial", "unavailable", "zero", "crypto"] as const)("accepts actual backend %s projection", (kind) => {
    const value = researchInsight(kind);
    expect(validResearchTechnicalEvidence(value.technical_context, value.ticker)).toBe(true);
    expect(validResearchTechnicalReferences(value.summary, value.sections, value.technical_context!)).toBe(true);
  });

  it.each([
    ["wrong symbol", (v: any) => { v.symbol = "SPY"; }],
    ["unknown schema", (v: any) => { v.schema_version = 2; }],
    ["bad snapshot ID", (v: any) => { v.snapshot_id = "ts_wrong"; }],
    ["wrong input contract", (v: any) => { v.input_contract = "legacy"; }],
    ["intraday interval", (v: any) => { v.interval = "1h"; }],
    ["pair sampling", (v: any) => { v.sampling = "own_utc_dates_within_pair_window"; }],
    ["raw basis", (v: any) => { v.price_basis = "raw"; }],
    ["verified sessions", (v: any) => { v.session_verification = "verified"; }],
    ["annualized", (v: any) => { v.annualized = true; }],
    ["future window", (v: any) => { v.requested_end_date = "2026-09-26"; }],
    ["wrong freshness", (v: any) => { v.freshness = "stale"; }],
    ["impossible count", (v: any) => { v.available_closes = 181; }],
    ["wrong metric ID", (v: any) => { v.metrics[0].citation_id = "TECH4"; }],
    ["changed formula", (v: any) => { v.metrics[0].formula = "invented"; }],
    ["infinite value", (v: any) => { v.metrics[0].value = Infinity; }],
    ["negative volatility", (v: any) => { v.metrics[2].value = -1; }],
    ["missing dates", (v: any) => { v.metrics[0].observation_dates.pop(); }],
    ["changed observation date", (v: any) => { v.metrics[0].observation_dates[0] = "2026-01-01"; }],
    ["repeated observation ID", (v: any) => { v.metrics[1].observation_id = v.metrics[0].observation_id; }],
    ["wrong warmup", (v: any) => { v.metrics[1].required_closes = 20; }],
    ["wrong unit", (v: any) => { v.metrics[2].unit = "percent"; }],
    ["missing supporting close", (v: any) => { v.supporting_points.pop(); }],
    ["invalid supporting close", (v: any) => { v.supporting_points[0].adjusted_close = 0; }],
    ["wrong status", (v: any) => { v.status = "partial"; }],
  ])("rejects %s", (_, mutate) => {
    const value = researchInsight();
    (mutate as (v: any) => void)(value.technical_context);
    expect(validResearchTechnicalEvidence(value.technical_context, value.ticker)).toBe(false);
  });

  it("rejects an unavailable metric as evidence and missing/unknown references", () => {
    const value = researchInsight("partial");
    const evidence = value.technical_context!;
    expect(validResearchTechnicalReferences("No references", [], evidence)).toBe(false);
    expect(validResearchTechnicalReferences("Missing value [TECH2]", [], evidence)).toBe(false);
    expect(validResearchTechnicalReferences("Unknown [TECH99]", [], evidence)).toBe(false);
    expect(validResearchTechnicalReferences(value.summary, [{ ...value.sections[0], title: "Bad [TECH4]" }], evidence)).toBe(false);
  });

  it("validates the real streamed result against the requested ticker, without replay", async () => {
    const value = researchInsight();
    const body = [
      { type: "start", model_profile: value.model_profile, deadlines: { operation_seconds: 300 } },
      { type: "result", result: value },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n";
    fetchApiMock.mockResolvedValue(new Response(body, { headers: { "content-type": "application/x-ndjson" } }));
    await expect(streamInsight("briefing", { ticker: "aapl" })).resolves.toEqual(value);
    expect(fetchApiMock).toHaveBeenCalledOnce();
    fetchApiMock.mockResolvedValue(new Response(body, { headers: { "content-type": "application/x-ndjson" } }));
    await expect(streamInsight("briefing", { ticker: "SPY" })).rejects.toThrow();
    expect(fetchApiMock).toHaveBeenCalledTimes(2);
  });
});
