import { describe, expect, it } from "vitest";

import { backtestMarketForSelection } from "../pages/Backtesting";
import { useChartWorkstationStore } from "../store/chartWorkstationStore";
import {
  COUNTRY_DEFAULT_MARKET,
  DEFAULT_COUNTRY,
  DEFAULT_EQUITY_MARKET,
  DEFAULT_SCAN_MARKETS,
  benchmarkForMarket,
  equityRegionForMarket,
  equityUniverseForMarket,
} from "../types/markets";

describe("generic market defaults", () => {
  it("uses the fork-wide US equity context", () => {
    expect(DEFAULT_COUNTRY).toBe("US");
    expect(DEFAULT_EQUITY_MARKET).toBe("NASDAQ");
    expect(COUNTRY_DEFAULT_MARKET.US).toBe("NASDAQ");
    expect(DEFAULT_SCAN_MARKETS).toEqual(["NYSE", "NASDAQ"]);
    expect(equityRegionForMarket("NASDAQ")).toBe("US");
    expect(equityUniverseForMarket("NASDAQ")).toBe("sp_500");
    expect(benchmarkForMarket("NASDAQ")).toBe("SPY");
  });

  it("preserves explicit India context", () => {
    expect(equityRegionForMarket("NSE")).toBe("IN");
    expect(equityUniverseForMarket("BSE")).toBe("nse_500");
    expect(backtestMarketForSelection("NSE")).toBe("NSE");
    expect(benchmarkForMarket("BSE")).toBe("^NSEI");
  });

  it("falls unsupported backtest contexts and new chart panes back to US", () => {
    expect(backtestMarketForSelection("EU")).toBe("NASDAQ");
    useChartWorkstationStore.getState().addSlot();
    expect(useChartWorkstationStore.getState().slots.at(-1)?.market).toBe("US");
  });
});
