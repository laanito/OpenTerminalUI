import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DenseTable } from "../components/terminal/DenseTable";

beforeEach(() => localStorage.clear());
const rows = Array.from({ length: 100 }, (_, index) => ({ id: index, quantity: index + 1 }));
it("honors row height and brings the last virtual row into keyboard focus", async () => {
  render(<DenseTable id="keyboard" ariaLabel="Original lots" rows={rows} rowKey={row => String(row.id)} height={180} rowHeight={44} columns={[{ key: "quantity", title: "Quantity", sortable: true, getValue: row => row.quantity }]} />);
  const grid = screen.getByRole("grid", { name: "Original lots" });
  expect(within(grid).getAllByRole("row")[1]).toHaveStyle({ height: "44px" });
  grid.focus(); fireEvent.keyDown(grid, { key: "End" });
  await waitFor(() => expect(grid.querySelector('[data-row-index="99"]')).toHaveFocus());
  expect(grid.scrollTop).toBeGreaterThan(4000);
  expect(within(grid).getByRole("row", { selected: true })).toHaveAttribute("aria-rowindex", "101");
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  await waitFor(() => expect(grid.querySelector('[data-row-index="0"]')).toHaveFocus());
  expect(grid.scrollTop).toBe(0);
  fireEvent.click(screen.getByTitle("Quantity")); fireEvent.click(screen.getByTitle("Quantity"));
  grid.focus(); fireEvent.keyDown(grid, { key: "Home" });
  await waitFor(() => expect(grid.querySelector('[data-row-index="99"]')).toHaveFocus());
  expect(within(grid).getByRole("row", { selected: true })).toHaveAttribute("aria-rowindex", "2");
});
it("leaves row buttons and inputs in control of their own keys and clicks", () => {
  const open = vi.fn(), clicked = vi.fn();
  render(<DenseTable id="controls" rows={rows.slice(0, 1)} rowKey={row => String(row.id)} onRowClick={open} columns={[{ key: "actions", title: "Actions", render: () => <><button onClick={clicked}>Sell</button><input type="number" aria-label="Units" defaultValue={2} /></> }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Sell" })); expect(clicked).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled();
  const input = screen.getByLabelText("Units");
  expect(fireEvent.keyDown(input, { key: "ArrowUp" })).toBe(true);
  expect(screen.queryByRole("row", { selected: true })).not.toBeInTheDocument();
});
it("supports column resize and Escape from column options with focus return", async () => {
  render(<DenseTable id="columns" rows={rows.slice(0, 1)} rowKey={row => String(row.id)} columns={[{ key: "quantity", title: "Quantity", width: 100, sortable: true, getValue: row => row.quantity }]} />);
  const resize = screen.getByRole("separator", { name: "Resize column Quantity" });
  fireEvent.keyDown(resize, { key: "ArrowRight" }); expect(resize).toHaveAttribute("aria-valuenow", "110");
  const menu = screen.getByRole("button", { name: "Column menu for Quantity" });
  fireEvent.click(menu); expect(menu).toHaveAttribute("aria-expanded", "true");
  const options = screen.getByRole("group", { name: "Quantity column options" });
  fireEvent.keyDown(within(options).getByRole("button", { name: "Move Left" }), { key: "Escape" });
  await waitFor(() => expect(menu).toHaveFocus());
  expect(menu).toHaveAttribute("aria-expanded", "false");
});
it("reveals default-hidden evidence columns and persists that choice", () => {
  const columns = [{ key: "quantity", title: "Quantity", getValue: (row: typeof rows[number]) => row.quantity }, { key: "evidence", title: "Evidence", hidden: true, getValue: () => "Original dated source" }];
  const props = { id: "evidence-columns", rows: rows.slice(0, 1), rowKey: (row: typeof rows[number]) => String(row.id), columns };
  const { unmount } = render(<DenseTable {...props} />);
  expect(screen.queryByRole("columnheader", { name: /Evidence/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show Hidden (1)" }));
  expect(screen.getByTitle("Original dated source")).toBeInTheDocument();
  unmount(); render(<DenseTable {...props} />);
  expect(screen.getByTitle("Original dated source")).toBeInTheDocument();
});
