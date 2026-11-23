import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SavedViewsControl } from "../components/savedViews/SavedViewsControl";
import { useStockStore } from "../store/stockStore";

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), navigate: vi.fn() }));
vi.mock("../api/client", () => ({ listSavedViews: (...args: unknown[]) => mocks.list(...args), createSavedView: (...args: unknown[]) => mocks.create(...args), updateSavedView: (...args: unknown[]) => mocks.update(...args), deleteSavedView: (...args: unknown[]) => mocks.remove(...args) }));
vi.mock("react-router-dom", async original => ({ ...await original<typeof import("react-router-dom")>(), useNavigate: () => mocks.navigate }));
const view = { id: "v1", name: "Dated portfolio review", scope: "portfolio", page: "/equity/portfolio", description: "A saved configuration", updated_at: "2026-11-23T12:00:00Z", payload: { page: "/equity/portfolio", search: "?reporting_currency=EUR", selectedTicker: "SAP.DE", shellPreset: "quant", filters: { scope: "all" }, storage: { "ot:portfolio:view:v1": { scope: "all" } } } };
function setup(library = true) { return render(<MemoryRouter initialEntries={["/equity/screener?screen=quality"]}><SavedViewsControl pageLabel="Screener" capture={() => ({ filters: { query: "ROE > 20" }, activeTabs: { view: "table" } })} library={library} /></MemoryRouter>); }

describe("Saved view capture and restore", () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.list.mockResolvedValue([view]); useStockStore.setState({ ticker: "AAPL" }); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it("uses all scopes for the library and captures the opening page/ticker before the name is submitted", async () => {
    setup(); await screen.findByRole("article", { name: view.name }); expect(mocks.list).toHaveBeenCalledWith(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Save view", exact: true }));
    const dialog = screen.getByRole("dialog", { name: "Save view", exact: true });
    act(() => useStockStore.setState({ ticker: "MSFT" }));
    mocks.create.mockResolvedValue({ ...view, id: "v2", name: "Quality" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "View name" }), { target: { value: "Quality" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save view", exact: true }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Quality", scope: "screener", page: "/equity/screener", payload: expect.objectContaining({ page: "/equity/screener", search: "?screen=quality", selectedTicker: "AAPL", filters: { query: "ROE > 20" }, activeTabs: { view: "table" } }) })));
  });
  it("retains a rejected rename draft without replaying or replacing the library with empty data", async () => {
    setup(); await screen.findByRole("article", { name: view.name }); mocks.update.mockRejectedValue(new Error("provider internals"));
    fireEvent.click(screen.getByRole("button", { name: "Rename", exact: true }));
    const dialog = screen.getByRole("dialog", { name: "Rename saved view", exact: true });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "View name" }), { target: { value: "Renamed review" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save name", exact: true }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("Your draft is still here"));
    expect(within(dialog).getByRole("textbox")).toHaveValue("Renamed review"); expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("alert")).not.toHaveTextContent("provider internals");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel", exact: true }));
    mocks.list.mockRejectedValue(new Error("offline")); fireEvent.click(screen.getByRole("button", { name: "Refresh views", exact: true }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("not been refreshed")); expect(screen.getByRole("article", { name: view.name })).toBeVisible();
  });
  it("preserves restoration order and the pending payload contract", async () => {
    setup(); await screen.findByRole("article", { name: view.name }); vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Apply", exact: true }));
    expect(JSON.parse(localStorage.getItem("ot:portfolio:view:v1") || "{}")).toEqual({ scope: "all" });
    expect(JSON.parse(localStorage.getItem("ot:saved-view:pending") || "{}")).toEqual(view.payload);
    expect(useStockStore.getState().ticker).toBe("SAP.DE"); expect(mocks.navigate).toHaveBeenCalledWith("/equity/portfolio?reporting_currency=EUR");
    vi.clearAllTimers();
  });
  it("keeps workflow controls scoped and puts the library in a dialog", async () => {
    setup(false); await waitFor(() => expect(mocks.list).toHaveBeenCalledWith({ scope: "screener" }));
    fireEvent.click(screen.getByRole("button", { name: "Saved views", exact: true }));
    expect(screen.getByRole("dialog", { name: "Screener saved views", exact: true })).toContainElement(screen.getByRole("article", { name: view.name }));
  });
  it("keeps a confirmed creation visible when the following refresh fails", async () => {
    mocks.list.mockResolvedValueOnce([view]).mockRejectedValue(new Error("offline")); setup(); await screen.findByRole("article", { name: view.name });
    mocks.create.mockResolvedValue({ ...view, id: "confirmed", name: "Confirmed setup" });
    fireEvent.click(screen.getByRole("button", { name: "Save view", exact: true }));
    const dialog = screen.getByRole("dialog", { name: "Save view", exact: true });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Confirmed setup" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save view", exact: true }));
    await screen.findByRole("article", { name: "Confirmed setup" });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not refresh saved views"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("ignores an earlier library read after the same control switches to workflow scope", async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.list.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue([{ ...view, name: "Scoped result", scope: "screener" }]);
    const root = setup();
    root.rerender(<MemoryRouter initialEntries={["/equity/screener"]}><SavedViewsControl pageLabel="Screener" /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Saved views", exact: true }));
    await screen.findByRole("article", { name: "Scoped result" });
    await act(async () => { resolveOld([view]); });
    expect(screen.queryByRole("article", { name: view.name })).not.toBeInTheDocument(); expect(screen.getByRole("article", { name: "Scoped result" })).toBeVisible();
  });

  it("does not let a previous refresh enable a second write that is still pending", async () => {
    const first = { ...view, name: "First name" }, second = { ...view, name: "Second name" };
    let resolveRefresh!: (rows: unknown) => void, resolveWrite!: (row: unknown) => void;
    mocks.list.mockReset().mockResolvedValueOnce([view]).mockReturnValueOnce(new Promise(resolve => { resolveRefresh = resolve; })).mockResolvedValue([second]);
    mocks.update.mockReset().mockResolvedValueOnce(first).mockReturnValueOnce(new Promise(resolve => { resolveWrite = resolve; }));
    setup(); await screen.findByRole("article", { name: view.name });
    fireEvent.click(screen.getByRole("button", { name: "Rename", exact: true }));
    let dialog = screen.getByRole("dialog", { name: "Rename saved view", exact: true });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "First name" } }); fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));
    await screen.findByRole("article", { name: "First name" });
    fireEvent.click(screen.getByRole("button", { name: "Rename", exact: true })); dialog = screen.getByRole("dialog", { name: "Rename saved view", exact: true });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Second name" } }); fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));
    await act(async () => { resolveRefresh([first]); });
    expect(within(dialog).getByRole("button", { name: "Save name" })).toBeDisabled(); expect(mocks.update).toHaveBeenCalledTimes(2);
    await act(async () => { resolveWrite(second); }); await screen.findByRole("article", { name: "Second name" });
  });

});
