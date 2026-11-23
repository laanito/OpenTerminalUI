import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertBuilder } from "../components/Alerts/AlertBuilder";
import { AlertsPage } from "../pages/Alerts";
import type { AlertRule } from "../types";

const mocks = vi.hoisted(() => ({ read: vi.fn(), history: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), test: vi.fn() }));
vi.mock("../api/client", () => ({ fetchAlertsFiltered: (...args: unknown[]) => mocks.read(...args), fetchAlertHistory: (...args: unknown[]) => mocks.history(...args), createAlert: (...args: unknown[]) => mocks.create(...args), updateAlert: (...args: unknown[]) => mocks.update(...args), deleteAlert: (...args: unknown[]) => mocks.remove(...args), testAlertDelivery: (...args: unknown[]) => mocks.test(...args) }));
const rule = { id: "rule", symbol: "BTC-EUR", ticker: "BTC-EUR", alert_type: "price", condition: "below", threshold: 12.125, note: "Dated risk review", created_at: "2026-11-23T12:00:00Z", conditions: [{ field: "price", operator: "below", value: 12.125, params: {} }], logic: "AND", delivery_channels: ["in_app"], cooldown_minutes: 5, max_triggers: 3, expiry_date: "2027-01-12T20:00:30.000Z" } as AlertRule;
function page() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><AlertsPage /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); vi.stubGlobal("WebSocket", class { onmessage = null; close() {} }); mocks.read.mockResolvedValue([rule]); mocks.history.mockResolvedValue({ page: 1, page_size: 10, total: 0, history: [] }); });
afterEach(() => vi.unstubAllGlobals());
describe("Alert editor and feedback", () => {
  it("retains fractional thresholds, rule parameters and an unchanged expiry instant", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AlertBuilder open mode="edit" initialAlert={rule} onClose={() => {}} onSave={onSave} />);
    fireEvent.submit(screen.getByRole("form", { name: "Alert rule" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ symbol: "BTC-EUR", conditions: rule.conditions, expiry_date: rule.expiry_date, cooldown_minutes: 5, max_triggers: 3 })));
    expect((screen.getByLabelText("Condition value 1") as HTMLInputElement).validity.stepMismatch).toBe(false);
  });
  it("retains a failed draft and does not expose raw delivery errors", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("PRIVATE_BOT_TOKEN"));
    render(<AlertBuilder open mode="create" onClose={() => {}} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "SAP.DE" } });
    fireEvent.change(screen.getByLabelText("Condition value 1"), { target: { value: "170.125" } });
    fireEvent.submit(screen.getByRole("form", { name: "Alert rule" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Your draft is still here"));
    expect(screen.getByRole("alert")).not.toHaveTextContent("PRIVATE_BOT_TOKEN"); expect(screen.getByLabelText("Symbol")).toHaveValue("SAP.DE"); expect(onSave).toHaveBeenCalledTimes(1);
  });
  it("tests configured delivery explicitly and retains the draft on test failure", async () => {
    const test = vi.fn().mockRejectedValue(new Error("PRIVATE_ENDPOINT"));
    render(<AlertBuilder open mode="edit" initialAlert={rule} onClose={() => {}} onSave={vi.fn()} onTestChannel={test} />);
    fireEvent.click(screen.getByRole("button", { name: "Test configured delivery" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Your draft is unchanged"));
    expect(test).toHaveBeenCalledWith("all"); expect(screen.getByLabelText("Condition value 1")).toHaveValue(12.125);
  });
});
describe("Alerts page state", () => {
  it("distinguishes rule retrieval failure from empty while history remains independently usable", async () => {
    mocks.read.mockRejectedValue(new Error("offline")); mocks.history.mockResolvedValue({ page: 1, page_size: 10, total: 1, history: [{ id: "event", symbol: "BTC-EUR", condition_type: "price_below", triggered_value: 12, triggered_at: "2026-11-23T12:00:00Z" }] });
    page(); await screen.findByRole("alert"); expect(screen.queryByText("No alerts configured.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Alert History/ }));
    await screen.findByRole("article", { name: "BTC-EUR event" });
  });
  it("keeps a confirmed creation separate from a failed refresh without reopening its write", async () => {
    mocks.read.mockResolvedValueOnce([]).mockRejectedValue(new Error("offline")); mocks.create.mockResolvedValue({ status: "created", alert: { ...rule, id: "created", symbol: "AAPL" } });
    page(); await screen.findByText("No alerts configured."); fireEvent.click(screen.getByRole("button", { name: "Create New Alert" }));
    const dialog = screen.getByRole("dialog", { name: "Create Alert" }); fireEvent.submit(within(dialog).getByRole("form", { name: "Alert rule" }));
    await screen.findByRole("article", { name: "AAPL alert" }); await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not refresh alert rules"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("does not let an earlier refresh erase a confirmed creation", async () => {
    let finishOldRead!: (rules: AlertRule[]) => void;
    const oldRead = new Promise<AlertRule[]>(resolve => { finishOldRead = resolve; });
    mocks.read.mockResolvedValueOnce([rule]).mockReturnValueOnce(oldRead).mockRejectedValue(new Error("offline"));
    mocks.create.mockResolvedValue({ status: "created", alert: { ...rule, id: "created", symbol: "AAPL" } });
    page(); await screen.findByRole("article", { name: "BTC-EUR alert" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh rules" }));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Create New Alert" }));
    fireEvent.submit(screen.getByRole("form", { name: "Alert rule" }));
    await screen.findByRole("article", { name: "AAPL alert" });
    await screen.findByRole("alert");
    await act(async () => { finishOldRead([rule]); await oldRead; });
    expect(screen.getByRole("article", { name: "AAPL alert" })).toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("labels and masks delivery defaults while preserving the existing browser storage key", async () => {
    page(); await screen.findByRole("article", { name: "BTC-EUR alert" }); fireEvent.click(screen.getByRole("tab", { name: "Delivery Settings" }));
    const token = screen.getByLabelText("Default Telegram Bot Token"); expect(token).toHaveAttribute("type", "password");
    fireEvent.change(token, { target: { value: "fixture-token" } }); fireEvent.click(screen.getByRole("button", { name: "Save Delivery Defaults" }));
    expect(JSON.parse(localStorage.getItem("ot.alert.delivery.defaults") || "{}").telegram_token).toBe("fixture-token"); expect(mocks.test).not.toHaveBeenCalled();
    fireEvent.change(token, { target: { value: "changed-draft" } });
    expect(screen.queryByText("Delivery defaults saved in this browser.")).not.toBeInTheDocument();
  });
});
