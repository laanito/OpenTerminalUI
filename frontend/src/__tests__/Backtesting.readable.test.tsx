import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../tests/e2e/fixtures/backtest-result.json";
import { useStockStore } from "../store/stockStore";
import { useSettingsStore } from "../store/settingsStore";
const api = vi.hoisted(() => ({ submit: vi.fn(), status: vi.fn(), result: vi.fn() }));
vi.mock("../api/client", () => ({ explainBacktest: vi.fn(), fetchActiveDataVersion: vi.fn(async () => ({ id: "test-version" })), searchSymbols: vi.fn(async () => []), submitBacktestJob: api.submit, fetchBacktestJobStatus: api.status, fetchBacktestJobResult: api.result }));
vi.mock("../components/savedViews/SavedViewsControl", () => ({ SavedViewsControl: () => null }));
vi.mock("../components/terminal/AiInsightCard", () => ({ AiInsightCard: ({ description }: { description: string }) => <p>{description}</p> }));
vi.mock("../components/backtesting/panels/BacktestingPanels", () => {
  const Panel = () => <div>Result plot</div>;
  return Object.fromEntries(["ChartTabPanel", "ComparePanel", "DrawdownTerrain3DPanel", "DistributionPanel", "DrawdownPanel", "EquityCurvePanel", "MonthlyHeatmapPanel", "ParameterSurface3DPanel", "RegimeEfficacy3DPanel", "RollingMetricsPanel", "OrderbookLiquidity3DPanel", "ImpliedVolatilitySurface3DPanel", "VolatilitySurface3DPanel", "MonteCarloSimulationPanel", "TradesPanel"].map(key => [key, Panel]));
});
import { BacktestingPage } from "../pages/Backtesting";
function mount(strict = false) { const content = <MemoryRouter initialEntries={["/backtesting"]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><BacktestingPage /></MemoryRouter>; render(strict ? <StrictMode>{content}</StrictMode> : content); }
const run = () => fireEvent.click(screen.getByRole("button", { name: "Run", exact: true }));
const complete = () => screen.findByText("12.00%", {}, { timeout: 3500 });
beforeEach(() => {
  vi.clearAllMocks(); useStockStore.setState({ ticker: "AAPL" }); useSettingsStore.setState({ selectedMarket: "NASDAQ" });
  api.submit.mockResolvedValue(fixture.submit); api.status.mockResolvedValue(fixture.status); api.result.mockResolvedValue(fixture.result);
  vi.stubGlobal("fetch", vi.fn(async (input: string) => ({ ok: true, json: async () => input.endsWith("/analytics") ? fixture.analytics : { validation: { windows: [] }, optimization: { trials: [] } } })));
});
afterEach(() => vi.unstubAllGlobals());
describe("Backtesting readable submitted-run workflow", () => {
  it("keeps idle work compact and secondary configuration disclosed", async () => {
    mount(); expect(screen.getByRole("main", { name: "Backtesting workspace" })).toBeInTheDocument();
    expect(screen.queryByText("Backtest Performance")).not.toBeInTheDocument();
    expect(screen.getByText("Data and execution settings").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByLabelText("Commission (bps)")).toHaveValue(5);
    expect(screen.queryByText("Trade Blotter")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Data Version ID")).toHaveValue("test-version"));
  });
  it("retains submitted payload, identity, currency and AI label after setup edits", async () => {
    mount(); await waitFor(() => expect(screen.getByLabelText("Data Version ID")).toHaveValue("test-version")); run(); await complete();
    expect(api.submit).toHaveBeenCalledWith(expect.objectContaining({ symbol: "AAPL", market: "NASDAQ", timeframe: "1d", strategy: "example:sma_crossover", config: expect.objectContaining({ initial_cash: 100000, position_fraction: 1, data_version_id: "test-version", adjusted: true, execution_profile: { commission_bps: 5, slippage_model: "fixed_bps", slippage_bps: 3, spread_bps: 1, market_impact_bps: 0, volume_cap_pct: 10 } }) }));
    fireEvent.change(screen.getByLabelText("Asset (Ticker)"), { target: { value: "RELIANCE" } }); fireEvent.change(screen.getByLabelText("Market", { exact: true }), { target: { value: "NSE" } });
    fireEvent.change(screen.getByLabelText("Model", { exact: true }), { target: { value: "mean_reversion" } });
    expect(within(screen.getByRole("region", { name: "Submitted backtest" })).getByText(/AAPL · NASDAQ · SMA Crossover/)).toBeInTheDocument();
    expect(screen.getAllByText("$112,000.00").length).toBeGreaterThan(0); expect(screen.getByText(/SMA Crossover.*Review return/)).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/optimize"))).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/optimize"))?.[1]?.body).toContain('"symbol":"AAPL"');
  });
  it("preserves the setup and hides previous results after submission failure", async () => {
    mount(); run(); await complete(); api.submit.mockRejectedValueOnce(new Error("Submission failed")); run();
    await screen.findByRole("alert"); expect(screen.getByLabelText("Asset (Ticker)")).toHaveValue("AAPL");
    expect(screen.queryByText("Backtest Performance")).not.toBeInTheDocument(); expect(screen.getByText(/No completed result is shown/)).toBeInTheDocument();
  });
  it("shows a local analytics fallback and supports an independent retry", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!; let fail = true;
    vi.mocked(fetch).mockImplementation(async (...args) => { if (String(args[0]).endsWith("/analytics") && fail) throw new Error("Unavailable"); return original(...args); });
    mount(); run(); await complete(); await screen.findByText(/Server analytics unavailable/);
    fail = false; fireEvent.click(screen.getByRole("button", { name: "Retry analytics" })); await screen.findByText("Analytics returned for this run.");
    expect(api.submit).toHaveBeenCalledTimes(1);
  });
  it("ignores delayed analytics from the previous run", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!; let resolve!: (value: unknown) => void; let first = true;
    vi.mocked(fetch).mockImplementation(async (...args) => { if (String(args[0]).endsWith("/analytics") && first) { first = false; return await new Promise(r => { resolve = r; }) as Response; } return original(...args); });
    mount(); run(); await complete(); await waitFor(() => expect(resolve).toBeTypeOf("function"));
    api.submit.mockResolvedValueOnce({ ...fixture.submit, run_id: "new-run" }); run(); await complete(); await screen.findByText("Analytics returned for this run.");
    await act(async () => resolve({ ok: true, json: async () => ({ analytics: { ...fixture.analytics.analytics, trade_analytics: { ...fixture.analytics.analytics.trade_analytics, summary: { win_rate: 987 } } } }) }));
    expect(screen.queryByText("987.00%")).not.toBeInTheDocument();
  });
  it("restores saved setup and result-tab drafts without automatically submitting", async () => {
    localStorage.setItem("ot:saved-view:pending", JSON.stringify({ page: "/backtesting", filters: { asset: "MSFT", market: "NYSE", start: "2025-01-01", end: "2025-12-01", dataTimeframe: "1h", strategyMode: "mean_reversion" }, activeTabs: { activeTab: "equity" } }));
    mount(true); await waitFor(() => expect(screen.getByLabelText("Data Version ID")).toHaveValue("test-version"));
    expect(screen.getByLabelText("Asset (Ticker)")).toHaveValue("MSFT"); expect(screen.getByLabelText("Data interval")).toHaveValue("1h"); expect(screen.getByLabelText("Model", { exact: true })).toHaveValue("mean_reversion"); expect(api.submit).not.toHaveBeenCalled(); expect(localStorage.getItem("ot:saved-view:pending")).toBeNull();
    expect(screen.getByLabelText("Market", { exact: true })).toHaveValue("NYSE");
    act(() => useStockStore.setState({ ticker: "NVDA" })); expect(screen.getByLabelText("Asset (Ticker)")).toHaveValue("NVDA");
  });
  it("submits the edited custom script through the existing job contract", async () => {
    mount(); await waitFor(() => expect(screen.getByLabelText("Data Version ID")).toHaveValue("test-version")); fireEvent.change(screen.getByLabelText("Model", { exact: true }), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Python Strategy Script"), { target: { value: "def generate_signals(df, context): return df" } }); run();
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith(expect.objectContaining({ strategy: "def generate_signals(df, context): return df", context: {}, config: expect.objectContaining({ position_fraction: 1 }) })));
  });
  it("blocks invalid execution settings and clears the warning when repaired", async () => {
    mount(); fireEvent.change(screen.getByLabelText("Volume cap (%)"), { target: { value: "101" } }); expect(screen.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Volume cap (%)"), { target: { value: "10" } }); expect(screen.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
    await waitFor(() => expect(screen.getByLabelText("Data Version ID")).toHaveValue("test-version"));
  });
});
