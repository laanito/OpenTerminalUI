/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
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
});
