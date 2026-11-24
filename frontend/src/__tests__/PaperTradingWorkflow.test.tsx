import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperTradingPage } from "../pages/PaperTrading";
const mocks = vi.hoisted(() => ({ accounts: vi.fn(), positions: vi.fn(), orders: vi.fn(), trades: vi.fn(), performance: vi.fn(), create: vi.fn(), order: vi.fn() }));
vi.mock("../api/client", () => ({ fetchPaperPortfolios: (...args: unknown[]) => mocks.accounts(...args), fetchPaperPositions: (...args: unknown[]) => mocks.positions(...args), fetchPaperOrders: (...args: unknown[]) => mocks.orders(...args), fetchPaperTrades: (...args: unknown[]) => mocks.trades(...args), fetchPaperPerformance: (...args: unknown[]) => mocks.performance(...args), createPaperPortfolio: (...args: unknown[]) => mocks.create(...args), placePaperOrder: (...args: unknown[]) => mocks.order(...args) }));
vi.mock("../components/trading/HotKeyPanel", () => ({ HotKeyPanel: ({ portfolioId }: { portfolioId: string }) => <p>Hotkey account: {portfolioId}</p> }));
const accounts = [{ id: "one", name: "Research account", initial_capital: 100000, current_cash: 90000 }, { id: "two", name: "Independent account", initial_capital: 20000, current_cash: 15000 }];
const position = { id: "position", symbol: "AAPL", quantity: 2.5, avg_entry_price: 100, mark_price: 120, unrealized_pnl: 50 };
const order = { id: "order", symbol: "AAPL", side: "buy", order_type: "limit", quantity: 2.5, status: "pending", fill_price: null };
function page() { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); render(<QueryClientProvider client={client}><PaperTradingPage /></QueryClientProvider>); return client; }
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); mocks.accounts.mockResolvedValue(accounts); mocks.positions.mockResolvedValue([position]); mocks.orders.mockResolvedValue([]); mocks.trades.mockResolvedValue([]); mocks.performance.mockResolvedValue({ equity: 90300, pnl: 50, cumulative_return: .0005 }); });
describe("Paper account workflow", () => {
  it("keeps activity and hotkeys on one selected account and withholds unknown metrics", async () => {
    mocks.performance.mockRejectedValue(new Error("offline")); page(); await screen.findByRole("article", { name: "AAPL paper position" });
    expect(screen.getByText("Equity (account units)").nextElementSibling).toHaveTextContent("Unavailable");
    expect(screen.getByText("Return").nextElementSibling).toHaveTextContent("Unavailable");
    fireEvent.change(screen.getByLabelText("Paper portfolio"), { target: { value: "two" } });
    await waitFor(() => expect(mocks.positions).toHaveBeenCalledWith("two"));
    const details = screen.getByText("Hotkey trading", { selector: "summary" }).parentElement as HTMLDetailsElement; details.open = true; fireEvent(details, new Event("toggle"));
    expect(await screen.findByText("Hotkey account: two")).toBeInTheDocument();
    expect(localStorage.getItem("ot:paper:selected-portfolio:v1")).toBe("two");
  });
  it("does not let a late old-account read replace the selected account", async () => {
    let finish!: (data: typeof position[]) => void;
    mocks.positions.mockImplementation((id: string) => id === "one" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([{ ...position, symbol: "MSFT" }]));
    page(); await screen.findByText("Research account", { selector: "p" });
    fireEvent.change(screen.getByLabelText("Paper portfolio"), { target: { value: "two" } }); await screen.findByRole("article", { name: "MSFT paper position" });
    await act(async () => { finish([position]); });
    expect(screen.queryByRole("article", { name: "AAPL paper position" })).not.toBeInTheDocument();
  });
  it("retains a failed limit draft and separates a confirmed order from failed reads", async () => {
    mocks.order.mockRejectedValueOnce(new Error("PRIVATE_UPSTREAM_CONTEXT")).mockResolvedValueOnce(order); page(); await screen.findByRole("article", { name: "AAPL paper position" });
    fireEvent.click(screen.getByRole("button", { name: "Place paper order" }));
    fireEvent.change(screen.getByLabelText("Order type"), { target: { value: "limit" } }); fireEvent.change(screen.getByLabelText("Quantity (asset units)"), { target: { value: "2.5" } }); fireEvent.change(screen.getByLabelText("Limit price (quote units)"), { target: { value: "123.125" } });
    fireEvent.submit(screen.getByRole("form", { name: "Paper order" }));
    await screen.findByRole("alert"); expect(screen.getByRole("alert")).not.toHaveTextContent("PRIVATE_UPSTREAM_CONTEXT"); expect(screen.getByLabelText("Limit price (quote units)")).toHaveValue(123.125);
    mocks.orders.mockRejectedValue(new Error("offline")); fireEvent.submit(screen.getByRole("form", { name: "Paper order" }));
    await screen.findByRole("article", { name: "AAPL paper order" }); await screen.findByText(/Could not refresh orders/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(mocks.order).toHaveBeenCalledTimes(2);
    expect(mocks.order).toHaveBeenLastCalledWith({ portfolio_id: "one", symbol: "AAPL", side: "buy", order_type: "limit", quantity: 2.5, limit_price: 123.125, sl_price: undefined });
    expect(screen.getByText("Paper order received · pending.")).toBeInTheDocument();
  });
  it("locks one pending stop order to its opening account without duplicate writes", async () => {
    let finish!: (data: typeof order) => void; mocks.order.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    page(); await screen.findByRole("article", { name: "AAPL paper position" }); fireEvent.click(screen.getByRole("button", { name: "Place paper order" }));
    fireEvent.change(screen.getByLabelText("Order type"), { target: { value: "sl" } }); fireEvent.change(screen.getByLabelText("Stop price (quote units)"), { target: { value: "90.5" } });
    const form = screen.getByRole("form", { name: "Paper order" }); fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(mocks.order).toHaveBeenCalledTimes(1)); expect(screen.getByLabelText("Paper portfolio")).toBeDisabled();
    expect(mocks.order).toHaveBeenCalledWith(expect.objectContaining({ portfolio_id: "one", order_type: "sl", sl_price: 90.5, limit_price: undefined }));
    await act(async () => { finish(order); });
  });
  it("ignores pre-order analytics that finish after confirmation", async () => {
    let finish!: (data: { equity: number }) => void;
    const oldRead = new Promise(resolve => { finish = resolve; });
    mocks.performance.mockReturnValueOnce(oldRead).mockResolvedValue({ equity: 90333, pnl: 333, cumulative_return: .00333 });
    mocks.order.mockResolvedValue(order); page(); await screen.findByRole("article", { name: "AAPL paper position" });
    fireEvent.click(screen.getByRole("button", { name: "Place paper order" })); fireEvent.submit(screen.getByRole("form", { name: "Paper order" }));
    await screen.findByText("Paper order received · pending.");
    await waitFor(() => expect(screen.getByText("Equity (account units)").nextElementSibling).toHaveTextContent("90,333.00"));
    await act(async () => { finish({ equity: 1 }); await oldRead; });
    expect(screen.getByText("Equity (account units)").nextElementSibling).toHaveTextContent("90,333.00");
  });
  it("keeps confirmed account creation when list refresh fails", async () => {
    const created = { ...accounts[0], id: "created", name: "New research" }; mocks.create.mockResolvedValue(created);
    page(); await screen.findByRole("article", { name: "AAPL paper position" }); fireEvent.click(screen.getByRole("button", { name: "New paper portfolio" }));
    fireEvent.change(screen.getByLabelText("Portfolio name"), { target: { value: "New research" } }); mocks.accounts.mockRejectedValue(new Error("offline"));
    fireEvent.submit(screen.getByRole("form", { name: "Create paper portfolio" }));
    await screen.findByText("Paper portfolio created."); expect(screen.getByLabelText("Paper portfolio")).toHaveValue("created");
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
