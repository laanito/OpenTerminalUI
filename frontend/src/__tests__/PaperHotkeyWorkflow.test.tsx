import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HotKeyPanel } from "../components/trading/HotKeyPanel";
const mocks = vi.hoisted(() => ({ order: vi.fn(), depth: vi.fn() }));
vi.mock("../api/client", () => ({ fetchPaperPortfolios: async () => [{ id: "one", name: "Research", current_cash: 10000, initial_capital: 10000 }, { id: "two", name: "Independent", current_cash: 1000, initial_capital: 1000 }], fetchPaperPositions: async () => [], fetchPaperOrders: async () => [], fetchDepth: (...args: unknown[]) => mocks.depth(...args), placePaperOrder: (...args: unknown[]) => mocks.order(...args) }));
function setup() { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); const pending = vi.fn(); render(<QueryClientProvider client={client}><HotKeyPanel portfolioId="one" onPendingChange={pending} /></QueryClientProvider>); return { client, pending }; }
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); mocks.depth.mockResolvedValue({ bids: [], asks: [] }); });
describe("Paper hotkey interaction", () => {
  it("never trades while typing in inputs and guards repeated/pending trade keys", async () => {
    let finish!: (value: any) => void; mocks.order.mockReturnValue(new Promise(resolve => { finish = resolve; })); setup(); await screen.findByText("Research");
    const quantity = screen.getByLabelText("Quantity"); fireEvent.focus(quantity); fireEvent.keyDown(quantity, { key: "b" }); fireEvent.keyDown(quantity, { key: "s" }); expect(mocks.order).not.toHaveBeenCalled();
    const root = screen.getByRole("region", { name: "Paper hotkey trading" }); fireEvent.focus(root); fireEvent.keyDown(root, { key: "b", repeat: true }); expect(mocks.order).not.toHaveBeenCalled();
    fireEvent.keyDown(root, { key: "b" }); fireEvent.keyDown(root, { key: "b" });
    await waitFor(() => expect(mocks.order).toHaveBeenCalledTimes(1)); expect(mocks.order.mock.calls[0][0]).toMatchObject({ portfolio_id: "one", side: "buy", order_type: "market", quantity: 1 });
    await act(async () => { finish({ id: "order", status: "pending" }); }); await screen.findByText(/order received · pending/);
  });
  it("keeps a failed hotkey draft visible without an unhandled replay", async () => {
    mocks.order.mockRejectedValue(new Error("PRIVATE_CONTEXT")); const { pending } = setup(); await screen.findByText("Research");
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } }); fireEvent.click(screen.getByRole("button", { name: "BUY (B)" }));
    await screen.findByRole("alert"); expect(screen.getByRole("alert")).not.toHaveTextContent("PRIVATE_CONTEXT"); expect(screen.getByLabelText("Quantity")).toHaveValue(3); expect(mocks.order).toHaveBeenCalledTimes(1); expect(pending).toHaveBeenLastCalledWith(false);
  });
  it("labels missing prices and estimated depth instead of presenting a missing quote as zero", async () => {
    const { client } = setup(); await screen.findByText("Research");
    expect(screen.getByLabelText("Hotkey last price")).toHaveTextContent("Unavailable");
    mocks.depth.mockResolvedValue({ last_price: 200, bids: [], asks: [] });
    await act(async () => { await client.invalidateQueries({ queryKey: ["hotkey-panel", "depth"] }); });
    await waitFor(() => expect(screen.getByLabelText("Hotkey last price")).toHaveTextContent("200.00"));
    expect(screen.getByText(/Estimated bid/)).toBeInTheDocument(); expect(screen.getByText(/Estimated ask/)).toBeInTheDocument();
  });

});
