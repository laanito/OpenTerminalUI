import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { frameworkModels, frameworkResult, optimizerMethods, optimizerResult, governanceRows } from "../../tests/e2e/fixtures/research-workflows";
const api = vi.hoisted(() => ({ models: vi.fn(), framework: vi.fn(), methods: vi.fn(), optimize: vi.fn(), register: vi.fn(), compare: vi.fn(), promote: vi.fn() }));
vi.mock("../api/framework", () => ({ fetchFrameworkModels: api.models, runFrameworkBacktest: api.framework }));
vi.mock("../api/portfolioOptimizer", () => ({ fetchOptimizerMethods: api.methods, runOptimize: api.optimize }));
vi.mock("../api/client", () => ({ registerGovernanceRun: api.register, compareGovernanceRuns: api.compare, promoteGovernanceModel: api.promote }));
vi.mock("recharts", () => { const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>; return Object.fromEntries(["CartesianGrid", "Cell", "Legend", "Line", "LineChart", "ResponsiveContainer", "Scatter", "ScatterChart", "Tooltip", "XAxis", "YAxis", "ZAxis"].map(name => [name, Stub])); });
import { AlgorithmFrameworkLab } from "../pages/AlgorithmFrameworkLab";
import { PortfolioOptimizer } from "../pages/PortfolioOptimizer";
import { ModelGovernancePage } from "../pages/ModelGovernance";
function mount(node: React.ReactNode) { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); return render(<QueryClientProvider client={client}><MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>{node}</MemoryRouter></QueryClientProvider>); }
beforeEach(() => { vi.resetAllMocks(); api.models.mockResolvedValue(frameworkModels); api.methods.mockResolvedValue(optimizerMethods); api.framework.mockResolvedValue(frameworkResult); api.optimize.mockResolvedValue(optimizerResult); api.register.mockResolvedValue({ status: "updated" }); api.compare.mockResolvedValue(governanceRows); api.promote.mockResolvedValue({ status: "ok" }); });
const button = (name: string) => screen.getByRole("button", { name, exact: true });
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
describe("Framework submitted simulations", () => {
  it("preserves default payload and captured scope across later edits", async () => {
    mount(<AlgorithmFrameworkLab />); await waitFor(() => expect(button("Run Backtest")).toBeEnabled()); fireEvent.click(button("Run Backtest")); await screen.findByText("Equity Curve Simulation");
    expect(api.framework).toHaveBeenCalledWith({ tickers: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"], start: null, end: null, benchmark: "^GSPC", rebalance_freq: "ME", initial_cash: 1000000, transaction_cost_bps: 10, top_n: 10, long_only: true, alpha: { id: "momentum", params: { lookback_days: 63 } }, portfolio_construction: { id: "equal", params: {} }, risk: [] });
    change("Universe (Tickers)", "BTC-USD"); change("Alpha model", "mean_reversion"); expect(screen.getByRole("region", { name: "Submitted framework setup" })).toHaveTextContent("AAPL, MSFT, GOOGL, AMZN, NVDA");
    expect(screen.getByRole("region", { name: "Framework signal values" })).toHaveTextContent("Flat"); expect(screen.getByText(/Benchmark metrics are unavailable/)).toBeInTheDocument();
  });
  it("loads model defaults and fractional risk/cost parameters without truncating them", async () => {
    mount(<AlgorithmFrameworkLab />); await waitFor(() => expect(button("Run Backtest")).toBeEnabled()); change("Alpha model", "mean_reversion"); change("Mean Reversion Alpha · Entry threshold", ".75");
    fireEvent.click(screen.getByText(/Risk overlays ·/)); fireEvent.click(button("Maximum Drawdown Risk")); change("Maximum Drawdown Risk · Max Drawdown (fraction)", ".125"); change("Transaction costs (bps)", "2.5"); fireEvent.click(button("Run Backtest")); await screen.findByText("Equity Curve Simulation");
    expect(api.framework.mock.calls[0][0]).toMatchObject({ transaction_cost_bps: 2.5, alpha: { id: "mean_reversion", params: { z_entry: .75 } }, risk: [{ id: "max_drawdown", params: { max_drawdown: .125 } }] });
  });
  it("retains failed drafts, clears old results and prevents invalid integer parameters", async () => {
    mount(<AlgorithmFrameworkLab />); await waitFor(() => expect(button("Run Backtest")).toBeEnabled()); change(`${frameworkModels.alpha[0].label} · Lookback days`, "2.5"); expect(button("Run Backtest")).toBeDisabled(); change(`${frameworkModels.alpha[0].label} · Lookback days`, "63"); fireEvent.click(button("Run Backtest")); await screen.findByText("Equity Curve Simulation"); api.framework.mockRejectedValueOnce(new Error("Failed research")); fireEvent.click(button("Run Backtest")); await screen.findByRole("alert"); expect(screen.queryByText("Equity Curve Simulation")).not.toBeInTheDocument(); expect(screen.getByLabelText("Universe (Tickers)")).toHaveValue("AAPL,MSFT,GOOGL,AMZN,NVDA");
  });
  it("handles an unavailable catalogue with an explicit retry", async () => {
    api.models.mockRejectedValueOnce(new Error("Unavailable")); mount(<AlgorithmFrameworkLab />); await screen.findByRole("alert"); fireEvent.click(button("Retry model catalogue")); await waitFor(() => expect(button("Run Backtest")).toBeEnabled()); expect(api.models).toHaveBeenCalledTimes(2);
  });
});
describe("Optimizer result scope and complete weights", () => {
  it("preserves its existing request defaults and displays negative/small/zero weights", async () => {
    mount(<PortfolioOptimizer />); await waitFor(() => expect(button("Run Optimize")).toBeEnabled()); fireEvent.click(button("Run Optimize")); await screen.findByText("Optimal Allocation");
    expect(api.optimize).toHaveBeenCalledWith({ tickers: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META"], start: null, end: null, model: "Classic", objective: "max_sharpe", risk_measure: "MV", cov_method: "sample", confidence: .95, risk_free_rate: 0, risk_aversion: 2, min_weight: 0, max_weight: 1 });
    const allocation = screen.getByRole("region", { name: "Optimizer allocation values" }); expect(allocation).toHaveTextContent("-25.000000%"); expect(allocation).toHaveTextContent("0.005000%"); expect(allocation).toHaveTextContent("0.000000%"); expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    change("Model", "HRP"); expect(screen.getByLabelText("Objective", { exact: true })).toBeDisabled(); expect(screen.getByRole("region", { name: "Submitted optimizer setup" })).toHaveTextContent("model Classic");
  });
  it("labels confidence from submitted settings and validates fractional bounds", async () => {
    mount(<PortfolioOptimizer />); await waitFor(() => expect(button("Run Optimize")).toBeEnabled()); change("Confidence (fraction)", ".9"); change("Minimum weight (fraction)", "-.5"); fireEvent.click(button("Run Optimize")); await screen.findByText("CVaR · submitted confidence 90.0%"); change("Confidence (fraction)", ".99"); expect(screen.getByText("CVaR · submitted confidence 90.0%")).toBeInTheDocument(); change("Minimum weight (fraction)", "2"); expect(button("Run Optimize")).toBeDisabled();
  });
  it("clears failed results while retaining the edited universe", async () => {
    mount(<PortfolioOptimizer />); await waitFor(() => expect(button("Run Optimize")).toBeEnabled()); fireEvent.click(button("Run Optimize")); await screen.findByText("Optimal Allocation"); change("Universe (Tickers)", "BTC-USD,ETH-USD"); api.optimize.mockRejectedValueOnce(new Error("Unavailable")); fireEvent.click(button("Run Optimize")); await screen.findByRole("alert"); expect(screen.queryByText("Optimal Allocation")).not.toBeInTheDocument(); expect(screen.getByLabelText("Universe (Tickers)")).toHaveValue("BTC-USD,ETH-USD");
  });
  it("distinguishes an empty methods catalogue from request failure", async () => {
    api.methods.mockResolvedValueOnce({ models: [], objectives: [], risk_measures: [], covariance_methods: [] }); mount(<PortfolioOptimizer />); await screen.findByText("No usable models are available for this workflow."); expect(button("Run Optimize")).toBeDisabled(); expect(api.optimize).not.toHaveBeenCalled();
  });
});
describe("Independent governance actions", () => {
  it("labels write semantics and keeps receipts tied to submitted run IDs", async () => {
    mount(<ModelGovernancePage />); expect(button("Register run metadata")).toBeDisabled(); change("Run ID", " run-a "); fireEvent.click(button("Register run metadata")); await screen.findByText(/Metadata registered for run-a/); expect(api.register).toHaveBeenCalledWith({ run_id: "run-a", data_version_id: undefined, code_hash: undefined, execution_profile: {} }); change("Run ID", "run-b"); expect(screen.getByText(/Metadata registered for run-a/)).toBeInTheDocument(); fireEvent.click(screen.getByText("Staging registry", { exact: true })); fireEvent.click(button("Promote to staging")); await screen.findByText("Run run-b added to default-model · staging."); expect(api.promote).toHaveBeenCalledWith({ run_id: "run-b", registry_name: "default-model", stage: "staging" });
  });
  it("captures comparison IDs, shows returned rows and clears a failed refresh independently", async () => {
    mount(<ModelGovernancePage />); change("Run IDs to compare", " first,second "); fireEvent.click(button("Compare runs")); const table = await screen.findByRole("region", { name: "Governance run comparison" }); expect(api.compare).toHaveBeenCalledWith(["first", "second"]); expect(table).toHaveTextContent(governanceRows[0].code_hash); change("Run IDs to compare", "third"); expect(screen.getByText(/Submitted IDs: first, second/)).toBeInTheDocument(); api.compare.mockRejectedValueOnce(new Error("Read failed")); fireEvent.click(button("Compare runs")); await screen.findByRole("alert"); expect(screen.queryByRole("region", { name: "Governance run comparison" })).not.toBeInTheDocument(); expect(screen.getByLabelText("Run IDs to compare")).toHaveValue("third");
  });
  it("separates an empty comparison from write failures", async () => {
    api.compare.mockResolvedValueOnce([]); api.register.mockRejectedValueOnce(new Error("Write failed")); mount(<ModelGovernancePage />); change("Run ID", "run-a"); change("Run IDs to compare", "missing"); fireEvent.click(button("Compare runs")); await screen.findByText(/Returned 0 run/); fireEvent.click(button("Register run metadata")); await screen.findByRole("alert"); expect(screen.getByRole("region", { name: "Governance run comparison" })).toBeInTheDocument(); expect(screen.getByLabelText("Run ID", { exact: true })).toHaveValue("run-a");
  });
  it("does not relabel a delayed comparison when its draft changes", async () => {
    let resolve!: (value: unknown) => void; api.compare.mockImplementationOnce(() => new Promise(done => { resolve = done; })); mount(<ModelGovernancePage />); change("Run IDs to compare", "old-run"); fireEvent.click(button("Compare runs")); change("Run IDs to compare", "new-run"); await act(async () => resolve(governanceRows)); expect(screen.getByText(/Submitted IDs: old-run/)).toBeInTheDocument(); expect(within(screen.getByRole("region", { name: "Governance run comparison" })).getByText(governanceRows[0].id)).toBeInTheDocument();
  });
});
