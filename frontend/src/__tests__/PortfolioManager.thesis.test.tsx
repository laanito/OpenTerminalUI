import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PortfolioManager } from "../components/portfolio/PortfolioManager";

const api = vi.hoisted(() => ({ holdings: vi.fn(), analytics: vi.fn(), risk: vi.fn(), correlation: vi.fn(), dividends: vi.fn(), benchmark: vi.fn() }));
vi.mock("../api/client", () => ({ fetchPortfolioHoldings: api.holdings, fetchPortfolioAnalyticsV2: api.analytics, fetchPortfolioRiskMetrics: api.risk, fetchPortfolioCorrelation: api.correlation, fetchPortfolioDividends: api.dividends, fetchPortfolioBenchmarkOverlay: api.benchmark }));
vi.mock("../components/PortfolioEventsCalendar", () => ({ PortfolioEventsCalendar: () => <div>Portfolio events</div> }));
vi.mock("../components/portfolio/RiskMetricsPanel", () => ({ RiskMetricsPanel: ({ metrics }: any) => <div data-testid="risk">{JSON.stringify(metrics)}</div> }));
vi.mock("../components/portfolio/PortfolioRiskAssessment", () => ({ PortfolioRiskAssessment: (props: any) => <div data-testid="ai-scope">{JSON.stringify(props)}</div> }));
vi.mock("../components/portfolio/CorrelationHeatmap", () => ({ CorrelationHeatmap: () => null }));
vi.mock("../components/portfolio/DividendTracker", () => ({ DividendTracker: () => null }));
vi.mock("../components/portfolio/BenchmarkOverlayChart", () => ({ BenchmarkOverlayChart: () => null }));
vi.mock("../components/portfolio/BacktestResults", () => ({ BacktestResults: () => null }));
vi.mock("../components/portfolio/AttributionPanel", () => ({ AttributionPanel: () => null }));
const core = { id: "p1", name: "Core", currency: "USD", benchmark_symbol: "SPY" };
const other = { id: "p2", name: "Europe", currency: "EUR", benchmark_symbol: "MSCIWI" };
beforeEach(() => {
  vi.resetAllMocks();
  api.holdings.mockResolvedValue([{ id: "h", symbol: "AAPL", shares: 2 }]);
  api.analytics.mockResolvedValue({ allocation_by_sector: [{ name: "Technology", value: 100 }], annualized_return: null });
  api.risk.mockResolvedValue({ sharpe_ratio: .8 }); api.correlation.mockResolvedValue({ matrix: [[1]] });
  api.dividends.mockResolvedValue(null); api.benchmark.mockResolvedValue(null);
});

it("uses only the page-selected account without another selector, holdings table or creation form", async () => {
  render(<PortfolioManager portfolio={other} />);
  await screen.findByTestId("ai-scope");
  expect(api.holdings).toHaveBeenCalledWith("p2");
  expect(api.risk).toHaveBeenCalledWith({ benchmark: "MSCIWI", risk_free_rate: .04 }, "p2");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Add Portfolio|Create portfolio/ })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Analysis · Europe" })).toBeInTheDocument();
});

it("keeps held-symbol and backend exposure inputs available to explicit AI assessment", async () => {
  render(<PortfolioManager portfolio={core} />);
  await waitFor(() => expect(screen.getByTestId("ai-scope")).toHaveTextContent('"metricsAvailable":true'));
  const props = JSON.parse(screen.getByTestId("ai-scope").textContent!);
  expect(props).toMatchObject({ portfolioId: "p1", holdings: [{ symbol: "AAPL" }], metrics: { risk_metrics: { sharpe_ratio: .8 }, allocation_by_sector: [{ name: "Technology", value: 100 }], correlation: [[1]] } });
});

it("ignores late analytics for a scope the user has left", async () => {
  let finishRisk!: (value: unknown) => void;
  api.risk.mockImplementation((_params, id) => id === "p1" ? new Promise(resolve => { finishRisk = resolve; }) : Promise.resolve({ sharpe_ratio: 2 }));
  const { rerender } = render(<PortfolioManager portfolio={core} />);
  await waitFor(() => expect(finishRisk).toBeTypeOf("function"));
  rerender(<PortfolioManager portfolio={other} />);
  await waitFor(() => expect(screen.getByTestId("risk")).toHaveTextContent('"sharpe_ratio":2'));
  await act(async () => finishRisk({ sharpe_ratio: 99 }));
  expect(screen.getByTestId("risk")).toHaveTextContent('"sharpe_ratio":2');
  expect(screen.getByTestId("ai-scope")).toHaveTextContent('"portfolioId":"p2"');
});

it("hides prior data on a failed account switch and retries the selected account", async () => {
  const { rerender } = render(<PortfolioManager portfolio={core} />);
  await screen.findByTestId("ai-scope");
  api.holdings.mockRejectedValueOnce(new Error("offline"));
  rerender(<PortfolioManager portfolio={other} />);
  await screen.findByRole("alert", { name: "Portfolio analysis unavailable" });
  expect(screen.queryByTestId("ai-scope")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry analysis" }));
  await waitFor(() => expect(screen.getByTestId("ai-scope")).toHaveTextContent('"portfolioId":"p2"'));
  expect(api.holdings.mock.calls.slice(-2)).toEqual([["p2"], ["p2"]]);
});

it("retains manual AI technical context when optional risk providers fail", async () => {
  api.risk.mockRejectedValue(new Error("unavailable"));
  render(<PortfolioManager portfolio={core} />);
  await waitFor(() => expect(screen.getByTestId("ai-scope")).toHaveTextContent('"metricsAvailable":false'));
  expect(screen.getByTestId("ai-scope")).toHaveTextContent('"symbol":"AAPL"');
});
