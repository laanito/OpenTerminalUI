import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ConsolidatedPortfolioReport } from "../api/client";
import { PortfolioMovements } from "../components/portfolio/PortfolioMovements";
import { portfolioReportFixture } from "../../tests/e2e/portfolio-fixtures";
const reads = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ fetchPortfolioTransactions: reads }));
vi.mock("../components/terminal/DenseTable", () => ({ DenseTable: ({ rows }: any) => <div data-testid="rows">{JSON.stringify(rows)}</div> }));
const report = (scope = "all") => portfolioReportFixture(scope) as unknown as ConsolidatedPortfolioReport;
const movement = (id: string) => ({ id, symbol: "AAPL", type: "opening", shares: 1, price: 100, currency: "EUR", date: "2026-01-02", fees: 0 });
beforeEach(() => { reads.mockReset(); reads.mockImplementation(id => Promise.resolve([movement(id)])); });

it("is collapsed and does not read movements until opened, preserving zero versus missing accounting", async () => {
  const data = report();
  data.portfolios[0].accounting.transactions = [{ id: "p1", cash_delta_base: 0 }] as any;
  render(<PortfolioMovements report={data} onRepair={vi.fn()} />);
  expect(reads).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("All movements"));
  await screen.findByTestId("rows");
  const rows = JSON.parse(screen.getByTestId("rows").textContent!);
  expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ portfolioId: "p1", cashDelta: 0, currency: "EUR", price: 100 }), expect.objectContaining({ portfolioId: "p2", cashDelta: null })]));
});

it("ignores late movements from a previous scope", async () => {
  let finish!: (rows: any[]) => void;
  reads.mockImplementation(id => id === "p1" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([movement("p2")]));
  const { rerender } = render(<PortfolioMovements report={report("p1")} onRepair={vi.fn()} />);
  fireEvent.click(screen.getByText("All movements"));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  rerender(<PortfolioMovements report={report("p2")} onRepair={vi.fn()} />);
  await screen.findByTestId("rows");
  await act(async () => finish([movement("stale")]));
  expect(screen.getByTestId("rows")).toHaveTextContent('"portfolioId":"p2"');
  expect(screen.getByTestId("rows")).not.toHaveTextContent('"id":"stale"');
});

it("fails the whole movement list if any selected account cannot be read", async () => {
  reads.mockImplementation(id => id === "p1" ? Promise.resolve([movement("p1")]) : Promise.reject(new Error("offline")));
  render(<PortfolioMovements report={report()} onRepair={vi.fn()} />);
  fireEvent.click(screen.getByText("All movements"));
  await screen.findByRole("alert", { name: "Movements unavailable" });
  expect(screen.queryByTestId("rows")).not.toBeInTheDocument();
  expect(screen.queryByText("No recorded movements")).not.toBeInTheDocument();
});
