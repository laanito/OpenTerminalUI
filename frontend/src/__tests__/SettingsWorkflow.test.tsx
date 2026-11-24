import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../pages/Settings";
import { DataManager } from "../components/settings/DataManager";
import { useSettingsStore } from "../store/settingsStore";

const mocks = vi.hoisted(() => ({ alerts: vi.fn(), reports: vi.fn(), createAlert: vi.fn(), createReport: vi.fn(), deleteAlert: vi.fn(), deleteReport: vi.fn(), download: vi.fn(), get: vi.fn() }));
vi.mock("../api/client", () => ({ fetchAlertsFiltered: (...args: unknown[]) => mocks.alerts(...args), fetchScheduledReports: (...args: unknown[]) => mocks.reports(...args), createAlert: (...args: unknown[]) => mocks.createAlert(...args), createScheduledReport: (...args: unknown[]) => mocks.createReport(...args), deleteAlert: (...args: unknown[]) => mocks.deleteAlert(...args), deleteScheduledReport: (...args: unknown[]) => mocks.deleteReport(...args), downloadExport: (...args: unknown[]) => mocks.download(...args), api: { get: (...args: unknown[]) => mocks.get(...args) } }));
vi.mock("../components/settings/APIKeyManager", () => ({ APIKeyManager: () => <div>Key manager</div> }));
const report = { id: "schedule", report_type: "portfolio_summary", frequency: "weekly", email: "research@example.test", data_type: "positions", enabled: true };
function page() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><SettingsPage /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { vi.resetAllMocks(); mocks.alerts.mockResolvedValue([]); mocks.reports.mockResolvedValue([]); useSettingsStore.setState({ selectedCountry: "US", selectedMarket: "NASDAQ", displayCurrency: "USD" }); });
describe("Settings workflow", () => {
  it("reflects all existing market/currency contexts and persists labelled preferences", () => {
    useSettingsStore.setState({ selectedCountry: "EU", selectedMarket: "EU", displayCurrency: "EUR" });
    page(); expect(screen.getByLabelText("Market context")).toHaveValue("EU"); expect(screen.getByLabelText("Display currency")).toHaveValue("EUR");
    fireEvent.change(screen.getByLabelText("Market context"), { target: { value: "CRYPTO" } });
    expect(useSettingsStore.getState()).toMatchObject({ selectedCountry: "CRYPTO", selectedMarket: "CRYPTO", displayCurrency: "USD" });
    fireEvent.change(screen.getByLabelText("News refresh interval (seconds)"), { target: { value: "2" } });
    expect(useSettingsStore.getState().newsRefreshSec).toBe(5);
  });
  it("keeps schedule reads independent from failed alert reads", async () => {
    mocks.alerts.mockRejectedValue(new Error("offline")); mocks.reports.mockResolvedValue([report]); page();
    fireEvent.click(screen.getByRole("tab", { name: "Automation" }));
    await screen.findByRole("article", { name: "portfolio_summary schedule" });
    await screen.findByText(/Could not refresh quick alerts/);
    expect(screen.queryByText("No alert rules configured.")).not.toBeInTheDocument();
  });
  it("retains a failed report draft and separates confirmed scheduling from failed refresh", async () => {
    mocks.createReport.mockRejectedValueOnce(new Error("PRIVATE_EMAIL_CONTEXT")).mockResolvedValueOnce(report);
    page(); fireEvent.click(screen.getByRole("tab", { name: "Automation" })); await screen.findByText("No schedules configured.");
    fireEvent.click(screen.getByText("Add report schedule", { selector: "summary" }));
    fireEvent.change(screen.getByLabelText("Email (optional)"), { target: { value: report.email } });
    fireEvent.change(screen.getByLabelText("Frequency"), { target: { value: "weekly" } });
    const form = screen.getByRole("form", { name: "Add report schedule" }); fireEvent.submit(form);
    await screen.findByRole("alert"); expect(screen.getByLabelText("Email (optional)")).toHaveValue(report.email);
    expect(screen.getByRole("alert")).not.toHaveTextContent("PRIVATE_EMAIL_CONTEXT");
    mocks.reports.mockRejectedValue(new Error("offline")); fireEvent.submit(form);
    await screen.findByRole("article", { name: "portfolio_summary schedule" }); await screen.findByText(/Could not refresh schedules/);
    expect(mocks.createReport).toHaveBeenLastCalledWith({ report_type: "portfolio_summary", frequency: "weekly", email: report.email, data_type: "positions" });
    expect(mocks.createReport).toHaveBeenCalledTimes(2);
  });
  it("preserves quick-alert payloads and fractional thresholds across tab changes", async () => {
    mocks.createAlert.mockResolvedValue({ alert: { id: "alert", ticker: "SAP.DE", alert_type: "price", condition: "below", threshold: 170.125, note: "Dated thesis" } });
    page(); fireEvent.click(screen.getByRole("tab", { name: "Automation" })); await screen.findByText("No alert rules configured.");
    fireEvent.click(screen.getByText("Add quick alert", { selector: "summary" }));
    fireEvent.change(screen.getByLabelText("Alert ticker"), { target: { value: "SAP.DE" } });
    fireEvent.change(screen.getByLabelText("Threshold (quoted units)"), { target: { value: "170.125" } });
    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "below" } });
    fireEvent.change(screen.getByLabelText("Alert note"), { target: { value: "Dated thesis" } });
    fireEvent.click(screen.getByRole("tab", { name: "Data", exact: true })); fireEvent.click(screen.getByRole("tab", { name: "Automation" }));
    expect(screen.getByLabelText("Alert ticker")).toHaveValue("SAP.DE");
    fireEvent.submit(screen.getByRole("form", { name: "Add quick alert" }));
    await waitFor(() => expect(mocks.createAlert).toHaveBeenCalledWith({ ticker: "SAP.DE", alert_type: "price", condition: "below", threshold: 170.125, note: "Dated thesis" }));
  });
  it("reports an export failure and never starts a fabricated download", async () => {
    mocks.download.mockRejectedValue(new Error("offline")); page(); fireEvent.click(screen.getByRole("tab", { name: "Data", exact: true }));
    fireEvent.click(within(screen.getByRole("article", { name: "positions exports" })).getByRole("button", { name: "CSV", exact: true }));
    await screen.findByText("Could not download the export. Retry manually when ready."); expect(mocks.download).toHaveBeenCalledWith("positions", "csv");
  });
  it("does not show empty datasets before reading and retains files on failed refresh", async () => {
    mocks.get.mockResolvedValueOnce({ data: { items: [{ name: "long-research-file.csv", bytes: 2048, updated_at: 0 }] } }).mockRejectedValue(new Error("offline"));
    render(<DataManager />); expect(screen.queryByText("No stored datasets yet.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh datasets" })); await screen.findByText("long-research-file.csv");
    fireEvent.click(screen.getByRole("button", { name: "Refresh datasets" })); await screen.findByRole("alert");
    expect(screen.getByText("long-research-file.csv")).toBeInTheDocument();
  });
});
