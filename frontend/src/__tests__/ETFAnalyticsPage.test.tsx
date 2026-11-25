/** @vitest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ETFAnalyticsPage } from "../pages/ETFAnalytics";

const getMock = vi.fn();

// The ETF components now call the shared axios `api` client (so the bearer token
// is attached) instead of a raw fetch.
vi.mock("../api/base", () => ({
  api: { get: (...args: unknown[]) => getMock(...args) },
}));

describe("ETFAnalyticsPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockImplementation(async (url: string) => {
      if (url.includes("/etf/holdings")) {
        return {
          data: {
            ticker: "SPY",
            holdings: [
              { symbol: "AAPL", name: "Apple Inc.", weight: 7.1 },
              { symbol: "MSFT", name: "Microsoft Corp.", weight: 6.5 },
            ],
          },
        };
      }
      if (url.includes("/etf/flows")) {
        return {
          data: {
            ticker: "SPY",
            flows: [
              { date: "2024-03-01", net_flow: 150.5 },
              { date: "2024-03-02", net_flow: -20.2 },
            ],
          },
        };
      }
      if (url.includes("/etf/overlap")) {
        return {
          data: {
            tickers: ["SPY", "VOO"],
            overlap_pct: 95.2,
            common_holdings: [{ symbol: "AAPL", name: "Apple Inc.", weight: 7.0 }],
          },
        };
      }
      throw new Error(`Unhandled api.get: ${url}`);
    });
  });

  it("renders ETF Analytics page with components", async () => {
    render(
      <MemoryRouter initialEntries={["/equity/etf-analytics?ticker=SPY"]}>
        <Routes>
          <Route path="/equity/etf-analytics" element={<ETFAnalyticsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("ETF Analytics & Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Holdings Analysis: SPY")).toBeInTheDocument();
    expect(screen.getByText("Fund Flows: SPY")).toBeInTheDocument();
    expect(screen.getByText("Overlap Analysis")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText("AAPL").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Apple Inc.").length).toBeGreaterThan(0);
      expect(screen.getByText("+95.20% Overlap")).toBeInTheDocument();
    });
  });
  it("applies labelled drafts only on submission and retains the applied comparison after invalid input", async () => {
    render(<MemoryRouter><ETFAnalyticsPage /></MemoryRouter>);
    await screen.findByText("+95.20% Overlap");
    getMock.mockClear();
    fireEvent.change(screen.getByRole("textbox", { name: "ETF ticker" }), { target: { value: "QQQ" } });
    expect(getMock).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole("form", { name: "ETF scope" }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/etf/holdings", { params: { ticker: "QQQ" } }));
    fireEvent.change(screen.getByRole("textbox", { name: "Comparison tickers" }), { target: { value: "SPY" } });
    fireEvent.submit(screen.getByRole("form", { name: "ETF comparison" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at least two");
    expect(screen.getByText("+95.20% Overlap")).toBeInTheDocument();
    expect(getMock.mock.calls.filter(([path]) => path === "/etf/overlap")).toHaveLength(0);
  });

  it("ignores late ETF reads and exposes a scoped retry without raw provider errors", async () => {
    const normal = getMock.getMockImplementation()!;
    let release: ((value: unknown) => void) | undefined;
    let failNew = true;
    getMock.mockImplementation((path, options) => {
      if (path === "/etf/holdings" && options.params.ticker === "SPY") return new Promise(resolve => { release = resolve; });
      if (path === "/etf/holdings" && options.params.ticker === "QQQ") return failNew ? Promise.reject(new Error("PRIVATE_PROVIDER_CONTEXT")) : Promise.resolve({ data: { holdings: [{ symbol: "NEWCO", name: "New scoped holding", weight: 5 }] } });
      return normal(path, options);
    });
    render(<MemoryRouter><ETFAnalyticsPage /></MemoryRouter>);
    await waitFor(() => expect(release).toBeTypeOf("function"));
    fireEvent.change(screen.getByRole("textbox", { name: "ETF ticker" }), { target: { value: "QQQ" } });
    fireEvent.submit(screen.getByRole("form", { name: "ETF scope" }));
    await screen.findByRole("button", { name: "Retry holdings" });
    expect(screen.queryByText("PRIVATE_PROVIDER_CONTEXT")).not.toBeInTheDocument();
    failNew = false; fireEvent.click(screen.getByRole("button", { name: "Retry holdings" }));
    await screen.findByText("New scoped holding");
    await act(async () => { release?.({ data: { holdings: [{ symbol: "OLDCO", name: "Old stale holding", weight: 99 }] } }); });
    expect(screen.queryByText("Old stale holding")).not.toBeInTheDocument();
    expect(screen.getByText("New scoped holding")).toBeInTheDocument();
  });

});
