/** @vitest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { StatisticalLab } from "../pages/StatisticalLab";
const mocks = vi.hoisted(() => Object.fromEntries(["fetchStatlabMethods","postForecast","postCointegration","postStationarity","postRegression","postAutocorrelation","postCausality","postRegimes"].map(key => [key,vi.fn()])));
vi.mock("../api/statlab", () => mocks);
vi.mock("recharts", () => {
 const Container = ({ children }: any) => <div>{children}</div>;
 return { ResponsiveContainer: Container, ComposedChart: Container, LineChart: Container, AreaChart: Container, BarChart: Container, ScatterChart: Container, Area: () => null, Bar: () => null, Scatter: () => null, Line: () => null, Cell: () => null, CartesianGrid: () => null, Legend: () => null, ReferenceLine: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null };
});
const forecast = (ticker = "AAPL") => ({ ticker,method: "arima",history: [{ date: "2026-11-20",value: 100 }],forecast: [{ date: "2026-11-23",mean: 101,lower: 90,upper: 110 }],model: { order: "(1,1,1)",aic: 0 },metrics: { rmse_in_sample: 0 } });
const choose = (tool: string) => fireEvent.change(screen.getByRole("combobox", { name: "Analysis", exact: true }), { target: { value: tool } });
const submit = () => fireEvent.submit(screen.getByRole("form", { name: "Statistical analysis inputs" }));
beforeEach(() => {
 Object.values(mocks).forEach(mock => { mock.mockReset(); mock.mockResolvedValue({}); });
 mocks.fetchStatlabMethods.mockResolvedValue({ forecast_methods: [{ id: "arima",label: "ARIMA" }] }); mocks.postForecast.mockResolvedValue(forecast());
});
it("loads methods explicitly, normalizes captured symbols and distinguishes later draft edits", async () => {
 render(<StatisticalLab />); await waitFor(() => expect(screen.getByRole("button", { name: "Run analysis" })).toBeEnabled()); expect(mocks.postForecast).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole("textbox", { name: "Forecast symbol" }), { target: { value: " sap.de " } }); submit();
 await screen.findByRole("img", { name: "History and forecast chart" }); expect(mocks.postForecast).toHaveBeenCalledWith({ ticker: "SAP.DE",method: "arima",horizon: 30 }); expect(screen.getByRole("textbox", { name: "Forecast symbol" })).toHaveValue("SAP.DE"); expect(screen.queryByText(/Inputs have changed/)).not.toBeInTheDocument();
 fireEvent.change(screen.getByRole("textbox", { name: "Forecast symbol" }), { target: { value: "BTC-USD" } }); expect(screen.getByText(/Results below still belong/)).toBeInTheDocument(); expect(screen.getByRole("region", { name: "Statistical analysis result" })).toHaveTextContent("SAP.DE"); expect(mocks.postForecast).toHaveBeenCalledTimes(1);
});
it("keeps per-analysis drafts/results and ignores completion focus for an inactive tool", async () => {
 let release!: (value: unknown) => void; mocks.postForecast.mockImplementation(() => new Promise(resolve => { release = resolve; })); render(<StatisticalLab />); await waitFor(() => expect(screen.getByRole("button", { name: "Run analysis" })).toBeEnabled()); submit(); choose("stationarity");
 fireEvent.change(screen.getByRole("textbox", { name: "Stationarity symbol" }), { target: { value: "NVDA" } }); screen.getByRole("textbox", { name: "Stationarity symbol" }).focus();
 await act(async () => release(forecast())); expect(screen.getByRole("textbox", { name: "Stationarity symbol" })).toHaveFocus(); expect(screen.queryByRole("img", { name: "History and forecast chart" })).not.toBeInTheDocument();
 choose("forecast"); await screen.findByRole("img", { name: "History and forecast chart" }); choose("stationarity"); expect(screen.getByRole("textbox", { name: "Stationarity symbol" })).toHaveValue("NVDA");
});
it("guards duplicate requests, locks captured inputs and clears old results after a failed rerun", async () => {
 render(<StatisticalLab />); await waitFor(() => expect(screen.getByRole("button", { name: "Run analysis" })).toBeEnabled()); submit(); await screen.findByRole("img", { name: "History and forecast chart" });
 let reject!: (reason: unknown) => void; mocks.postForecast.mockImplementation(() => new Promise((_,fail) => { reject = fail; })); submit(); submit();
 expect(mocks.postForecast).toHaveBeenCalledTimes(2); expect(screen.getByRole("textbox", { name: "Forecast symbol" })).toBeDisabled(); expect(screen.queryByRole("img", { name: "History and forecast chart" })).not.toBeInTheDocument();
 await act(async () => reject(new Error("PRIVATE_PROVIDER"))); expect(await screen.findByRole("alert")).toHaveTextContent("No previous result"); expect(screen.getByRole("textbox", { name: "Forecast symbol" })).toHaveValue("AAPL"); expect(screen.queryByText(/PRIVATE_PROVIDER/)).not.toBeInTheDocument(); expect(screen.getByRole("textbox", { name: "Forecast symbol" })).toBeEnabled();
});
it("has separate method loading failure, empty and manual retry states", async () => {
 mocks.fetchStatlabMethods.mockRejectedValueOnce(new Error("PRIVATE_METHODS")).mockResolvedValueOnce({ forecast_methods: [] }).mockResolvedValueOnce({ forecast_methods: [{ id: "ets",label: "ETS" }] });
 render(<StatisticalLab />); await screen.findByText(/Could not load forecast methods/); expect(screen.getByRole("button", { name: "Run analysis" })).toBeDisabled();
 fireEvent.click(screen.getByRole("button", { name: "Refresh methods" })); await screen.findByText("No forecast methods returned."); fireEvent.click(screen.getByRole("button", { name: "Refresh methods" })); await waitFor(() => expect(screen.getByRole("combobox", { name: "Forecast method" })).toHaveValue("ets")); expect(mocks.postForecast).not.toHaveBeenCalled();
});
it("validates server numeric bounds and distinct pairs without losing drafts", async () => {
 render(<StatisticalLab />); await act(async () => {}); choose("regression"); fireEvent.change(screen.getByRole("spinbutton", { name: "Rolling window (observations)" }), { target: { value: "" } }); submit(); expect(screen.getByRole("alert")).toHaveTextContent("20 to 252"); expect(mocks.postRegression).not.toHaveBeenCalled();
 choose("coint"); fireEvent.change(screen.getByRole("textbox", { name: "Second pair symbol" }), { target: { value: "aapl" } }); submit(); expect(screen.getByRole("alert")).toHaveTextContent("two distinct"); expect(mocks.postCointegration).not.toHaveBeenCalled(); choose("regression"); expect(screen.getByRole("spinbutton", { name: "Rolling window (observations)" })).toHaveValue(null);
});
it("shows missing metrics/conclusions as unavailable while preserving literal zero", async () => {
 mocks.postStationarity.mockResolvedValue({ ticker: "AAPL",hurst: null,adf: { stat: 0,pvalue: null,is_stationary: null },kpss: { stat: null,pvalue: 0,is_stationary: false },returns_adf: { stat: 0,pvalue: 0,is_stationary: true },interpretation: "Partial returned model" });
 render(<StatisticalLab />); choose("stationarity"); submit(); const table = await screen.findByRole("region", { name: "Stationarity test results" }); expect(within(table).getAllByText("Unavailable").length).toBeGreaterThan(0); expect(within(table).getAllByText("0.0000").length).toBeGreaterThan(0); expect(screen.queryByText("Random walk")).not.toBeInTheDocument();
});
it("uses retained operation payloads without adding lookbacks or automatic retries", async () => {
 render(<StatisticalLab />);
 for (const [tool,key,body] of [
  ["coint","postCointegration",{ ticker_a: "AAPL",ticker_b: "MSFT" }],
  ["stationarity","postStationarity",{ ticker: "AAPL" }],
  ["regression","postRegression",{ ticker: "AAPL",benchmark: "^GSPC",rolling_window: 63 }],
  ["autocorr","postAutocorrelation",{ ticker: "AAPL",nlags: 30,use_returns: true }],
  ["causality","postCausality",{ ticker_a: "AAPL",ticker_b: "MSFT",max_lag: 5 }],
  ["regimes","postRegimes",{ ticker: "AAPL" }],
 ] as const) { choose(tool); submit(); await waitFor(() => expect(mocks[key]).toHaveBeenCalledWith(body)); await screen.findByText("No analysis values returned."); expect(mocks[key]).toHaveBeenCalledTimes(1); }
});
it("keeps Decomposition explicitly unavailable without silently wiring a new analysis", async () => {
 render(<StatisticalLab />); await act(async () => {}); choose("decomposition"); expect(screen.getByRole("region", { name: "Decomposition availability" })).toHaveTextContent("not available here yet"); expect(screen.queryByRole("form", { name: "Statistical analysis inputs" })).not.toBeInTheDocument(); Object.entries(mocks).filter(([key]) => key !== "fetchStatlabMethods").forEach(([,mock]) => expect(mock).not.toHaveBeenCalled());
});
