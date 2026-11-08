import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComparisonBriefingPanel } from "../components/market/ComparisonBriefingPanel";
import { streamComparisonBriefing } from "../api/comparisonBriefing";
import { streamContextBriefing, type ContextBriefingResult } from "../api/comparisonContextBriefing";
import { makeFilingBriefing, filingSelection } from "./fixtures/filingBriefing";
vi.mock("../api/comparisonBriefing", async (original) => ({ ...await original<typeof import("../api/comparisonBriefing")>(), streamComparisonBriefing: vi.fn() }));
vi.mock("../api/comparisonContextBriefing", async (original) => ({ ...await original<typeof import("../api/comparisonContextBriefing")>(), streamContextBriefing: vi.fn() }));
const context = vi.mocked(streamContextBriefing), price = vi.mocked(streamComparisonBriefing);
const select = () => fireEvent.click(screen.getByRole("checkbox", { name: "SEC filing facts", exact: true }));
const generate = () => fireEvent.click(screen.getByRole("button", { name: "Generate briefing", exact: true }));
beforeEach(() => { context.mockReset(); price.mockReset(); });

describe("filing briefing interface", () => {
  it("is opt-in and focuses the exact value, concept, fiscal period and filing provenance", async () => {
    context.mockResolvedValue(makeFilingBriefing());
    render(<ComparisonBriefingPanel selection={filingSelection} />);
    expect(screen.getByRole("checkbox", { name: "SEC filing facts" })).not.toBeChecked();
    select(); expect(context).not.toHaveBeenCalled(); expect(price).not.toHaveBeenCalled();
    generate(); await screen.findByRole("region", { name: "Possible context" });
    expect(context.mock.calls[0][1]).toEqual({ news: false, macro_regions: [], fundamentals: true });
    fireEvent.click(screen.getByRole("button", { name: "Inspect C1A1F1 for possible context 1" }));
    const group = screen.getByRole("region", { name: "C1A1F1 evidence" });
    expect(group).toHaveFocus(); expect(group).toHaveTextContent("100 USD");
    expect(group).toHaveTextContent("us-gaap:Revenues");
    expect(group).toHaveTextContent("Fiscal period: 2026-06-01 to 2026-08-31");
    expect(group).toHaveTextContent("filed 2026-09-15"); expect(group).toHaveTextContent("0000320193-26-000002");
    expect(within(group).getAllByRole("link", { name: "Open SEC filing index" })[0]).toHaveAttribute("href",
      "https://www.sec.gov/Archives/edgar/data/320193/000032019326000002/0000320193-26-000002-index.html");
    const repeated = screen.getByRole("button", { name: "Inspect C1A1F1 for possible context 2" });
    repeated.focus(); fireEvent.click(repeated); expect(group).toHaveFocus();
    expect(screen.getByRole("region", { name: "C1A1 evidence" })).toHaveTextContent("Terminal retrieval:");
    expect(screen.getByRole("region", { name: "C1 evidence" })).toHaveTextContent("Historical investor knowledge and revision order are not established");
  });
  it("keeps conflicting values withheld and disclosure truncation visible", async () => {
    context.mockResolvedValueOnce(makeFilingBriefing("conflict")).mockResolvedValueOnce(makeFilingBriefing("truncated"));
    render(<ComparisonBriefingPanel selection={filingSelection} />); select(); generate();
    await screen.findByRole("region", { name: "Possible context" });
    fireEvent.click(screen.getByRole("button", { name: /^Inspect C1A1F1 for evidence limitations/ }));
    const group = screen.getByRole("region", { name: "C1A1F1 evidence" });
    expect(group).toHaveFocus(); expect(group).toHaveTextContent("Value withheld · Conflicting reported values");
    expect(group).not.toHaveTextContent("100 USD"); expect(group).not.toHaveTextContent("120 USD");
    fireEvent.click(screen.getByRole("button", { name: "Generate new briefing" }));
    await screen.findByRole("button", { name: "Generate new briefing" });
    fireEvent.click(screen.getByRole("button", { name: /^Inspect C1A1F1 for evidence limitations/ }));
    expect(screen.getByRole("region", { name: "C1A1F1 evidence" })).toHaveTextContent("omitted disclosures 56");
  });
  it.each([
    ["configuration_required", "SEC_USER_AGENT is not configured"], ["not_covered", "No exact SEC ticker coverage"],
    ["failed", "SEC provider failed"], ["empty", "No matching facts in the supported concepts"],
  ] as const)("shows %s distinctly and keeps the observed price answer", async (mode, message) => {
    context.mockResolvedValue(makeFilingBriefing(mode));
    render(<ComparisonBriefingPanel selection={filingSelection} />); select(); generate();
    await screen.findByRole("region", { name: "Observed movement" });
    if (mode === "empty") expect(screen.getByRole("region", { name: "Selected context coverage" })).toHaveTextContent("No usable filing values");
    fireEvent.click(screen.getByRole("button", { name: "Inspect C1 coverage" }));
    expect(screen.getByRole("region", { name: "C1A1 evidence" })).toHaveTextContent(message);
    expect(screen.getByRole("region", { name: "C1A1 evidence" })).not.toHaveTextContent("0 USD");
  });
  it("retains inspectable filing evidence when the model fails", async () => {
    context.mockResolvedValue(makeFilingBriefing("model_failure"));
    render(<ComparisonBriefingPanel selection={filingSelection} />); select(); generate();
    await screen.findByRole("alert");
    expect(screen.queryByRole("region", { name: "Possible context" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Inspect C1 coverage" }));
    expect(screen.getByRole("region", { name: "C1A1F1 evidence" })).toHaveTextContent("100 USD");
  });
  it("combines selected news, macro and fundamentals without implying a filing-instance check", async () => {
    context.mockResolvedValue(makeFilingBriefing("mixed"));
    render(<ComparisonBriefingPanel selection={filingSelection} />);
    for (const name of ["Dated news headlines", "US macro (FRED)", "SEC filing facts"]) fireEvent.click(screen.getByRole("checkbox", { name, exact: true }));
    generate(); await screen.findByRole("region", { name: "Possible context" });
    expect(context.mock.calls[0][1]).toEqual({ news: true, macro_regions: ["us"], fundamentals: true });
    fireEvent.click(screen.getByRole("button", { name: "Inspect C3A1F1 for possible context 2" }));
    expect(screen.getByRole("region", { name: "C3A1F1 evidence" })).toHaveFocus();
    expect(screen.getByRole("region", { name: "C3 evidence" })).toHaveTextContent("not independently checked filing-instance values");
  });
  it("cancels scope changes, discards late results and requires manual generation", async () => {
    let resolve!: (result: ContextBriefingResult) => void;
    context.mockReturnValue(new Promise((done) => { resolve = done; }));
    price.mockReturnValue(new Promise(() => {}));
    const view = render(<ComparisonBriefingPanel selection={filingSelection} />); select(); generate();
    const pending = context.mock.calls[0][2]!;
    select(); expect(pending.signal!.aborted).toBe(true);
    await act(async () => { resolve(makeFilingBriefing()); pending.onProgress!("generating"); });
    expect(screen.queryByRole("region", { name: "Possible context" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(context).toHaveBeenCalledTimes(1); expect(price).not.toHaveBeenCalled();
    generate(); expect(price).toHaveBeenCalledOnce();
    const pricePending = price.mock.calls[0][1]!;
    view.rerender(<ComparisonBriefingPanel selection={{ ...filingSelection, anchor: "MSFT" }} />);
    expect(pricePending.signal!.aborted).toBe(true);
  });
});
