import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamContextBriefing, validateContextBriefingResult, safeContextUrl, type BriefingContextOptions } from "../api/comparisonContextBriefing";
import { briefingSelection, makeContextBriefing } from "./fixtures/comparisonBriefing";

const fetchApi = vi.hoisted(() => vi.fn());
vi.mock("../api/base", () => ({ fetchApi }));
const context: BriefingContextOptions = { news: true, macro_regions: ["us", "euro_area"] };
const encoder = new TextEncoder();
const start = { type: "start", deadlines: { evidence_seconds: 45, context_seconds: 40, model_seconds: 240 } };
function response(events: unknown[], close = true) {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  return { response: new Response(new ReadableStream<Uint8Array>({
    start(controller) { source = controller; for (const event of events) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); if (close) controller.close(); }, cancel,
  }), { headers: { "content-type": "application/x-ndjson" } }), get source() { return source; }, cancel };
}

describe("context briefing validation", () => {
  it("accepts context-anchored hypotheses and rejects missing pair links or section-only references", () => {
    const result = makeContextBriefing(context);
    const refs = result.possible_context[0].citation_ids;
    result.hypotheses[0].citation_ids = refs;
    expect(validateContextBriefingResult(result, briefingSelection, context)).toBe(result);
    result.hypotheses[0].citation_ids = refs.filter((ref) => ref !== "P1");
    expect(() => validateContextBriefingResult(result, briefingSelection, context)).toThrow();
    result.hypotheses[0].citation_ids = ["P1", "C1"];
    expect(() => validateContextBriefingResult(result, briefingSelection, context)).toThrow();
  });
  it("accepts exact source scopes and available/failed model snapshots", () => {
    for (const options of [context, { news: true, macro_regions: [] }, { news: false, macro_regions: ["euro_area"] }] as BriefingContextOptions[]) {
      const result = makeContextBriefing(options);
      expect(validateContextBriefingResult(result, briefingSelection, options)).toBe(result);
      result.status = "unavailable"; result.engine = "unavailable";
      result.observations = []; result.hypotheses = []; result.possible_context = []; result.limitations = []; result.unknowns = [];
      result.failure = { code: "disabled", message: "Synthesis disabled.", retryable: false };
      expect(validateContextBriefingResult(result, briefingSelection, options).evidence).toBe(result.evidence);
    }
  });

  it.each([
    (r: any) => { r.evidence.price.anchor = "MSFT"; },
    (r: any) => { r.evidence.requested.news = false; },
    (r: any) => { r.evidence.requested.macro_regions = ["us"]; },
    (r: any) => { r.evidence.sections.reverse(); },
    (r: any) => { r.evidence.sections.pop(); },
    (r: any) => { r.evidence.caveats = []; },
    (r: any) => { r.evidence.always_excluded = []; },
    (r: any) => { r.evidence.packet_id = "not-a-hash"; },
    (r: any) => { r.evidence.sections[0].start_date = "2026-09-21"; },
    (r: any) => { r.evidence.sections[0].pair_citation_id = "P2"; },
    (r: any) => { r.evidence.sections[0].status = "no_price_window"; },
    (r: any) => { r.evidence.sections[0].groups[0].symbol = "QQQ"; },
    (r: any) => { r.evidence.sections[0].groups[0].headlines[0].url = "javascript:alert(1)"; },
    (r: any) => { r.evidence.sections[0].groups[0].headlines[0].url = "https://secret:password@example.com"; },
    (r: any) => { r.evidence.sections[0].groups[0].headlines[0].published_at = "2026-10-21T00:00:00Z"; },
    (r: any) => { r.evidence.sections[0].groups[0].headlines[0].published_at = "2026-10-01T00:00:00"; },
    (r: any) => { r.evidence.sections[0].groups[0].headlines[0].citation_id = "C1G2H1"; },
    (r: any) => { r.evidence.sections[0].groups[0].returned_headline_count = 0; },
    (r: any) => { r.evidence.sections[0].groups[0].matched_count = 20; },
    (r: any) => { r.evidence.sections[1].vintage_basis = "historical"; },
    (r: any) => { r.evidence.sections[1].realtime_date = "2026-10-19"; },
    (r: any) => { r.evidence.sections[1].series.pop(); },
    (r: any) => { r.evidence.sections[1].series[0].source = "ecb"; },
    (r: any) => { r.evidence.sections[1].series[0].observations[0].value = NaN; },
    (r: any) => { r.evidence.sections[1].series[0].observations[0].reference_date = "2026-08-01"; },
    (r: any) => { r.evidence.sections[1].series[0].observations.push(r.evidence.sections[1].series[0].observations[0]); },
    (r: any) => { r.possible_context[0].citation_ids = ["C1G1H1"]; },
    (r: any) => { r.possible_context[0].citation_ids = ["P1", "C1"]; },
    (r: any) => { r.possible_context[0].citation_ids = ["P1", "C18S3"]; },
    (r: any) => { r.observations[0].citation_ids = ["C1G1H1"]; },
    (r: any) => { r.limitations.pop(); },
    (r: any) => { r.limitations[0].citation_ids = ["SCOPE"]; },
    (r: any) => { r.unknowns[0].citation_ids = ["P1"]; },
    (r: any) => { r.possible_context[0].citation_ids = ["P1", "C1G1H1", "C1G1H1"]; },
  ])("rejects wrong selection, malformed sources and unresolved/misclassified citations", (mutate) => {
    const result = makeContextBriefing(); mutate(result);
    expect(() => validateContextBriefingResult(result, briefingSelection, context)).toThrow("incomplete");
  });

  it.each(["javascript:alert(1)", "data:text/html,unsafe", "file:///etc/passwd", "https://user:secret@example.com", "bad-url"])("rejects unsafe links: %s", (url) => {
    expect(safeContextUrl(url)).toBeNull();
  });

  it("accepts a selected missing-key source without treating failure as empty or losing prices", () => {
    const options: BriefingContextOptions = { news: false, macro_regions: ["us"] };
    const result = makeContextBriefing(options);
    const section = result.evidence!.sections[0];
    section.status = "unavailable"; section.reason = "missing_api_key";
    if (section.kind === "macro") section.series = [];
    result.possible_context = [];
    result.limitations[1].citation_ids = ["SCOPE", "C1"];
    expect(validateContextBriefingResult(result, briefingSelection, options).observations).toHaveLength(1);
    result.possible_context = [{ text: "An unavailable series cannot become possible context.", citation_ids: ["P1", "C1S1"] }];
    expect(() => validateContextBriefingResult(result, briefingSelection, options)).toThrow();
  });

  it.each(["partial", "empty"] as const)("accepts %s headline coverage only with explicit subsource disclosure", (status) => {
    const options: BriefingContextOptions = { news: true, macro_regions: [] };
    const result = makeContextBriefing(options);
    const section = result.evidence!.sections[0];
    if (section.kind !== "headlines") throw new Error("Wrong fixture");
    section.status = status;
    for (const group of status === "empty" ? section.groups : section.groups.slice(1)) {
      group.status = status === "empty" ? "no_matches" : "feed_error";
      group.headlines = []; group.examined_count = 0; group.matched_count = 0; group.returned_headline_count = 0;
      result.limitations[1].citation_ids.push(group.citation_id);
    }
    if (status === "empty") result.possible_context = [];
    expect(validateContextBriefingResult(result, briefingSelection, options).evidence!.sections[0].status).toBe(status);
    result.limitations[1].citation_ids = result.limitations[1].citation_ids.filter((ref) => ref !== "C1G2");
    expect(() => validateContextBriefingResult(result, briefingSelection, options)).toThrow();
  });

  it("accepts a no-price-window packet without fabricating a context date", () => {
    const options: BriefingContextOptions = { news: false, macro_regions: ["us"] };
    const result = makeContextBriefing(options);
    const section = result.evidence!.sections[0];
    const price = result.evidence!.price;
    price.status = "unavailable"; price.comparisons[0].status = "unavailable";
    price.comparisons[0].returns = null; price.comparisons[0].reason = "provider_error";
    section.status = "no_price_window"; section.reason = "no_price_window";
    section.start_date = null; section.end_date = null; section.retrieved_at = null;
    if (section.kind === "macro") { section.series = []; section.realtime_date = null; }
    result.status = "unavailable"; result.engine = "unavailable";
    result.observations = []; result.hypotheses = []; result.possible_context = []; result.limitations = []; result.unknowns = [];
    result.failure = { code: "no_evidence", message: "No usable price comparison.", retryable: false };
    expect(validateContextBriefingResult(result, briefingSelection, options).evidence).toBe(result.evidence);
  });
});

describe("context briefing transport", () => {
  beforeEach(() => fetchApi.mockReset());
  afterEach(() => vi.useRealTimers());

  it("requests only explicit sources and handles the collection phase", async () => {
    const result = makeContextBriefing();
    fetchApi.mockResolvedValue(response([start, { type: "progress", phase: "collecting_context" }, { type: "result", result }]).response);
    const onProgress = vi.fn();
    expect(await streamContextBriefing(briefingSelection, context, { onProgress })).toEqual(result);
    expect(onProgress.mock.calls).toEqual([["queued"], ["collecting_context"]]);
    expect(fetchApi).toHaveBeenCalledOnce();
    expect(fetchApi.mock.calls[0][0]).toBe("/market-context/briefing-context/stream");
    expect(JSON.parse(fetchApi.mock.calls[0][1].body)).toEqual({ ...briefingSelection, context });
  });

  it("rejects absent context budget or an interrupted stream without replay", async () => {
    for (const events of [[{ type: "start", deadlines: { evidence_seconds: 45, model_seconds: 240 } }], [start], [start, { type: "delta", text: "unvalidated" }]]) {
      fetchApi.mockResolvedValue(response(events).response);
      await expect(streamContextBriefing(briefingSelection, context)).rejects.toThrow();
    }
    expect(fetchApi).toHaveBeenCalledTimes(3);
  });

  it("adds the context budget to the price/model deadline without resetting on progress", async () => {
    vi.useFakeTimers();
    const stream = response([{ type: "start", deadlines: { evidence_seconds: 1, context_seconds: 40, model_seconds: 1 } }], false);
    fetchApi.mockResolvedValue(stream.response);
    const operation = streamContextBriefing(briefingSelection, context);
    const checked = expect(operation).rejects.toThrow("time limit");
    await vi.advanceTimersByTimeAsync(18_000);
    expect(fetchApi.mock.calls[0][1].signal.aborted).toBe(false);
    stream.source.enqueue(encoder.encode('{"type":"progress","phase":"collecting_context"}\n'));
    await vi.advanceTimersByTimeAsync(39_001);
    await checked;
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(fetchApi).toHaveBeenCalledOnce();
  });

  it("propagates cancellation while collecting without keeping a partial answer", async () => {
    const stream = response([start], false); fetchApi.mockResolvedValue(stream.response);
    const controller = new AbortController();
    await expect(streamContextBriefing(briefingSelection, context, { signal: controller.signal, onProgress: () => controller.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(stream.cancel).toHaveBeenCalledOnce();
  });

  it("rejects empty selection before fetching", async () => {
    await expect(streamContextBriefing(briefingSelection, { news: false, macro_regions: [] })).rejects.toThrow("Choose news");
    expect(fetchApi).not.toHaveBeenCalled();
  });
});
