import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComparisonBriefingPanel } from "../components/market/ComparisonBriefingPanel";
import { makeCapture, captureSummary } from "./fixtures/comparisonCaptures";
import { briefingSelection } from "./fixtures/comparisonBriefing";
const mocks = vi.hoisted(() => ({ save: vi.fn(), list: vi.fn(), get: vi.fn(), remove: vi.fn() }));
vi.mock("../api/comparisonCaptures", async (original) => ({
  ...await original<typeof import("../api/comparisonCaptures")>(), streamComparisonCapture: mocks.save,
  listComparisonCaptures: mocks.list, getComparisonCapture: mocks.get, deleteComparisonCapture: mocks.remove,
}));

describe("saved comparison workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([captureSummary()]); mocks.get.mockResolvedValue(makeCapture());
    mocks.save.mockResolvedValue(makeCapture()); mocks.remove.mockResolvedValue(undefined);
  });
  it("explicitly generates and retains one run then reopens original evidence with citation inspection", async () => {
    const value = makeCapture();
    const view = render(<ComparisonBriefingPanel selection={briefingSelection} />);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Generate and save briefing" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Saved|Starting/);
    await waitFor(() => expect(screen.getByText(/Saved .*retained until/)).toBeVisible());
    expect(mocks.save).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Review saved briefings" }));
    fireEvent.click(await screen.findByRole("button", { name: /Open saved AAPL/ }));
    const saved = await screen.findByRole("region", { name: "Saved briefing review" });
    expect(saved).toHaveTextContent("Saved scope: AAPL vs SPY · 1M");
    fireEvent.click(within(saved).getByRole("button", { name: "Inspect P1 for observed movement 1" }));
    expect(within(saved).getByRole("region", { name: "P1 evidence" })).toHaveFocus();
    fireEvent.click(within(saved).getByText("Inspect saved model inputs"));
    expect(await within(saved).findByText(/original input/)).toBeVisible();
    expect(view.container.querySelector("script")).toBeNull();
    expect(mocks.save).toHaveBeenCalledOnce(); // Reopen/inspect did not invoke a model.
    expect(mocks.get).toHaveBeenCalledWith(value.id, expect.any(AbortSignal));
  });
  it("requires explicit delete confirmation and clears the matching saved status", async () => {
    mocks.list.mockResolvedValueOnce([captureSummary()]).mockResolvedValueOnce([]);
    render(<ComparisonBriefingPanel selection={briefingSelection} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate and save briefing" }));
    await screen.findByText(/Saved .*retained until/);
    fireEvent.click(screen.getByRole("button", { name: "Review saved briefings" }));
    fireEvent.click(await screen.findByRole("button", { name: /Open saved AAPL/ }));
    const saved = await screen.findByRole("region", { name: "Saved briefing review" });
    fireEvent.click(within(saved).getByRole("button", { name: "Delete saved briefing" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Saved briefing review" })).not.toBeInTheDocument());
    expect(mocks.remove).toHaveBeenCalledWith("saved-1", expect.any(AbortSignal));
    expect(screen.queryByText(/Saved .*retained until/)).not.toBeInTheDocument();
  });
  it("discloses list failure without claiming there are no saved records", async () => {
    mocks.list.mockRejectedValue(new Error("Saved list unavailable"));
    render(<ComparisonBriefingPanel selection={briefingSelection} />);
    fireEvent.click(screen.getByRole("button", { name: "Review saved briefings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved list unavailable");
    expect(screen.queryByText("No saved briefings yet.")).not.toBeInTheDocument();
  });
  it("aborts scope changes and ignores late save/detail responses", async () => {
    let finish!: (value: ReturnType<typeof makeCapture>) => void;
    mocks.save.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = render(<ComparisonBriefingPanel selection={briefingSelection} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate and save briefing" }));
    const signal = mocks.save.mock.calls[0][2].signal;
    view.rerender(<ComparisonBriefingPanel selection={{ ...briefingSelection, anchor: "MSFT" }} />);
    expect(signal.aborted).toBe(true);
    await act(async () => finish(makeCapture()));
    expect(screen.queryByText(/Saved .*retained until/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review saved briefings" }));
    let open!: (value: ReturnType<typeof makeCapture>) => void;
    mocks.get.mockReturnValue(new Promise((resolve) => { open = resolve; }));
    fireEvent.click(await screen.findByRole("button", { name: /Open saved AAPL/ }));
    const detailSignal = mocks.get.mock.calls[0][1];
    fireEvent.click(screen.getByRole("checkbox", { name: "Dated news headlines" }));
    expect(detailSignal.aborted).toBe(true);
    await act(async () => open(makeCapture()));
    expect(screen.queryByRole("region", { name: "Saved briefing review" })).not.toBeInTheDocument();
  });
  it("pages retained history and ignores a late list after a scope change", async () => {
    const first = Array.from({ length: 20 }, (_, index) => ({ ...captureSummary(), id: `saved-${index}` }));
    mocks.list.mockResolvedValueOnce(first).mockResolvedValueOnce([{ ...captureSummary(), id: "saved-21" }]);
    const view = render(<ComparisonBriefingPanel selection={briefingSelection} />);
    fireEvent.click(screen.getByRole("button", { name: "Review saved briefings" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Open saved AAPL/ })).toHaveLength(20));
    fireEvent.click(screen.getByRole("button", { name: "Next saved briefings" }));
    expect(await screen.findByText("Showing 21–21")).toBeVisible();
    expect(mocks.list.mock.calls[1][1]).toBe(20);
    let finish!: (value: ReturnType<typeof captureSummary>[]) => void;
    mocks.list.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Previous saved briefings" }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3));
    const signal = mocks.list.mock.calls[2][0];
    view.rerender(<ComparisonBriefingPanel selection={{ ...briefingSelection, anchor: "MSFT" }} />);
    expect(signal.aborted).toBe(true);
    await act(async () => finish(first));
    expect(screen.queryByRole("button", { name: /Open saved AAPL/ })).not.toBeInTheDocument();
  });
  it("can find a saved record after acknowledgement failure without repeating generation", async () => {
    mocks.save.mockRejectedValueOnce(new Error("Saving could not be confirmed"));
    render(<ComparisonBriefingPanel selection={briefingSelection} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate and save briefing" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saving could not be confirmed");
    fireEvent.click(screen.getByRole("button", { name: "Review saved briefings" }));
    fireEvent.click(await screen.findByRole("button", { name: /Open saved AAPL/ }));
    expect(await screen.findByRole("region", { name: "Saved briefing review" })).toBeVisible();
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it("retains an unavailable result with its original evidence for review", async () => {
    const saved = makeCapture(); saved.status = "unavailable";
    Object.assign(saved.content.result, { status: "unavailable", engine: "unavailable", observations: [], hypotheses: [], limitations: [], unknowns: [],
      failure: { code: "disabled", message: "Model synthesis is disabled on this host.", retryable: false } });
    saved.content.generation.enabled = false; saved.content.generation.attempts = [];
    mocks.save.mockResolvedValueOnce(saved);
    render(<ComparisonBriefingPanel selection={briefingSelection} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate and save briefing" }));
    expect(await screen.findByText(/Saved .*retained until/)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Model synthesis is disabled");
    expect(screen.getByText(/Inspect briefing evidence snapshot/)).toBeVisible();
  });

});
