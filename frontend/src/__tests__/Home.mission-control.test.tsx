import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { MissionControlGrid } from "../components/home/MissionControlGrid";

vi.mock("../hooks/useStocks", () => ({
  useMarketStatus: () => ({
    data: {
      marketState: [{ marketStatus: "OPEN" }],
      sp500: 5762.48,
      sp500Pct: 0.83,
      nasdaq: 18340.1,
      nasdaqPct: -0.24,
      dowjones: 42120.0,
      dowjonesPct: 0.11,
    },
  }),
}));

vi.mock("../store/settingsStore", () => ({
  useSettingsStore: (selector: (state: { selectedMarket: string }) => unknown) =>
    selector({ selectedMarket: "US" }),
}));

describe("MissionControlGrid", () => {
  it("renders mission panels with US index values from the market-status payload", () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <MissionControlGrid />
      </MemoryRouter>,
    );

    expect(screen.getByText("Market Pulse")).toBeInTheDocument();
    expect(screen.getByText("Launch Matrix")).toBeInTheDocument();
    expect(screen.getByText("System Snapshot")).toBeInTheDocument();
    expect(screen.getByText("S&P 500")).toBeInTheDocument();
    expect(screen.getByText("5,762.48")).toBeInTheDocument();
    expect(screen.getByText("+0.83%")).toBeInTheDocument();
  });
});
