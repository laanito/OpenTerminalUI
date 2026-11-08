import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamContextBriefing, validateContextBriefingResult } from "../api/comparisonContextBriefing";
import { filingSelection, makeFilingBriefing, type FilingFixtureMode } from "./fixtures/filingBriefing";
const fetchApi = vi.hoisted(() => vi.fn());
vi.mock("../api/base", () => ({ fetchApi }));
const options = { news: false, macro_regions: [], fundamentals: true };

describe("filing context contract", () => {
  it.each(["complete", "conflict", "truncated", "failed", "empty", "configuration_required", "not_covered", "mixed", "model_failure"] as FilingFixtureMode[])("accepts server-shaped %s evidence without dropping price or scope", (mode) => {
    const result = makeFilingBriefing(mode);
    expect(validateContextBriefingResult(result, filingSelection, result.evidence!.requested)).toBe(result);
  });
  it.each([
    (r: any) => { r.evidence.schema_version = "1"; },
    (r: any) => { r.evidence.requested.fundamentals = false; },
    (r: any) => { r.evidence.caveats.pop(); },
    (r: any) => { r.evidence.always_excluded.push("fundamentals"); },
    (r: any) => { r.evidence.sections[0].assets.reverse(); },
    (r: any) => { r.evidence.sections[0].assets[0].group_citations.F1 = "C1A2F1"; },
    (r: any) => { r.evidence.sections[0].assets[0].group_citations.F8 = "C1A1F8"; },
    (r: any) => { r.evidence.sections[0].assets[0].snapshot.symbol = "MSFT"; },
    (r: any) => { r.evidence.sections[0].assets[0].snapshot.filed_start = "2026-09-02"; },
    (r: any) => { r.evidence.sections[0].assets[0].snapshot.retrieved_at = "2026-10-01T12:00:00"; },
    (r: any) => { r.evidence.sections[0].assets[0].snapshot.historical_availability = "verified"; },
    (r: any) => { r.evidence.sections[0].assets[0].snapshot.revision_order = "latest_is_truth"; },
    (r: any) => { r.evidence.sections[0].assets[0].snapshot.cik = null; },
    (r: any) => { r.evidence.sections[0].assets[0].snapshot.matched_group_count = 9; },
    (r: any) => { r.evidence.sections[0].assets[0].snapshot.groups[0].value = NaN; },
    (r: any) => { r.evidence.sections[0].assets[0].snapshot.groups[0].unit = "EUR"; },
    (r: any) => { r.evidence.sections[0].assets[0].snapshot.groups[0].period_end = "2026-10-01"; },
    (r: any) => { r.evidence.sections[0].assets[0].snapshot.groups[0].disclosures[0].filed_date = "2026-12-01"; },
    (r: any) => { r.evidence.sections[0].assets[0].snapshot.groups[0].disclosures[0].filing_url = "https://sec.gov.attacker.example/filing"; },
    (r: any) => { r.evidence.sections[0].assets[0].snapshot.groups[0].disclosures[0].filing_url = "javascript:alert(1)"; },
    (r: any) => { r.possible_context[0].citation_ids = ["F1", "P1"]; },
    (r: any) => { r.possible_context[0].citation_ids = ["C1A1F1", "P2"]; },
    (r: any) => { r.possible_context[0].citation_ids = ["C1A1", "P1"]; },
    (r: any) => { r.possible_context[0].citation_ids = ["C1A1F8", "P1"]; },
    (r: any) => { r.possible_context = []; },
    (r: any) => { r.limitations[1].citation_ids = ["SCOPE", "C1", "C1A2"]; },
  ])("rejects wrong scope, malformed identities and omitted or misclassified references", (mutate) => {
    const result = makeFilingBriefing(); mutate(result);
    expect(() => validateContextBriefingResult(result, filingSelection, options)).toThrow("incomplete");
  });
  it("withholds conflicted values and requires truncated-group limitations", () => {
    const result: any = makeFilingBriefing("conflict");
    result.evidence.sections[0].assets[0].snapshot.groups[0].value = 0;
    expect(() => validateContextBriefingResult(result, filingSelection, options)).toThrow();
    result.evidence.sections[0].assets[0].snapshot.groups[0].value = null;
    result.possible_context[0].citation_ids = ["P1", "C1A1F1"];
    expect(() => validateContextBriefingResult(result, filingSelection, options)).toThrow();
    const truncated = makeFilingBriefing("truncated");
    for (const item of truncated.limitations) item.citation_ids = item.citation_ids.filter((ref) => ref !== "C1A1F1");
    expect(() => validateContextBriefingResult(truncated, filingSelection, options)).toThrow();
  });
  it("accepts a genuine zero instead of treating it as unavailable", () => {
    const result: any = makeFilingBriefing();
    result.evidence.sections[0].assets[0].snapshot.groups[0].value = 0;
    expect(validateContextBriefingResult(result, filingSelection, options)).toBe(result);
  });
  it("rejects a numerical value when shown filing metadata contradicts itself", () => {
    const result: any = makeFilingBriefing();
    const disclosures = result.evidence.sections[0].assets[0].snapshot.groups[0].disclosures;
    disclosures[1].accession = disclosures[0].accession;
    disclosures[1].filing_url = disclosures[0].filing_url;
    expect(() => validateContextBriefingResult(result, filingSelection, options)).toThrow();
  });
});

describe("filing context transport", () => {
  beforeEach(() => fetchApi.mockReset());
  it("sends an explicit fundamentals-only scope once and validates the final snapshot", async () => {
    const result = makeFilingBriefing();
    fetchApi.mockResolvedValue(new Response([
      { type: "start", deadlines: { evidence_seconds: 45, context_seconds: 40, model_seconds: 240 } },
      { type: "result", result },
    ].map((event) => JSON.stringify(event) + "\n").join(""), { headers: { "content-type": "application/x-ndjson" } }));
    expect(await streamContextBriefing(filingSelection, options)).toEqual(result);
    expect(fetchApi).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchApi.mock.calls[0][1].body).context).toEqual(options);
  });
  it("rejects a non-boolean fundamentals choice before requesting", async () => {
    await expect(streamContextBriefing(filingSelection, { ...options, fundamentals: "true" } as any)).rejects.toThrow();
    expect(fetchApi).not.toHaveBeenCalled();
  });
});
