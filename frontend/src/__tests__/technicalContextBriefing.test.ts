import { afterEach, describe, expect, it, vi } from "vitest";
import { streamContextBriefing, validateContextBriefingResult } from "../api/comparisonContextBriefing";
import { makeTechnicalBriefing, technicalOptions, technicalSelection } from "./fixtures/technicalBriefing";

const fetchApi = vi.hoisted(() => vi.fn());
vi.mock("../api/base", () => ({ fetchApi }));
const encoder = new TextEncoder();
function stream(result: unknown, closed = true) {
  const cancel = vi.fn();
  return { cancel, response: new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ type: "start", deadlines: { evidence_seconds: 45, context_seconds: 40, model_seconds: 240 } }) + "\n"));
      controller.enqueue(encoder.encode(JSON.stringify({ type: "result", result }) + "\n"));
      if (closed) controller.close();
    }, cancel,
  }), { headers: { "content-type": "application/x-ndjson" } }) };
}
afterEach(() => { fetchApi.mockReset(); vi.restoreAllMocks(); });

describe("technical context transport and validation", () => {
  it.each(["complete", "partial", "unavailable", "mixed"] as const)("accepts real backend %s response shapes with exact selected scope", (kind) => {
    const result = makeTechnicalBriefing(kind);
    const options = kind === "mixed" ? { news: true, macro_regions: ["us"] as const, technical: true } : technicalOptions;
    expect(validateContextBriefingResult(result, technicalSelection, { ...options, macro_regions: [...options.macro_regions] })).toBe(result);
  });

  it.each([
    (r: any) => { r.evidence.requested.technical = false; },
    (r: any) => { r.evidence.requested.technical = "true"; },
    (r: any) => { r.evidence.sections[0].retrieved_at = "2026-10-01T00:00:00Z"; },
    (r: any) => { r.evidence.sections[0].assets[0].symbol = "OTHER"; },
    (r: any) => { r.evidence.sections[0].assets[0].citation_id = "C1A2"; },
    (r: any) => { r.evidence.sections[0].assets[0].input_id = "invalid"; },
    (r: any) => { r.evidence.sections[0].assets[0].feed = "unconfirmed"; },
    (r: any) => { r.evidence.sections[0].assets[0].quote_unit = "EUR"; },
    (r: any) => { r.evidence.sections[0].assets[0].calculation_version = "unknown"; },
    (r: any) => { r.evidence.sections[0].assets[0].price_basis = "raw"; },
    (r: any) => { r.evidence.sections[0].assets[0].sampling = "shared_dates"; },
    (r: any) => { r.evidence.sections[0].assets[0].adjustment_verification = "verified"; },
    (r: any) => { r.evidence.sections[0].assets[0].annualized = true; },
    (r: any) => { r.evidence.sections[0].assets[0].available_closes = 0; },
    (r: any) => { r.evidence.sections[0].assets[0].as_of_date = "2026-08-25"; },
    (r: any) => { r.evidence.sections[0].assets[0].metrics.pop(); },
    (r: any) => { r.evidence.sections[0].assets[0].metrics[0].value = NaN; },
    (r: any) => { r.evidence.sections[0].assets[0].metrics[0].value = null; },
    (r: any) => { r.evidence.sections[0].assets[0].metrics[0].required_closes = 19; },
    (r: any) => { r.evidence.sections[0].assets[0].metrics[0].formula = "new untrusted formula"; },
    (r: any) => { r.evidence.sections[0].assets[0].metrics[0].observation_id = null; },
    (r: any) => { r.evidence.sections[0].assets[0].metrics[0].observation_dates.reverse(); },
    (r: any) => { r.evidence.sections[0].assets[0].metrics[0].start_date = "2026-08-01"; },
    (r: any) => { r.evidence.sections[0].assets[0].metrics[2].value = -1; },
    (r: any) => { r.evidence.sections[0].assets[0].metrics[2].unit = "percent"; },
    (r: any) => { r.evidence.sections[0].assets[0].supporting_points.pop(); },
    (r: any) => { r.evidence.sections[0].assets[0].supporting_points[0].adjusted_close = 0; },
    (r: any) => { r.evidence.sections[0].assets[1].supporting_points[0].date = "2026-08-25"; },
    (r: any) => { r.evidence.sections[0].assets[1].metrics[0].citation_id = "C1A1T1"; },
    (r: any) => { r.possible_context = []; },
    (r: any) => { r.possible_context[0].citation_ids = ["C1A1T1"]; },
    (r: any) => { r.possible_context[0].citation_ids = ["P1", "C1A1"]; },
    (r: any) => { r.possible_context[0].citation_ids = ["P2", "C1A1T1"]; },
    (r: any) => { r.hypotheses[0].citation_ids = ["P1", "C99A1T1"]; },
    (r: any) => { r.limitations = r.limitations.map((item: any) => ({ ...item, citation_ids: item.citation_ids.filter((id: string) => id !== "C1A1") })); },
  ])("rejects mismatched metadata, windows, values or reference obligations", (mutate) => {
    const result = makeTechnicalBriefing(); mutate(result);
    expect(() => validateContextBriefingResult(result, technicalSelection, technicalOptions)).toThrow("incomplete");
  });

  it("accepts valid zero values but rejects using unavailable partial values as context", () => {
    const zero = makeTechnicalBriefing();
    const technical = zero.evidence!.sections[0];
    if (technical.kind !== "technical") throw new Error("Wrong fixture");
    technical.assets[0].metrics[0].value = 0;
    expect(() => validateContextBriefingResult(zero, technicalSelection, technicalOptions)).not.toThrow();
    const result = makeTechnicalBriefing("partial");
    expect(() => validateContextBriefingResult(result, technicalSelection, technicalOptions)).not.toThrow();
    result.possible_context[0].citation_ids = ["P1", "C1A1T2"];
    expect(() => validateContextBriefingResult(result, technicalSelection, technicalOptions)).toThrow();
    const unavailable = makeTechnicalBriefing("unavailable");
    const section = unavailable.evidence!.sections[0];
    if (section.kind !== "technical") throw new Error("Wrong fixture");
    section.assets[0].input_reason = "constructor";
    expect(() => validateContextBriefingResult(unavailable, technicalSelection, technicalOptions)).toThrow();
  });

  it("sends a technical-only selection once and rejects malformed results without replay", async () => {
    const raw = stream(makeTechnicalBriefing()); fetchApi.mockResolvedValueOnce(raw.response);
    const result = await streamContextBriefing(technicalSelection, technicalOptions);
    expect(result.model).toBe("fixture-deep-model");
    expect(JSON.parse(fetchApi.mock.calls[0][1].body)).toEqual({ ...technicalSelection, context: technicalOptions });
    expect(fetchApi.mock.calls[0][0]).toContain("briefing-context/stream");
    const bad = makeTechnicalBriefing();
    bad.possible_context[0].citation_ids = ["P1", "C1A1"];
    fetchApi.mockResolvedValueOnce(stream(bad).response);
    await expect(streamContextBriefing(technicalSelection, technicalOptions)).rejects.toThrow("incomplete");
    expect(fetchApi).toHaveBeenCalledTimes(2);
  });

  it("does not accept technical data for an unselected scope", () => {
    expect(() => validateContextBriefingResult(makeTechnicalBriefing(), technicalSelection, { news: true, macro_regions: [] })).toThrow();
  });
});
