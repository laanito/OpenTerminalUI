/** @vitest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DividendDashboardPage } from "../pages/DividendDashboardPage";
const get = vi.fn();
vi.mock("../api/client", () => ({ api: { get: (...args: unknown[]) => get(...args) } }));
vi.mock("recharts", () => ({ ResponsiveContainer: ({ children }: any) => <div>{children}</div>, BarChart: () => <div />, Bar: () => null, CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }));
beforeEach(() => { get.mockReset(); get.mockResolvedValue({ data: [{ symbol: "AAPL", ex_date: "2026-12-01", amount: 0, type: "Dividend" }] }); });
it("keeps real zero separate from missing amounts and exposes native-unit limits", async () => {
  get.mockResolvedValue({ data: [{ symbol: "ZERO", amount: 0 }, { symbol: "MISSING", amount: null, estimated: true }] });
  render(<DividendDashboardPage />);
  const table = await screen.findByRole("region", { name: "Upcoming dividends table" });
  expect(within(table).getByText("0")).toBeInTheDocument();
  expect(within(table).getAllByText("Unavailable").length).toBeGreaterThan(0);
  expect(within(table).getByText("Estimated")).toBeInTheDocument();
  expect(screen.getByText(/currency not supplied/)).toBeInTheDocument();
});
it("applies history drafts explicitly and ignores a late prior-symbol response", async () => {
  let release!: (value: unknown) => void;
  get.mockImplementation((path: string) => path.endsWith("/AAPL") ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ data: path.endsWith("/SAP.DE") ? [{ date: "2026-04-01", amount: 2.35 }] : [] }));
  render(<DividendDashboardPage />);
  fireEvent.click(screen.getByRole("button", { name: "Stock history" }));
  await waitFor(() => expect(release).toBeDefined());
  const previousSignal = get.mock.calls.find(([path]) => path.endsWith("/AAPL"))[1].signal;
  fireEvent.change(screen.getByRole("textbox", { name: "History symbol" }), { target: { value: "sap.de" } });
  expect(get.mock.calls.some(([path]) => path.endsWith("/SAP.DE"))).toBe(false);
  fireEvent.submit(screen.getByRole("form", { name: "Dividend history scope" }));
  await screen.findByText("2.35"); expect(previousSignal.aborted).toBe(true);
  await act(async () => release({ data: [{ date: "OLD", amount: 999 }] }));
  expect(screen.queryByText("999")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Dividend history · SAP.DE" })).toBeInTheDocument();
});
it("clears failed refreshes and retries while retaining an unapplied history draft", async () => {
  render(<DividendDashboardPage />); await screen.findByText("AAPL");
  fireEvent.click(screen.getByRole("button", { name: "Stock history" })); await screen.findByRole("region", { name: "Historical dividends table" });
  fireEvent.change(screen.getByRole("textbox", { name: "History symbol" }), { target: { value: "UNAPPLIED" } });
  get.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER")); fireEvent.click(screen.getByRole("button", { name: "Refresh view" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No previous result");
  expect(screen.queryByRole("region", { name: "Historical dividends table" })).not.toBeInTheDocument();
  expect(screen.queryByText(/PRIVATE_PROVIDER/)).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "History symbol" })).toHaveValue("UNAPPLIED");
  get.mockResolvedValueOnce({ data: [] }); fireEvent.click(screen.getByRole("button", { name: "Refresh view" }));
  await screen.findByText("No dividend rows returned for this scope.");
  expect(get.mock.lastCall?.[0]).toBe("/dividends/history/AAPL");
});
it("does not invent an income currency, and handles malformed responses as failed reads", async () => {
  get.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: { annual_income: 0, monthly_breakdown: [] } });
  render(<DividendDashboardPage />); await screen.findByText("No dividend rows returned for this scope.");
  fireEvent.click(screen.getByRole("button", { name: "Portfolio income" }));
  await screen.findByText("Reported total · currency not supplied"); expect(screen.getByText("0")).toBeInTheDocument(); await screen.findByText("No monthly amounts returned.");
  get.mockResolvedValueOnce({ data: {} }); fireEvent.click(screen.getByRole("button", { name: "Refresh view" }));
  await screen.findByRole("alert"); expect(screen.queryByText("0")).not.toBeInTheDocument();
});
