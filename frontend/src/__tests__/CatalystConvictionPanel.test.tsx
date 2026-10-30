import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatalystConvictionPanel } from "../components/dashboard/CatalystConvictionPanel";
import { fetchSecurityConviction } from "../api/conviction";

vi.mock("../api/conviction", () => ({ fetchSecurityConviction: vi.fn() }));
const fetchReport = vi.mocked(fetchSecurityConviction);
const profile = { requested_profile: "deep", resolved_profile: "deep", model: "deep-model" } as const;

describe("saved filing extraction provenance", () => {
  beforeEach(() => { fetchReport.mockReset(); });
  it("shows the saved Deep identity", async () => {
    fetchReport.mockResolvedValue({ symbol: "AAPL", engine: "llm", source_count: 1, conviction_score: 60, summary: "Saved analysis", model_profile: profile });
    render(<CatalystConvictionPanel symbol="AAPL" />);
    expect(await screen.findByText(/Model extraction · Deep profile · deep-model/)).toBeVisible();
  });
  it("clearly labels lexical fallback and never claims the selected model generated it", async () => {
    fetchReport.mockResolvedValue({ symbol: "AAPL", engine: "lexical", source_count: 1, summary: "Lexical extraction", model_profile: profile,
      failure: { code: "timeout", message: "Model extraction timed out.", retryable: true } });
    render(<CatalystConvictionPanel symbol="AAPL" />);
    expect(await screen.findByText("The selected model did not generate this report.")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("timeout");
    expect(screen.queryByText(/^Model extraction ·/)).not.toBeInTheDocument();
  });
  it("leaves legacy model provenance unknown", async () => {
    fetchReport.mockResolvedValue({ symbol: "OLD", engine: "lmstudio", summary: "Old report" });
    render(<CatalystConvictionPanel symbol="OLD" />);
    expect(await screen.findByText("Legacy report · model provenance unknown")).toBeVisible();
    expect(screen.queryByText(/Deep profile/)).not.toBeInTheDocument();
  });
  it("does not present a zero-source heuristic as a measured bullish score", async () => {
    fetchReport.mockResolvedValue({ symbol: "EMPTY", engine: "lexical", source_count: 0, conviction_score: 50, summary: "No sources" });
    render(<CatalystConvictionPanel symbol="EMPTY" />);
    await screen.findByText("No sources");
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
  });
});
