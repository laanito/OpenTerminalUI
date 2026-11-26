/** @vitest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CorrelationDashboardPage } from "../pages/CorrelationDashboardPage";
const mocks = vi.hoisted(() => ({ fetchCorrelationClusters: vi.fn(), fetchCorrelationMatrix: vi.fn(), fetchPortfolio: vi.fn(), fetchRollingCorrelation: vi.fn(), searchSymbols: vi.fn() }));
vi.mock("../api/client", () => mocks);
vi.mock("recharts", () => {
  const Container = ({ children }: any) => <div>{children}</div>;
  return { ResponsiveContainer: Container, LineChart: Container, Line: () => null, ReferenceArea: () => null, ReferenceLine: () => null, CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null };
});
const matrix = { symbols: ["AAPL","MSFT","GOOGL"], matrix: [[1,null,-.8],[null,1,0],[-.8,0,1]], period_start: "2026-01-01", period_end: "2026-11-25" };
const rolling = (value: number) => ({ series: [{ date: "2026-11-25", correlation: value }], current: value, avg: value, min: value, max: value, regimes: [] });
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.fetchCorrelationMatrix.mockResolvedValue(matrix); mocks.fetchPortfolio.mockResolvedValue({ items: [{ ticker: "SAP.DE" }] }); mocks.searchSymbols.mockResolvedValue([]); mocks.fetchRollingCorrelation.mockResolvedValue(rolling(0));
  mocks.fetchCorrelationClusters.mockResolvedValue({ clusters: [{ cluster_id: 1, symbols: ["AAPL","MSFT"], avg_intra_correlation: null }], dendrogram: { distance: .8, children: [{ name: "AAPL", distance: 0, children: [] }, { name: "MSFT", distance: 0, children: [] }] } });
});
const manage = () => fireEvent.click(screen.getByText(/Manage scope/));
it("keeps missing matrix cells separate from zero and opens a keyboard-focusable rolling scope", async () => {
  render(<CorrelationDashboardPage />); const table = await screen.findByRole("region", { name: "Correlation heatmap table" });
  expect(within(table).getAllByText("Unavailable")).toHaveLength(2); expect(within(table).getAllByText("0.00")).toHaveLength(2); expect(within(table).getByRole("rowheader", { name: "AAPL" })).toBeInTheDocument();
  fireEvent.click(within(table).getByRole("button", { name: "Inspect AAPL / GOOGL rolling correlation" }));
  await waitFor(() => expect(mocks.fetchRollingCorrelation).toHaveBeenCalledWith({ symbol1: "AAPL", symbol2: "GOOGL", window: 60, period: "3Y" })); expect(screen.getByRole("region", { name: "Active correlation view" })).toHaveFocus();
});
it("ignores old search suggestions and supports click and native-symbol submission without duplicates", async () => {
  let release!: (data: unknown) => void;
  mocks.searchSymbols.mockImplementation((query: string) => query === "OLD" ? new Promise(resolve => { release = resolve; }) : Promise.resolve([{ ticker: "SAP.DE", name: "Long native European company name", exchange: "XETRA" }]));
  render(<CorrelationDashboardPage />); manage(); const input = screen.getByRole("textbox", { name: "Find or enter symbol" }); fireEvent.change(input, { target: { value: "OLD" } }); await waitFor(() => expect(release).toBeDefined());
  fireEvent.change(input, { target: { value: "SAP" } }); const suggestion = await screen.findByRole("button", { name: /SAP.DE Long native European company name XETRA/ });
  await act(async () => release([{ ticker: "STALE", name: "Old result" }])); expect(screen.queryByText("Old result")).not.toBeInTheDocument(); fireEvent.click(suggestion);
  await screen.findByRole("button", { name: "Remove SAP.DE" }); expect(input).toHaveValue(""); expect(input).toHaveFocus(); expect(mocks.searchSymbols).toHaveBeenCalledWith("SAP", undefined);
  fireEvent.change(input, { target: { value: " sap.de " } }); fireEvent.submit(screen.getByRole("form", { name: "Add correlation symbol" })); expect(screen.getAllByRole("button", { name: "Remove SAP.DE" })).toHaveLength(1);
});
it("distinguishes failed portfolio reads, retries and appends at most twenty unique symbols", async () => {
  mocks.fetchPortfolio.mockRejectedValueOnce(new Error("PRIVATE_PORTFOLIO")).mockResolvedValue({ items: Array.from({ length: 25 },(_,i) => ({ ticker: `NATIVE${i}` })) });
  render(<CorrelationDashboardPage />); manage(); fireEvent.click(await screen.findByRole("button", { name: "Retry portfolio symbols" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Add current portfolio" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Add current portfolio" }));
  expect(within(screen.getByRole("list", { name: "Selected correlation symbols" })).getAllByRole("listitem")).toHaveLength(20); expect(screen.getByRole("textbox", { name: "Find or enter symbol" })).toBeDisabled(); expect(screen.getByText(/some names were not added/)).toBeInTheDocument(); expect(screen.queryByText(/PRIVATE_PORTFOLIO/)).not.toBeInTheDocument();
});
it("clears the analysis when fewer than two symbols remain", async () => {
  render(<CorrelationDashboardPage />); await screen.findByRole("region", { name: "Correlation heatmap table" }); manage();
  for (const symbol of ["MSFT","GOOGL","AMZN","NVDA"]) fireEvent.click(screen.getByRole("button", { name: `Remove ${symbol}` }));
  expect(screen.getByText(/Add at least two distinct/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Remove AAPL" })).toHaveFocus(); expect(screen.queryByRole("region", { name: "Correlation heatmap table" })).not.toBeInTheDocument();
  expect(mocks.fetchCorrelationMatrix.mock.calls.every(([payload]) => payload.symbols.length >= 2)).toBe(true);
});
it("does not relabel old rolling data while another window loads or fails", async () => {
  let release!: (data: unknown) => void; mocks.fetchRollingCorrelation.mockImplementation(({ window }: { window: number }) => window === 20 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(rolling(.3)));
  render(<CorrelationDashboardPage />); fireEvent.click(screen.getByRole("button", { name: "Rolling pairs", exact: true })); await screen.findByRole("img", { name: /Rolling correlation chart/ });
  const window = screen.getByRole("combobox", { name: "Rolling window" }); fireEvent.change(window, { target: { value: "20" } }); await waitFor(() => expect(release).toBeDefined()); expect(screen.queryByRole("img", { name: /Rolling correlation chart/ })).not.toBeInTheDocument();
  fireEvent.change(window, { target: { value: "30" } }); await screen.findByRole("img", { name: /Rolling correlation chart/ }); await act(async () => release(rolling(.9))); expect(screen.queryByText("0.90")).not.toBeInTheDocument();
  mocks.fetchRollingCorrelation.mockRejectedValueOnce(new Error("PRIVATE_ROLLING")); fireEvent.change(window, { target: { value: "60" } }); await screen.findByRole("alert"); expect(screen.queryByRole("img", { name: /Rolling correlation chart/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh Rolling correlation" })); await screen.findByRole("img", { name: /Rolling correlation chart/ }); expect(mocks.fetchRollingCorrelation.mock.lastCall?.[0].window).toBe(60); expect(screen.queryByText(/PRIVATE_ROLLING/)).not.toBeInTheDocument();
});
it("retains clusters when the pair matrix fails and ranks only reported finite coefficients", async () => {
  mocks.fetchCorrelationMatrix.mockRejectedValueOnce(new Error("PRIVATE_MATRIX")); render(<CorrelationDashboardPage />); await screen.findByRole("alert"); fireEvent.click(screen.getByRole("button", { name: "Clusters", exact: true }));
  await screen.findByRole("heading", { name: "Cluster 1" }); expect(mocks.fetchCorrelationClusters).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Refresh Lowest signed pair correlations" })); const pairs = await screen.findByRole("region", { name: "Lowest correlation pairs" }); expect(within(pairs).getAllByRole("button").map(button => button.textContent)).toEqual(["AAPL / GOOGL","MSFT / GOOGL"]); expect(within(pairs).getByText("0.00")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Merge tree", { exact: true })); expect(screen.getByRole("region", { name: "Correlation merge tree" })).toHaveTextContent("Merge · distance 0.8000"); expect(mocks.fetchCorrelationClusters).toHaveBeenCalledTimes(1);
});
