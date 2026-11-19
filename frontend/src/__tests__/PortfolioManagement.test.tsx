import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PortfolioCreateDialog } from "../components/portfolio/PortfolioCreateDialog";
import { PortfolioSettingsDialog } from "../components/portfolio/PortfolioSettingsDialog";
import { PortfolioCurrencyRepair } from "../components/portfolio/PortfolioCurrencyRepair";
const api = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn(), holdings: vi.fn(), add: vi.fn(), holdingCurrency: vi.fn(), transactionCurrency: vi.fn() }));
vi.mock("../api/client", () => ({ createPortfolio: api.create, updatePortfolioById: api.update, deletePortfolioById: api.remove, fetchPortfolioHoldings: api.holdings, addPortfolioHolding: api.add, updatePortfolioHoldingCurrency: api.holdingCurrency, updatePortfolioTransactionCurrencies: api.transactionCurrency }));
vi.mock("../components/common/ExportButton", () => ({ ExportButton: () => <button>Export holdings</button> }));
beforeEach(() => { vi.resetAllMocks(); api.holdings.mockResolvedValue([]); api.create.mockResolvedValue({ id: "new", name: "Macro" }); });

it("creates an account with zero cash and a separate mandate through the header dialog", async () => {
  const created = vi.fn(), close = vi.fn();
  render(<PortfolioCreateDialog onCreated={created} onClose={close} />);
  expect(screen.getByLabelText("Starting cash")).toHaveValue(0);
  fireEvent.change(screen.getByLabelText("Portfolio name"), { target: { value: " Macro " } });
  fireEvent.change(screen.getByLabelText("Portfolio thesis"), { target: { value: " Diversify inflation regimes. " } });
  fireEvent.submit(screen.getByRole("button", { name: "Create portfolio", exact: true }).closest("form")!);
  await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Macro", description: "Diversify inflation regimes.", starting_cash: 0 })));
  expect(created).toHaveBeenCalledWith("Macro"); expect(close).toHaveBeenCalled();
});

it("keeps creation fields when a save is not confirmed", async () => {
  api.create.mockRejectedValue(new Error("network"));
  render(<PortfolioCreateDialog onCreated={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Portfolio name"), { target: { value: "Draft" } });
  fireEvent.submit(screen.getByRole("button", { name: "Create portfolio", exact: true }).closest("form")!);
  await screen.findByRole("alert"); expect(screen.getByLabelText("Portfolio name")).toHaveValue("Draft");
});

it("edits the captured account mandate without changing viewing scope or making a transaction", async () => {
  const changed = vi.fn();
  render(<PortfolioSettingsDialog portfolio={{ id: "p2", name: "Europe", currency: "EUR", description: "Existing thesis", benchmark_symbol: "MSCIWI" }} onClose={vi.fn()} onChanged={changed} onDeleted={vi.fn()} />);
  expect(screen.getByLabelText("Portfolio thesis")).toHaveValue("Existing thesis");
  fireEvent.change(screen.getByLabelText("Portfolio thesis"), { target: { value: " Updated mandate. " } });
  fireEvent.submit(screen.getByRole("button", { name: "Save portfolio settings" }).closest("form")!);
  await waitFor(() => expect(api.update).toHaveBeenCalledWith("p2", { name: "Europe", description: "Updated mandate.", benchmark_symbol: "MSCIWI", currency: "EUR" }));
  expect(changed).toHaveBeenCalled(); expect(api.add).not.toHaveBeenCalled();
});

it("repairs a lot denomination in its owning account", async () => {
  render(<PortfolioCurrencyRepair target={{ kind: "holding", portfolioId: "p2", portfolioName: "Europe", id: "h2", symbol: "SAP.DE" }} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Cost currency"), { target: { value: "EUR" } });
  fireEvent.submit(screen.getByRole("button", { name: "Save currency" }).closest("form")!);
  await waitFor(() => expect(api.holdingCurrency).toHaveBeenCalledWith("p2", "h2", "EUR"));
});

it("repairs amount and fee currencies independently in a movement’s owning account", async () => {
  render(<PortfolioCurrencyRepair target={{ kind: "transaction", portfolioId: "p2", portfolioName: "Europe", id: "tx", symbol: "SAP.DE", currency: null, fees: 2, fees_currency: null }} onClose={vi.fn()} onSaved={vi.fn()} />);
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Amount currency"), { target: { value: "EUR" } });
  fireEvent.change(dialog.getByLabelText("Fee currency"), { target: { value: "GBP" } });
  fireEvent.submit(dialog.getByRole("button", { name: "Save currency" }).closest("form")!);
  await waitFor(() => expect(api.transactionCurrency).toHaveBeenCalledWith("p2", "tx", { currency: "EUR", fees_currency: "GBP" }));
});

it("shows a persisted custom benchmark without replacing it with the first suggested benchmark", async () => {
  render(<PortfolioSettingsDialog portfolio={{ id: "p1", name: "Core", currency: "USD", benchmark_symbol: "SPY" }} onClose={vi.fn()} onChanged={vi.fn()} onDeleted={vi.fn()} />);
  expect(screen.getByLabelText("Benchmark")).toHaveValue("SPY");
});
