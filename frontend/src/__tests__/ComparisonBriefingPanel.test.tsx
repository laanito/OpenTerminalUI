import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamComparisonBriefing } from "../api/comparisonBriefing";
import { ComparisonBriefingPanel } from "../components/market/ComparisonBriefingPanel";
import { streamContextBriefing, type ContextBriefingResult } from "../api/comparisonContextBriefing";
import { briefingSelection, makeBriefing, makeContextBriefing } from "./fixtures/comparisonBriefing";

vi.mock("../api/comparisonBriefing", async (original) => ({
  ...await original<typeof import("../api/comparisonBriefing")>(), streamComparisonBriefing: vi.fn(),
}));
const generate = vi.mocked(streamComparisonBriefing);
vi.mock("../api/comparisonContextBriefing", async (original) => ({
  ...await original<typeof import("../api/comparisonContextBriefing")>(), streamContextBriefing: vi.fn(),
}));
const generateContext = vi.mocked(streamContextBriefing);
function pending() {
  let resolve!: (value: ReturnType<typeof makeBriefing>) => void;
  const promise = new Promise<ReturnType<typeof makeBriefing>>((done) => { resolve = done; });
  return { promise, resolve };
}
const clickGenerate = () => fireEvent.click(screen.getByRole("button", { name: "Generate briefing" }));

describe("ComparisonBriefingPanel", () => {
  beforeEach(() => { generate.mockReset(); generateContext.mockReset(); });

  it.each(["deep", "fast"] as const)("shows the resolved %s profile without claiming model quality", async (resolved) => {
    const value = makeBriefing();
    value.model_profile = { requested_profile: "deep", resolved_profile: resolved, model: value.model! };
    generate.mockResolvedValue(value);
    render(<ComparisonBriefingPanel selection={briefingSelection} />);
    clickGenerate();
    expect(await screen.findByText(resolved === "deep" ? /Deep profile/ : /Default profile \(Deep not configured\)/)).toBeVisible();
  });

  it("is opt-in and keeps scope and mandatory evidence warnings beside plain-text prose", async () => {
    const value = makeBriefing();
    value.observations[0].text = '<img src=x onerror=alert(1)> [untrusted](https://example.com)';
    generate.mockResolvedValue(value);
    const { container } = render(<ComparisonBriefingPanel selection={briefingSelection} />);
    expect(generate).not.toHaveBeenCalled();
    expect(screen.getByText(/not included—even if open/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /save|index/i })).not.toBeInTheDocument();
    clickGenerate();
    expect(await screen.findByText(value.observations[0].text)).toBeVisible();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByLabelText("Mandatory evidence caveats")).toBeVisible();
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Inspect P1 for observed movement 1" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "P1 evidence" })).toHaveFocus());
    const evidence = screen.getByRole("region", { name: "P1 evidence" });
    expect(evidence).toBeVisible();
    expect(within(evidence).getByText(/1\.2345%/)).toBeVisible();
    expect(within(evidence).getByText(/22 shared UTC closes/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Inspect SCOPE for unknowns 1" }));
    expect(screen.getByRole("region", { name: "SCOPE evidence" })).toHaveFocus();
    expect(screen.getByText(`Snapshot ID: ${value.evidence!.packet_id}`)).toBeVisible();
    expect(generate).toHaveBeenCalledOnce();
  });

  it("shows progress, cancels, and ignores late results and progress from the cancelled run", async () => {
    const old = pending(); generate.mockReturnValueOnce(old.promise).mockResolvedValueOnce(makeBriefing());
    render(<ComparisonBriefingPanel selection={briefingSelection} />);
    clickGenerate();
    const options = generate.mock.calls[0][1]!;
    act(() => options.onProgress!("retrying"));
    expect(screen.getByRole("status")).toHaveTextContent("Repairing the model response once");
    fireEvent.click(screen.getByRole("button", { name: "Cancel briefing" }));
    expect(options.signal!.aborted).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("Briefing cancelled");
    clickGenerate();
    await screen.findByText(makeBriefing().observations[0].text);
    const late = makeBriefing(); late.observations[0].text = "Cancelled answer must never be displayed.";
    await act(async () => { options.onProgress!("generating"); old.resolve(late); });
    expect(screen.queryByText(late.observations[0].text)).not.toBeInTheDocument();
    expect(screen.getByText(makeBriefing().observations[0].text)).toBeVisible();
  });

  it("clears the previous answer before a retry and retains only the failed run's evidence", async () => {
    const failed = makeBriefing(); failed.status = "unavailable"; failed.engine = "unavailable";
    failed.observations = []; failed.limitations = []; failed.unknowns = [];
    failed.failure = { code: "provider_unavailable", message: "The model is unavailable.", retryable: true };
    failed.evidence!.packet_id = "b".repeat(64);
    const next = pending(); generate.mockResolvedValueOnce(makeBriefing()).mockReturnValueOnce(next.promise);
    render(<ComparisonBriefingPanel selection={briefingSelection} />);
    clickGenerate(); await screen.findByText(makeBriefing().observations[0].text);
    fireEvent.click(screen.getByRole("button", { name: "Generate new briefing" }));
    expect(screen.queryByText(makeBriefing().observations[0].text)).not.toBeInTheDocument();
    expect(screen.queryByText(/Snapshot ID/)).not.toBeInTheDocument();
    await act(async () => next.resolve(failed));
    expect(screen.getByRole("alert")).toHaveTextContent("The model is unavailable");
    expect(screen.queryByRole("region", { name: "Observed movement" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Inspect briefing evidence snapshot/));
    expect(screen.getByText(`Snapshot ID: ${"b".repeat(64)}`)).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry briefing" })).toBeEnabled();
  });

  it("handles transport failure without a partial answer or automatic retry", async () => {
    generate.mockRejectedValue(new Error("The briefing stream ended before completion."));
    render(<ComparisonBriefingPanel selection={briefingSelection} />); clickGenerate();
    expect(await screen.findByRole("alert")).toHaveTextContent("ended before completion");
    expect(screen.queryByText(/Inspect briefing evidence/)).not.toBeInTheDocument();
    expect(generate).toHaveBeenCalledOnce();
  });

  it("keeps stale, mixed, unknown-unit and withheld-close caveats visible with unavailable pairs", async () => {
    const value = makeBriefing(); const pair = value.evidence!.comparisons[0];
    pair.returns!.freshness = "stale"; pair.pair_reported_basis_status = "mixed_reported";
    pair.anchor.withheld_provider_close_count = 2;
    pair.caveats.push("stale_history", "mixed_reported_price_basis", "unknown_quote_unit", "withheld_conflicting_closes");
    value.evidence!.status = "partial";
    value.evidence!.comparisons.push({ ...pair, citation_id: "P2", status: "unavailable",
      comparison: { ...pair.comparison, symbol: "QQQ" }, returns: null, reason: "missing_history",
      caveats: ["native_quote_not_fx_normalized", "utc_dates_not_simultaneous_sessions", "no_causal_or_investment_conclusion", "comparison_unavailable"],
    });
    value.unknowns.push({ text: "No QQQ comparison return was calculated.", citation_ids: ["P2"] });
    generate.mockResolvedValue(value);
    render(<ComparisonBriefingPanel selection={{ ...briefingSelection, comparisons: ["SPY", "QQQ"] }} />);
    clickGenerate();
    const warnings = await screen.findByLabelText("Mandatory evidence caveats");
    expect(warnings).toBeVisible();
    expect(warnings).toHaveTextContent("History is stale");
    expect(warnings).toHaveTextContent("Reported price bases differ");
    expect(warnings).toHaveTextContent("unknown quote unit");
    expect(warnings).toHaveTextContent("Conflicting closes were withheld");
    expect(warnings).toHaveTextContent("not a zero return");
    fireEvent.click(screen.getByRole("button", { name: "Inspect P2 for unknowns 2" }));
    expect(screen.getByRole("region", { name: "P2 evidence" })).toHaveTextContent("Return unavailable: missing history. No zero return is implied.");
  });

  it("handles evidence preparation failure without assuming a snapshot exists", async () => {
    const value = makeBriefing(); value.status = "unavailable"; value.engine = "unavailable";
    value.evidence = null; value.observations = []; value.limitations = []; value.unknowns = [];
    value.failure = { code: "evidence_timed_out", message: "Evidence preparation timed out.", retryable: true };
    generate.mockResolvedValue(value);
    render(<ComparisonBriefingPanel selection={briefingSelection} />); clickGenerate();
    expect(await screen.findByRole("alert")).toHaveTextContent("Evidence preparation timed out");
    expect(screen.queryByText(/Inspect briefing evidence/)).not.toBeInTheDocument();
  });

  it("invalidates and aborts when selection changes or the panel unmounts", async () => {
    const old = pending(); generate.mockReturnValue(old.promise);
    const { rerender, unmount } = render(<ComparisonBriefingPanel selection={briefingSelection} />);
    clickGenerate(); const oldSignal = generate.mock.calls[0][1]!.signal!;
    rerender(<ComparisonBriefingPanel selection={{ ...briefingSelection, anchor: "MSFT" }} />);
    expect(oldSignal.aborted).toBe(true);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await act(async () => old.resolve(makeBriefing()));
    expect(screen.queryByText(makeBriefing().observations[0].text)).not.toBeInTheDocument();
    generate.mockReturnValue(pending().promise); clickGenerate();
    const signal = generate.mock.calls[1][1]!.signal!; unmount();
    expect(signal.aborted).toBe(true);
  });

  it("disables generation while the selection is unapplied", () => {
    render(<ComparisonBriefingPanel selection={briefingSelection} disabledReason="Apply your selection first." />);
    expect(screen.getByRole("button", { name: "Generate briefing" })).toBeDisabled();
    expect(screen.getByText("Apply your selection first.")).toBeVisible();
    expect(generate).not.toHaveBeenCalled();
  });

  it("includes only explicitly checked context and navigates exact headline/series/scope citations", async () => {
    const value = makeContextBriefing();
    if (value.evidence!.sections[0].kind === "headlines") value.evidence!.sections[0].groups[0].headlines[0].title = "<img src=x onerror=alert(1)> Untrusted title";
    generateContext.mockResolvedValue(value);
    const { container } = render(<ComparisonBriefingPanel selection={briefingSelection} />);
    for (const label of ["Dated news headlines", "US macro (FRED)", "Euro-area macro (Eurostat/ECB)"]) {
      expect(screen.getByRole("checkbox", { name: label })).not.toBeChecked();
      fireEvent.click(screen.getByRole("checkbox", { name: label }));
    }
    expect(generateContext).not.toHaveBeenCalled();
    clickGenerate();
    expect(await screen.findByRole("region", { name: "Possible context" })).toBeVisible();
    expect(generate).not.toHaveBeenCalled();
    expect(generateContext.mock.calls[0][1]).toEqual({ news: true, macro_regions: ["us", "euro_area"] });
    expect(screen.getByRole("region", { name: "Selected context coverage" })).toHaveTextContent("C3");
    fireEvent.click(screen.getByRole("button", { name: "Inspect C1G1H1 for possible context 1" }));
    const headline = screen.getByRole("region", { name: "C1G1H1 evidence" });
    expect(headline).toHaveFocus();
    expect(headline).toHaveTextContent("<img src=x onerror=alert(1)> Untrusted title");
    expect(container.querySelector("img")).toBeNull();
    expect(within(headline).getByRole("link", { name: "Open source headline" })).toHaveAttribute("rel", "noopener noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "Inspect C2S1 for possible context 2" }));
    const series = screen.getByRole("region", { name: "C2S1 evidence" });
    expect(series).toHaveFocus();
    expect(series).toHaveTextContent("3.123456789");
    expect(series).toHaveTextContent("Conflicting observations withheld 2");
    fireEvent.click(screen.getByRole("button", { name: "Inspect C3S1 for possible context 3" }));
    expect(screen.getByRole("region", { name: "C3S1 evidence" })).toHaveTextContent("source flag p");
    fireEvent.click(screen.getByRole("button", { name: "Inspect SCOPE for unknowns 1" }));
    expect(screen.getByRole("region", { name: "SCOPE evidence" })).toHaveFocus();
    expect(screen.getByText(`Snapshot ID: ${value.evidence!.packet_id}`)).toBeVisible();
    expect(screen.getByText(/Price subpacket ID:/)).toBeVisible();
    expect(screen.getByRole("region", { name: "SCOPE evidence" })).not.toHaveTextContent("Not included (not evidence of absence): News headlines");
  });

  it("scope changes abort old work and clear answers without automatic generation", async () => {
    let resolve!: (result: ContextBriefingResult) => void;
    generateContext.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const old = pending(); generate.mockReturnValue(old.promise);
    render(<ComparisonBriefingPanel selection={briefingSelection} />);
    clickGenerate();
    const priceSignal = generate.mock.calls[0][1]!.signal!;
    fireEvent.click(screen.getByRole("checkbox", { name: "Dated news headlines" }));
    expect(priceSignal.aborted).toBe(true);
    expect(generateContext).not.toHaveBeenCalled();
    clickGenerate();
    const options = generateContext.mock.calls[0][2]!;
    act(() => options.onProgress!("collecting_context"));
    expect(screen.getByRole("status")).toHaveTextContent("Collecting selected dated context");
    fireEvent.click(screen.getByRole("checkbox", { name: "US macro (FRED)" }));
    expect(options.signal!.aborted).toBe(true);
    await act(async () => { resolve(makeContextBriefing({ news: true, macro_regions: [] })); old.resolve(makeBriefing()); options.onProgress!("generating"); });
    expect(screen.queryByRole("region", { name: "Possible context" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Snapshot ID:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    generateContext.mockResolvedValue(makeContextBriefing({ news: true, macro_regions: ["us"] }));
    clickGenerate();
    await screen.findByRole("region", { name: "Possible context" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Dated news headlines" }));
    expect(screen.queryByRole("region", { name: "Possible context" })).not.toBeInTheDocument();
    expect(generateContext).toHaveBeenCalledTimes(2);
  });

  it.each(["missing_api_key", "timed_out", "provider_error", "empty", "no_price_window"])("retains visible context coverage when %s and does not imply absence", async (reason) => {
    const value = makeContextBriefing({ news: false, macro_regions: ["us"] });
    const section = value.evidence!.sections[0];
    section.status = reason === "empty" ? "empty" : reason === "no_price_window" ? "no_price_window" : "unavailable";
    section.reason = reason === "empty" ? null : reason;
    if (section.kind === "macro") section.series = [];
    value.possible_context = [];
    generateContext.mockResolvedValue(value);
    render(<ComparisonBriefingPanel selection={briefingSelection} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "US macro (FRED)" })); clickGenerate();
    const coverage = await screen.findByRole("region", { name: "Selected context coverage" });
    expect(coverage).toBeVisible();
    expect(coverage).toHaveTextContent("Missing, empty or failed feeds do not establish");
    expect(coverage).toHaveTextContent(reason === "missing_api_key" ? "Provider key not configured" : reason === "timed_out" ? "Source deadline reached" : reason === "empty" ? "No returned matches" : reason === "no_price_window" ? "No shared price window" : "Provider failed");
    expect(screen.getByText(/No possible context was generated/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Inspect C1 coverage" }));
    expect(screen.getByRole("region", { name: "C1 evidence" })).toHaveFocus();
    expect(screen.getByRole("region", { name: "Observed movement" })).toBeVisible();
  });

  it("model failure retains selected context but clears old interpretation", async () => {
    const value = makeContextBriefing({ news: true, macro_regions: [] });
    value.status = "unavailable"; value.engine = "unavailable";
    value.observations = []; value.possible_context = []; value.limitations = []; value.unknowns = [];
    value.failure = { code: "invalid_response", message: "The response failed validation.", retryable: true };
    generateContext.mockResolvedValue(value);
    render(<ComparisonBriefingPanel selection={briefingSelection} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Dated news headlines" })); clickGenerate();
    expect(await screen.findByRole("alert")).toHaveTextContent("failed validation");
    expect(screen.getByRole("region", { name: "Selected context coverage" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Possible context" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Inspect C1 coverage" }));
    expect(screen.getByRole("region", { name: "C1G1H1 evidence" })).toBeVisible();
  });
});
