import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PortfolioRiskAssessment } from "../components/portfolio/PortfolioRiskAssessment";
import { portfolioInsight } from "./fixtures/portfolioTechnicalContext";
const fetchRisk = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ fetchAiRiskInsights: fetchRisk }));
const holdings = ["AAPL", "BTC-USD", "SPY", "QQQ"].map((symbol, index) => ({ id: `h${index}`, symbol, shares: 1, cost_basis_per_share: 1, purchase_date: "2026-01-01" }));
const props = { portfolioId: "p1", holdings, metrics: { sharpe_ratio: 1 }, disabled: false };
describe("portfolio risk technical selection and inspection", () => {
  beforeEach(() => { fetchRisk.mockReset(); fetchRisk.mockResolvedValue(portfolioInsight()); });
  it("allows selected technical evidence when portfolio risk metrics are missing", () => {
    render(<PortfolioRiskAssessment {...props} metrics={{ risk_metrics: {} }} metricsAvailable={false} />);
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "AAPL", exact: true }));
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
    expect(fetchRisk).not.toHaveBeenCalled();
  });
  it("requires explicit selection, caps it at three, and inspects exact per-holding evidence", async () => {
    render(<PortfolioRiskAssessment {...props} />);
    expect(fetchRisk).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "AAPL", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "BTC-USD", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "SPY", exact: true }));
    expect(screen.getByRole("button", { name: "QQQ", exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "SPY", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(fetchRisk).toHaveBeenCalledWith(props.metrics, "portfolio", expect.any(Object), { portfolioId: "p1", symbols: ["AAPL", "BTC-USD"] }));
    fireEvent.click(await screen.findByRole("button", { name: "Inspect H2.1 technical evidence" }));
    expect(screen.getByRole("region", { name: "H2.1 technical evidence" })).toHaveFocus();
    expect(screen.getByText(/Selected holdings · 2 of 4/)).toBeVisible();
    expect(screen.getByText(/Coverage counts symbols, not portfolio value/)).toBeVisible();
    expect(screen.getByText(/BTC-USD · recorded quantity 0.4/)).toHaveTextContent("cost currencies unknown");
    fireEvent.click(screen.getByRole("button", { name: "BTC-USD", exact: true }));
    expect(screen.queryByRole("region", { name: "Portfolio technical evidence" })).not.toBeInTheDocument();
    expect(fetchRisk).toHaveBeenCalledOnce();
  });
  it("cancels work and clears results when the holding scope changes", async () => {
    let signal!: AbortSignal;
    fetchRisk.mockImplementation((_m, _s, options) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError"))));
    });
    render(<PortfolioRiskAssessment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "AAPL", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(fetchRisk).toHaveBeenCalledOnce());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "BTC-USD", exact: true })));
    expect(signal.aborted).toBe(true); expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
  });
  it("keeps evidence inspectable after model failure and invalidates it on refreshed metrics", async () => {
    fetchRisk.mockResolvedValue(portfolioInsight("modelFailure"));
    const view = render(<PortfolioRiskAssessment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "AAPL", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "BTC-USD", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByRole("region", { name: "Portfolio technical evidence" })).toBeVisible();
    view.rerender(<PortfolioRiskAssessment {...props} metrics={{ sharpe_ratio: 2 }} />);
    expect(screen.queryByRole("region", { name: "Portfolio technical evidence" })).not.toBeInTheDocument();
  });
});
