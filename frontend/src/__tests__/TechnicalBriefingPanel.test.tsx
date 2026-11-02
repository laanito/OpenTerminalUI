import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComparisonBriefingPanel } from "../components/market/ComparisonBriefingPanel";
import { streamComparisonBriefing } from "../api/comparisonBriefing";
import { streamContextBriefing, type ContextBriefingResult } from "../api/comparisonContextBriefing";
import { makeTechnicalBriefing, technicalSelection } from "./fixtures/technicalBriefing";

vi.mock("../api/comparisonBriefing", async (original) => ({ ...await original<typeof import("../api/comparisonBriefing")>(), streamComparisonBriefing: vi.fn() }));
vi.mock("../api/comparisonContextBriefing", async (original) => ({ ...await original<typeof import("../api/comparisonContextBriefing")>(), streamContextBriefing: vi.fn() }));
const context = vi.mocked(streamContextBriefing), price = vi.mocked(streamComparisonBriefing);
const select = () => fireEvent.click(screen.getByRole("checkbox", { name: "Technical observations", exact: true }));
const generate = () => fireEvent.click(screen.getByRole("button", { name: "Generate briefing", exact: true }));
beforeEach(() => { context.mockReset(); price.mockReset(); });

describe("Technical briefing interface", () => {
  it("is opt-in and opens exact metric citations with supporting dates, formula, values and caveats", async () => {
    context.mockResolvedValue(makeTechnicalBriefing());
    render(<ComparisonBriefingPanel selection={technicalSelection} />);
    expect(screen.getByRole("checkbox", { name: "Technical observations" })).not.toBeChecked();
    select();
    expect(context).not.toHaveBeenCalled(); expect(price).not.toHaveBeenCalled();
    generate();
    await screen.findByRole("region", { name: "Possible context" });
    expect(context.mock.calls[0][1]).toEqual({ news: false, macro_regions: [], technical: true });
    expect(price).not.toHaveBeenCalled();
    expect(screen.getByText(/model fixture-deep-model/)).toHaveTextContent("Deep profile");
    fireEvent.click(screen.getByRole("button", { name: "Inspect C1A1T1 for possible context 1" }));
    const metric = screen.getByRole("region", { name: "C1A1T1 evidence" });
    expect(metric).toHaveFocus();
    expect(metric).toHaveTextContent("20-close moving-average gap");
    expect(metric).toHaveTextContent("20 own dated closes");
    expect(metric).toHaveTextContent("100 * (last_adjusted_close / mean(last_20_adjusted_closes) - 1)");
    const repeated = screen.getByRole("button", { name: "Inspect C1A1T1 for possible context 2" });
    repeated.focus(); fireEvent.click(repeated); expect(metric).toHaveFocus();
    const asset = screen.getByRole("region", { name: "C1A1 evidence" });
    expect(asset).toHaveTextContent("Stale source history");
    expect(asset).toHaveTextContent("Adjustment methods, exchange sessions and bar completion have not been independently verified");
    fireEvent.click(within(asset).getByText("Supporting adjusted closes (21)"));
    expect(within(asset).getByRole("table", { name: "AAPL supporting adjusted closes" })).toBeVisible();
    expect(within(asset).getAllByRole("row")).toHaveLength(22);
    expect(within(asset).getByText(/Input ID: ti_/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Inspect SCOPE for unknowns 1" }));
    expect(screen.getByRole("region", { name: "SCOPE evidence" })).toHaveTextContent("technical observations");
  });

  it("renders partial history without presenting unavailable values as zero", async () => {
    context.mockResolvedValue(makeTechnicalBriefing("partial"));
    render(<ComparisonBriefingPanel selection={technicalSelection} />); select(); generate();
    await screen.findByRole("region", { name: "Possible context" });
    fireEvent.click(screen.getByRole("button", { name: /^Inspect C1A1T2 for evidence limitations/ }));
    const metric = screen.getByRole("region", { name: "C1A1T2 evidence" });
    expect(metric).toHaveFocus();
    expect(metric).toHaveTextContent("Unavailable · Insufficient history. Requires 21 closes; 20 available");
    expect(metric).toHaveTextContent("No zero value is implied");
    expect(screen.getByRole("region", { name: "C1A1 evidence" })).toHaveTextContent("Partial observations");
  });

  it("keeps the price answer and coverage visible when selected technical data is unavailable", async () => {
    context.mockResolvedValue(makeTechnicalBriefing("unavailable"));
    render(<ComparisonBriefingPanel selection={technicalSelection} />); select(); generate();
    expect(await screen.findByRole("region", { name: "Observed movement" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Selected context coverage" })).toHaveTextContent("No eligible technical observations");
    expect(screen.getByText(/No possible context was generated/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Inspect C1 coverage" }));
    expect(screen.getByRole("region", { name: "C1 evidence" })).toHaveFocus();
    expect(screen.getByRole("region", { name: "C1A1 evidence" })).toHaveTextContent("Selected history feed is not supported");
  });

  it("allows technical data alongside explicitly selected news and macro", async () => {
    context.mockResolvedValue(makeTechnicalBriefing("mixed"));
    render(<ComparisonBriefingPanel selection={technicalSelection} />);
    for (const name of ["Dated news headlines", "US macro (FRED)", "Technical observations"]) fireEvent.click(screen.getByRole("checkbox", { name, exact: true }));
    generate(); await screen.findByRole("region", { name: "Possible context" });
    expect(context.mock.calls[0][1]).toEqual({ news: true, macro_regions: ["us"], technical: true });
    fireEvent.click(screen.getByRole("button", { name: "Inspect C3A2T1 for possible context 2" }));
    expect(screen.getByRole("region", { name: "C3A2T1 evidence" })).toHaveFocus();
    expect(screen.getByRole("region", { name: "C3A2 evidence" })).toHaveTextContent("BTC-USD");
  });

  it("aborts and discards old technical work when scope changes, requiring explicit generation", async () => {
    let resolve!: (result: ContextBriefingResult) => void;
    context.mockReturnValue(new Promise((done) => { resolve = done; }));
    price.mockReturnValue(new Promise(() => {}));
    render(<ComparisonBriefingPanel selection={technicalSelection} />); select(); generate();
    const options = context.mock.calls[0][2]!;
    select(); expect(options.signal!.aborted).toBe(true); expect(price).not.toHaveBeenCalled();
    await act(async () => { resolve(makeTechnicalBriefing()); options.onProgress!("generating"); });
    expect(screen.queryByRole("region", { name: "Possible context" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    generate(); expect(price).toHaveBeenCalledTimes(1); expect(context).toHaveBeenCalledTimes(1);
  });
});
