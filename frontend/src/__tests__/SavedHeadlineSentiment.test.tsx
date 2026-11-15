import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SavedHeadlineSentiment } from "../components/market/SavedHeadlineSentiment";
import { makeCapture } from "./fixtures/comparisonCaptures";
import { makeRetainedHeadline } from "./fixtures/headlineSentiment";
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), score: vi.fn() }));
vi.mock("../api/headlineSentiment", async (original) => ({
  ...await original<typeof import("../api/headlineSentiment")>(), listHeadlineAssessments: mocks.list,
  getRetainedHeadline: mocks.get, streamHeadlineAssessments: mocks.score,
}));
beforeEach(() => {
  vi.clearAllMocks(); mocks.list.mockResolvedValue([makeRetainedHeadline()]); mocks.get.mockResolvedValue(makeRetainedHeadline());
  mocks.score.mockResolvedValue([makeRetainedHeadline()]);
});
describe("saved headline selection and retained review", () => {
  it("requires explicit selection, retains one result, inspects original inputs as escaped text and labels both rubrics", async () => {
    const busy = vi.fn(); const view = render(<SavedHeadlineSentiment source={makeCapture(true)} onBusyChange={busy} />);
    const assess = screen.getByRole("button", { name: "Assess and retain selected headlines" });
    expect(assess).toBeDisabled(); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.score).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /AAPL · C1G1H1/ })); fireEvent.click(assess);
    expect(await screen.findByText("Saved 1 headline observation from 1 selected reference.")).toBeVisible();
    expect(mocks.score).toHaveBeenCalledWith(makeCapture(true), [{ citation_id: "C1G1H1", target_symbol: "AAPL" }], expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const evidence = screen.getByRole("region", { name: "Retained headline snapshot-1", exact: true });
    await waitFor(() => expect(evidence).toHaveFocus());
    expect(within(evidence).getByRole("heading", { name: "Text tone" })).toBeVisible();
    expect(within(evidence).getByRole("heading", { name: "Asset implication for AAPL" })).toBeVisible();
    expect(evidence).toHaveTextContent("Headline only; full article not read");
    fireEvent.click(within(evidence).getByText("Inspect scoring inputs"));
    expect(await within(evidence).findByText(/<script>source data/)).toBeVisible();
    expect(view.container.querySelector("script")).toBeNull();
    expect(busy.mock.calls.map(([value]) => value)).toEqual([true, false]);
    expect(mocks.score).toHaveBeenCalledOnce(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it("shows a failed model outcome separately from neutral keyword tone and preserves cache dates", async () => {
    const row = makeRetainedHeadline(); const asset = row.assessments[1].payload;
    Object.assign(asset, { status: "failed", score: null, label: null, rationale: null, failure_code: "timeout" });
    mocks.get.mockResolvedValue(row);
    render(<SavedHeadlineSentiment source={null} onBusyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Review retained headline assessments" }));
    fireEvent.click(await screen.findByRole("button", { name: /Inspect retained headline snapshot-1/ }));
    const failed = await screen.findByRole("article", { name: "Asset implication assessment asset-1" });
    expect(failed).toHaveTextContent("Not assessed · timeout"); expect(failed).not.toHaveTextContent("Neutral"); expect(failed).not.toHaveTextContent("score 0");
    const cached = makeRetainedHeadline(); cached.id = "cached"; cached.assessments[1].payload.reused_from_cache = true;
    mocks.get.mockResolvedValue(cached); mocks.list.mockResolvedValue([cached]);
    fireEvent.click(screen.getByRole("button", { name: "Refresh retained assessments" }));
    fireEvent.click(await screen.findByRole("button", { name: /Inspect retained headline cached/ }));
    const reused = await screen.findByRole("region", { name: "Retained headline cached", exact: true });
    expect(reused).toHaveTextContent("reused from cache; scoring time preserved");
    expect(reused).toHaveTextContent(new Date(cached.assessments[1].payload.scored_at).toLocaleString());
    expect(mocks.score).not.toHaveBeenCalled();
  });
  it("cancels without accepting a late receipt and never automatically retries", async () => {
    let finish!: (value: ReturnType<typeof makeRetainedHeadline>[]) => void;
    mocks.score.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const busy = vi.fn(); render(<SavedHeadlineSentiment source={makeCapture(true)} onBusyChange={busy} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /AAPL · C1G1H1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Assess and retain selected headlines" }));
    expect(screen.getByRole("button", { name: "Assess and retain selected headlines" })).toBeDisabled();
    const signal = mocks.score.mock.calls[0][2].signal;
    fireEvent.click(screen.getByRole("button", { name: "Cancel headline assessment" }));
    expect(signal.aborted).toBe(true);
    await act(async () => finish([makeRetainedHeadline()]));
    expect(screen.queryByText(/Saved 1 headline observation/)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Refresh retained assessments");
    expect(busy).toHaveBeenLastCalledWith(false); expect(mocks.score).toHaveBeenCalledOnce();
  });
  it("aborts an old source on scope remount and ignores its late result", async () => {
    let finish!: (value: ReturnType<typeof makeRetainedHeadline>[]) => void;
    mocks.score.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const busy = vi.fn(); const view = render(<SavedHeadlineSentiment key="source" source={makeCapture(true)} onBusyChange={busy} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /AAPL · C1G1H1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Assess and retain selected headlines" }));
    const signal = mocks.score.mock.calls[0][2].signal;
    view.rerender(<SavedHeadlineSentiment key="other" source={null} onBusyChange={busy} />);
    expect(signal.aborted).toBe(true);
    await act(async () => finish([makeRetainedHeadline()]));
    expect(screen.queryByText(/Saved 1 headline observation/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Retained headline snapshot-1", exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assess and retain selected headlines" })).not.toBeInTheDocument();
  });
  it("caps selection at ten, allows deselection, and respects parent busy state", () => {
    const source = makeCapture(true); const section = (source.content.result as any).evidence.sections[0];
    section.groups[0].headlines = Array.from({ length: 11 }, (_, i) => ({ ...section.groups[0].headlines[0], citation_id: `C1G1H${i + 1}` }));
    const busy = vi.fn(); const view = render(<SavedHeadlineSentiment source={source} onBusyChange={busy} />);
    const boxes = screen.getAllByRole("checkbox");
    boxes.slice(0, 10).forEach((box) => fireEvent.click(box));
    expect(boxes[10]).toBeDisabled(); expect(boxes[0]).not.toBeDisabled();
    fireEvent.click(boxes[0]); expect(boxes[10]).not.toBeDisabled();
    view.rerender(<SavedHeadlineSentiment source={source} disabled onBusyChange={busy} />);
    expect(screen.getByRole("button", { name: "Assess and retain selected headlines" })).toBeDisabled();
  });
  it("paginates source/global retained history and makes read failures explicit", async () => {
    const first = Array.from({ length: 20 }, (_, i) => ({ ...makeRetainedHeadline(), id: `snapshot-${i}` }));
    mocks.list.mockResolvedValueOnce(first).mockResolvedValueOnce([]).mockResolvedValueOnce([makeRetainedHeadline()]);
    render(<SavedHeadlineSentiment source={makeCapture(true)} onBusyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Review retained headline assessments" }));
    const next = await screen.findByRole("button", { name: "Next retained assessments" });
    await waitFor(() => expect(next).toBeEnabled()); fireEvent.click(next);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith("saved-1", 20, expect.any(AbortSignal)));
    expect(await screen.findByText("No more retained observations on this page.")).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show all retained headline assessments" }));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(undefined, 0, expect.any(AbortSignal)));
    mocks.get.mockRejectedValueOnce(new Error("Retained record unavailable"));
    fireEvent.click(await screen.findByRole("button", { name: /Inspect retained headline snapshot-1/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Retained record unavailable");
    expect(screen.queryByText("No retained headline assessments yet.")).not.toBeInTheDocument();
    expect(mocks.score).not.toHaveBeenCalled();
  });
});
