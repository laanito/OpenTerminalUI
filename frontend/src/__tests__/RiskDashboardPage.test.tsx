/** @vitest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { RiskDashboardPage } from "../pages/RiskDashboard";
import { StressTestPanel } from "../components/risk/StressTestPanel";
const mocks = vi.hoisted(() => Object.fromEntries(["fetchRiskSummary","fetchRiskExposures","fetchRiskCorrelation","fetchSectorConcentration","fetchRiskInsights","fetchFactorExposures","fetchFactorAttribution","fetchFactorHistory","fetchFactorReturns","fetchPredefinedStressScenarios","fetchStressScenarioHistory","runStressScenario","runStressMonteCarlo"].map(key => [key,vi.fn()])));
vi.mock("../api/client", () => mocks);
vi.mock("../store/stockStore", () => ({ useStockStore: (selector: any) => selector({ ticker: "AAPL" }) }));
vi.mock("../components/terminal/AiInsightCard", () => ({ AiInsightCard: () => <div>On-demand risk model</div> }));
vi.mock("recharts", () => {
  const Container = ({ children }: any) => <div>{children}</div>;
  return { ResponsiveContainer: Container, BarChart: Container, ComposedChart: Container, LineChart: Container, AreaChart: Container, PieChart: Container, Bar: () => null, Line: () => null, Area: () => null, Pie: () => null, Cell: () => null, ErrorBar: () => null, Legend: () => null, ReferenceLine: () => null, CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null };
});
const impact = { scenario_name: "Historic scenario", total_impact_pct: -.2, total_impact_value: -20, by_holding: [], by_sector: [], worst_holdings: [] };
beforeEach(() => {
  Object.values(mocks).forEach(mock => { mock.mockReset(); mock.mockResolvedValue({}); });
  mocks.fetchRiskSummary.mockResolvedValue({ ewma_vol: 0, beta: null, marginal_contribution: { ZERO: 0 } });
  mocks.fetchRiskExposures.mockResolvedValue({ pca_factors: [{ factor: "PC1", variance_explained: .7 }] });
  mocks.fetchRiskCorrelation.mockResolvedValue({ assets: ["ZERO","MISSING"], matrix: [[1,null],[0,1]] });
  mocks.fetchSectorConcentration.mockResolvedValue({ sectors: { "Long classification name": 100 } });
  mocks.fetchPredefinedStressScenarios.mockResolvedValue([{ id: "gfc_2008", name: "Historic scenario", description: "A retained scenario", severity: "extreme", shocks: { equity: -.2 } }]);
  mocks.fetchStressScenarioHistory.mockResolvedValue([]);
  mocks.runStressScenario.mockResolvedValue(impact);
  mocks.runStressMonteCarlo.mockResolvedValue({ percentiles: { p5: -.2, p25: -.1, p50: 0, p75: .1, p95: .2 }, paths: [[0,.1],[0,-.1]], worst_case: -.2, best_case: .2 });
});
it("keeps missing metrics/correlation distinct from numeric zeros", async () => {
  render(<RiskDashboardPage />);
  const summary = screen.getByRole("region", { name: "Statistical risk metrics", exact: true });
  expect(await within(summary).findByText("0.00%")).toBeInTheDocument(); expect(within(summary).getByText("Unavailable")).toBeInTheDocument();
  const matrix = await screen.findByRole("region", { name: "Risk correlation matrix" }); expect(within(matrix).getByRole("rowheader", { name: "ZERO" })).toBeInTheDocument(); expect(within(matrix).getByText("0.00")).toBeInTheDocument(); expect(within(matrix).getByText("Unavailable")).toBeInTheDocument();
  expect(mocks.fetchRiskInsights).not.toHaveBeenCalled();
});
it("retains successful independent reads when another panel fails", async () => {
  mocks.fetchRiskSummary.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER")); render(<RiskDashboardPage />);
  const summary = screen.getByRole("region", { name: "Statistical risk metrics", exact: true }); await within(summary).findByRole("alert");
  expect(await screen.findByRole("region", { name: "PCA variance values" })).toBeInTheDocument(); expect(screen.queryByText(/PRIVATE_PROVIDER/)).not.toBeInTheDocument();
  fireEvent.click(within(summary).getByRole("button", { name: "Refresh Statistical risk metrics" })); await within(summary).findByText("0.00%"); expect(mocks.fetchRiskExposures).toHaveBeenCalledTimes(1);
});
it("applies a ticker draft explicitly and ignores late reads for the previous ticker", async () => {
  let release!: (data: unknown) => void;
  mocks.fetchRiskSummary.mockImplementation((ticker?: string) => ticker === "AAPL" ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ ewma_vol: .1, beta: 2, marginal_contribution: {} }));
  render(<RiskDashboardPage />); await screen.findByText("10.00%");
  fireEvent.change(screen.getByRole("combobox", { name: "Risk scope" }), { target: { value: "ticker" } }); await waitFor(() => expect(release).toBeDefined());
  fireEvent.change(screen.getByRole("textbox", { name: "Risk ticker" }), { target: { value: "MSFT" } }); expect(mocks.fetchRiskSummary).not.toHaveBeenCalledWith("MSFT");
  fireEvent.submit(screen.getByRole("form", { name: "Risk overview scope" })); await screen.findByText(/MSFT and peers/);
  await act(async () => release({ ewma_vol: .99, beta: 99, marginal_contribution: {} })); expect(screen.queryByText("99.00%")).not.toBeInTheDocument();
});
it("does not invent a style position or attribution waterfall for missing factors", async () => {
  mocks.fetchFactorExposures.mockResolvedValue({ exposures: { market: { exposure: 0 } } }); mocks.fetchFactorAttribution.mockResolvedValue({ total_return: 0, alpha: null, factor_contributions: { market: 0 } });
  render(<RiskDashboardPage />); fireEvent.click(screen.getByRole("button", { name: "Factor attribution", exact: true }));
  await screen.findByText(/Style unavailable/); await screen.findByText(/Attribution is incomplete/); expect(screen.queryByTestId("factor-style-box")).not.toBeInTheDocument(); expect(screen.queryByTestId("factor-waterfall-chart")).not.toBeInTheDocument();
});
it("keeps a completed scenario if the independent simulation or history read fails", async () => {
  mocks.runStressMonteCarlo.mockRejectedValueOnce(new Error("PRIVATE_SIMULATION")); mocks.fetchStressScenarioHistory.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("PRIVATE_HISTORY"));
  render(<StressTestPanel />); await within(screen.getByRole("form", { name: "Stress scenario setup" })).findByText("A retained scenario"); fireEvent.click(screen.getByRole("button", { name: "Run scenario", exact: true }));
  await screen.findByText("-20.00%"); await screen.findByText(/Simulation unavailable/); fireEvent.click(screen.getByText("Service run history", { exact: true })); await screen.findByText(/Could not load run history/);
  expect(screen.queryByText(/PRIVATE_/)).not.toBeInTheDocument(); expect(mocks.runStressScenario).toHaveBeenCalledTimes(1);
});
it("captures custom shock units, guards duplicate submissions and locks setup while pending", async () => {
  let release!: (data: unknown) => void; mocks.runStressScenario.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  render(<StressTestPanel />); await within(screen.getByRole("form", { name: "Stress scenario setup" })).findByText("A retained scenario"); fireEvent.change(screen.getByRole("combobox", { name: "Scenario", exact: true }), { target: { value: "custom" } });
  fireEvent.change(screen.getByRole("slider", { name: "Interest Rates shock" }), { target: { value: "125" } });
  const form = screen.getByRole("form", { name: "Stress scenario setup" }); fireEvent.submit(form); fireEvent.submit(form);
  await waitFor(() => expect(mocks.runStressScenario).toHaveBeenCalledTimes(1)); expect(mocks.runStressScenario).toHaveBeenCalledWith({ portfolio_id: "current", custom_shocks: { equity: -.2, rates: .0125, volatility: .1, fx_inr: 0, gold: 0, crude_oil: 0 } });
  expect(screen.getByRole("combobox", { name: "Scenario", exact: true })).toBeDisabled(); expect(screen.getByRole("slider", { name: "Interest Rates shock" })).toBeDisabled();
  await act(async () => release({ ...impact, scenario_name: "Custom Scenario" })); await screen.findByRole("button", { name: "Run scenario", exact: true }); expect(screen.getByRole("combobox", { name: "Scenario", exact: true })).toBeEnabled();
});
it("reports ambiguous scenario failures without automatically repeating the recorded operation", async () => {
  mocks.runStressScenario.mockRejectedValueOnce(new Error("PRIVATE_SCENARIO")); render(<StressTestPanel />); await within(screen.getByRole("form", { name: "Stress scenario setup" })).findByText("A retained scenario"); fireEvent.click(screen.getByRole("button", { name: "Run scenario", exact: true }));
  await screen.findByText(/request may have completed/); expect(mocks.runStressScenario).toHaveBeenCalledTimes(1); expect(screen.queryByText(/PRIVATE_SCENARIO/)).not.toBeInTheDocument(); expect(screen.getByText("P50 terminal return")).toBeInTheDocument();
});

it("does not let an old history read overwrite the refresh after a confirmed run", async () => {
  let release!: (data: unknown) => void;
  mocks.fetchStressScenarioHistory.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValueOnce([{ id: "confirmed", scenario_name: "Confirmed run", run_date: "2026-11-25", total_impact_pct: -.2 }]);
  render(<StressTestPanel />); await within(screen.getByRole("form", { name: "Stress scenario setup" })).findByText("A retained scenario");
  fireEvent.click(screen.getByRole("button", { name: "Run scenario", exact: true })); fireEvent.click(screen.getByText("Service run history", { exact: true }));
  await screen.findByText("Confirmed run"); await act(async () => release([])); expect(screen.getByText("Confirmed run")).toBeInTheDocument(); expect(mocks.runStressScenario).toHaveBeenCalledTimes(1);
});
