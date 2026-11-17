import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/retainedSentimentBriefing.json";
import { validateComparisonCapture, streamSentimentBriefing } from "../api/comparisonCaptures";
import { validateRetainedHeadline } from "../api/headlineSentiment";
import { ComparisonBriefingResultView } from "../components/market/ComparisonBriefingResultView";
import { SavedComparisonBriefings } from "../components/market/SavedComparisonBriefings";

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), headlines: vi.fn() }));
vi.mock("../api/comparisonCaptures", async original => ({
  ...await original<typeof import("../api/comparisonCaptures")>(),
  listComparisonCaptures: mocks.list, getComparisonCapture: mocks.get,
}));
vi.mock("../api/headlineSentiment", async original => ({
  ...await original<typeof import("../api/headlineSentiment")>(), listHeadlineAssessments: mocks.headlines,
}));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const source = () => validateComparisonCapture(clone(fixture.source));
const child = () => validateComparisonCapture(clone(fixture.child));
function stream(value: unknown) {
  return new Response(new ReadableStream({ start(controller) {
    const events = [{ type: "start", deadlines: { evidence_seconds: 45, context_seconds: 40, model_seconds: 240 } }, { type: "progress", phase: "generating" }, { type: "result", result: value }];
    controller.enqueue(new TextEncoder().encode(events.map(event => JSON.stringify(event) + "\n").join(""))); controller.close();
  } }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("retained sentiment capture contract", () => {
  it("accepts the shared server fixture and retains separate methods and scoring dates", () => {
    const saved = child();
    expect(source().content.sentiment_sources).toBeUndefined();
    expect(saved.content.sentiment_sources?.[0]).toEqual(fixture.headlines[0]);
    expect(saved.lineage?.kind).toBe("retained_sentiment_interpretation");
    expect(saved.content.result.evidence).toMatchObject({ schema_version: "3", sentiment: [
      { citation_id: "R1", assessment: { meaning: "text_tone", model: null } },
      { citation_id: "R2", assessment: { meaning: "asset_implication", model: "fixture-fast" } },
    ] });
  });
  it("rejects missing original sources, altered projections, broken targets and omitted opinion coverage", () => {
    const mutations = [
      (value: any) => { delete value.content.sentiment_sources; },
      (value: any) => { value.content.result.evidence.sentiment[0].assessment.score = 0.8; },
      (value: any) => { value.content.result.evidence.sentiment[1].assessment.target_symbol = "MSFT"; },
      (value: any) => { value.content.result.evidence.sentiment[0].pair_citation_id = "P2"; },
      (value: any) => { value.content.result.possible_context.pop(); },
      (value: any) => { value.content.sentiment_sources[0].payload.origin.capture_content_hash = "a".repeat(64); },
    ];
    for (const mutate of mutations) { const value = clone(fixture.child); mutate(value); expect(() => validateComparisonCapture(value)).toThrow(); }
  });
  it("uses a new saved stream with explicit IDs and rejects a refresh disguised as interpretation", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(stream(fixture.child));
    const saved = await streamSentimentBriefing(source(), [fixture.headlines[0].id]);
    expect(saved.id).toBe(fixture.child.id);
    expect(String(fetch.mock.calls[0][0])).toContain(`/briefing-captures/${fixture.source.id}/sentiment-briefing/stream`);
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ snapshot_ids: [fixture.headlines[0].id] });
    await expect(streamSentimentBriefing(source(), [])).rejects.toThrow(/one to five/);
    expect(fetch).toHaveBeenCalledOnce();
    const changed = clone(fixture.child); changed.content.result.evidence!.price.retrieved_at = "2026-11-18T10:00:00Z";
    fetch.mockResolvedValue(stream(changed));
    await expect(streamSentimentBriefing(source(), [fixture.headlines[0].id])).rejects.toThrow(/could not be confirmed/);
  });
  it("focuses exact retained citations and renders source/model strings as text", () => {
    const saved = child();
    const view = render(<ComparisonBriefingResultView result={saved.content.result} />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect R2 for possible context 2" }));
    const evidence = screen.getByRole("region", { name: "R2 evidence", exact: true });
    expect(evidence).toHaveFocus(); expect(evidence).toHaveTextContent("fixture-fast");
    expect(evidence).toHaveTextContent("Originally scored"); expect(view.container.querySelector("script")).toBeNull();
  });
});

it("selects retained observations explicitly and opens the saved child with offline scoring inputs", async () => {
  const original = source(), enriched = child();
  const { content: _content, ...summary } = original;
  mocks.list.mockResolvedValue([summary]); mocks.get.mockResolvedValue(original);
  mocks.headlines.mockResolvedValue(fixture.headlines.map(validateRetainedHeadline));
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(stream(fixture.child));
  const view = render(<SavedComparisonBriefings revision={0} />);
  fireEvent.click(screen.getByRole("button", { name: "Review saved briefings" }));
  fireEvent.click(await screen.findByRole("button", { name: /Open saved AAPL/ }));
  const review = await screen.findByRole("region", { name: "Saved briefing review" });
  const sentiment = screen.getByRole("region", { name: "Headline sentiment", exact: true });
  fireEvent.click(within(sentiment).getByRole("button", { name: "Review retained headline assessments" }));
  fireEvent.click(await within(sentiment).findByRole("checkbox", { name: /Use .* in Deep interpretation/ }));
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(within(sentiment).getByRole("button", { name: "Interpret selected sentiment and save (1/5)" }));
  await waitFor(() => expect(review).toHaveTextContent("Retained-sentiment interpretation"));
  fireEvent.click(within(review).getByText("Inspect retained sentiment inputs", { exact: true }));
  fireEvent.click(within(review).getByText("Inspect scoring inputs", { exact: true }));
  expect(await within(review).findByText(/untrusted retained input/)).toBeVisible();
  expect(view.container.querySelector("script")).toBeNull(); expect(fetch).toHaveBeenCalledOnce();
  expect(review).toHaveTextContent(enriched.lineage!.parent_id);
});
