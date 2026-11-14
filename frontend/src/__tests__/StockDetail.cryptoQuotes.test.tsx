import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockDetailPage } from "../pages/StockDetail";
import { useStockStore } from "../store/stockStore";
import { useSettingsStore } from "../store/settingsStore";

const mocks = vi.hoisted(() => ({
  fetchQuotes: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), market: vi.fn(),
  chartProps: null as any,
  stock: { current_price: null, change_pct: null } as any,
  ticks: {} as Record<string, any>,
  chart: { currency: "USD", data: [{ t: 1792520000, o: 82000, h: 83000, l: 81000, c: 82500, v: 10 }] },
}));
vi.mock("../api/client", async (original) => ({
  ...await original<typeof import("../api/client")>(), fetchQuotesBatch: mocks.fetchQuotes,
}));
vi.mock("../hooks/useStocks", () => ({
  useStock: () => ({ data: mocks.stock }), useStockHistory: () => ({ data: mocks.chart }),
  useStockReturns: () => ({}), useEquityPerformance: () => ({}), useDeliverySeries: () => ({}),
  useFinancials: () => ({}), useNextEarnings: () => ({}),
}));
vi.mock("../hooks/useDisplayCurrency", () => ({
  useDisplayCurrency: () => ({ formatDisplayMoney: (value: number) => `$${value.toFixed(2)}` }),
}));
vi.mock("../realtime/useQuotesStream", () => ({
  useQuotesStream: (market: string) => {
    mocks.market(market);
    return { subscribe: mocks.subscribe, unsubscribe: mocks.unsubscribe, isConnected: false, connectionState: "disconnected" };
  },
  useQuotesStore: (selector: any) => selector({ ticksByToken: mocks.ticks }),
}));
vi.mock("../shared/chart/ChartEngine", () => ({
  ChartEngine: (props: any) => { mocks.chartProps = props; return <div>Chart fixture</div>; },
}));
vi.mock("../shared/chart/IndicatorPanel", () => ({ IndicatorPanel: () => null }));
vi.mock("../components/crypto/CryptoOverviewPanel", () => ({ CryptoOverviewPanel: () => null }));
vi.mock("../components/terminal/AiInsightCard", () => ({ AiInsightCard: () => null }));
vi.mock("../components/market/TickerNewsCard", () => ({ TickerNewsCard: () => null }));

function renderPage() { return render(<MemoryRouter><StockDetailPage /></MemoryRouter>); }
function latest() { return within(screen.getByText("Latest Price").closest("section")!); }

describe("StockDetail crypto quote routing", () => {
  beforeEach(() => {
    mocks.fetchQuotes.mockReset().mockResolvedValue({ quotes: [] });
    mocks.market.mockClear(); mocks.subscribe.mockClear(); mocks.unsubscribe.mockClear();
    mocks.chartProps = null; mocks.ticks = {}; mocks.stock = { current_price: null, change_pct: null };
    mocks.chart = { currency: "USD", data: [{ t: 1792520000, o: 82000, h: 83000, l: 81000, c: 82500, v: 10 }] };
    useStockStore.setState({ ticker: "BTC-USD", interval: "1d", range: "1y" });
    useSettingsStore.setState({ selectedMarket: "NASDAQ" });
  });

  it("uses CRYPTO for both snapshot and chart despite an equity market selection", async () => {
    mocks.fetchQuotes.mockResolvedValue({ quotes: [{ last: 82521.45, change: 535.14, changePct: 0.65 }] });
    renderPage();
    expect(await latest().findByText("$82521.45")).toBeVisible();
    expect(mocks.fetchQuotes).toHaveBeenCalledWith(["BTC-USD"], "CRYPTO");
    await waitFor(() => expect(mocks.chartProps.market).toBe("CRYPTO"));
    expect(mocks.market).toHaveBeenCalledWith("CRYPTO");
    expect(latest().getByText("+535.14")).toBeVisible();
    expect(latest().getByText("+0.65%")).toBeVisible();
  });

  it.each([null, 0, NaN, Infinity])("does not turn a missing/invalid quote (%s) into $0.00", async (last) => {
    mocks.fetchQuotes.mockResolvedValue({ quotes: [{ last, change: 0, changePct: 0 }] });
    renderPage();
    await waitFor(() => expect(mocks.fetchQuotes).toHaveBeenCalledOnce());
    expect(latest().queryByText("$0.00")).not.toBeInTheDocument();
    expect(latest().queryByText("+0.00%")).not.toBeInTheDocument();
    expect(latest().getAllByText("-")).toHaveLength(3);
  });

  it("ignores an invalid chart tick without masking a valid crypto tick", async () => {
    mocks.ticks = { "CRYPTO:BTC-USD": { ltp: 82521.45, change: 535.14, change_pct: 0.65 } };
    renderPage(); await waitFor(() => expect(mocks.chartProps).not.toBeNull());
    act(() => mocks.chartProps.onTick({ ltp: 0, change_pct: 0 }));
    expect(latest().getByText("$82521.45")).toBeVisible();
    expect(latest().getByText("+0.65%")).toBeVisible();
  });

  it("forwards refreshed OHLCV without requiring a new candle timestamp", async () => {
    const view = renderPage();
    await waitFor(() => expect(mocks.chartProps?.historicalData[0].open).toBe(82000));
    mocks.chart = { ...mocks.chart, data: [{ ...mocks.chart.data[0], o: 66944, h: 67400, l: 66600, c: 67110, v: 1234 }] };
    view.rerender(<MemoryRouter><StockDetailPage /></MemoryRouter>);
    await waitFor(() => expect(mocks.chartProps.historicalData[0]).toMatchObject({ open: 66944, high: 67400, low: 66600, close: 67110, volume: 1234 }));
  });

  it("inspects the hovered candle's complete OHLCV despite a flat latest bar", async () => {
    mocks.fetchQuotes.mockResolvedValue({ quotes: [{ last: 67110, change: 10, changePct: 0.01 }] });
    renderPage();
    await waitFor(() => expect(mocks.chartProps).not.toBeNull());
    const candle = screen.getByRole("group", { name: "Candle values" });
    const flat = { time: 1792520000, open: 66941.09, high: 66941.09, low: 66941.09, close: 66941.09, volume: 0 };
    act(() => mocks.chartProps.onRealtimeMeta({ status: "live", currentBar: flat }));
    expect(candle).toHaveTextContent("O:66941.09");
    act(() => mocks.chartProps.onCrosshairOHLC({ time: 1792433600, open: 66944, high: 67500, low: 66500, close: 67100, volume: 4321 }));
    expect(candle).toHaveTextContent("O:66944.00");
    expect(candle).toHaveTextContent("H:67500.00");
    expect(candle).toHaveTextContent("L:66500.00");
    expect(candle).toHaveTextContent("C:67100.00");
    expect(candle).toHaveTextContent(`V:${(4321).toLocaleString()}`);
    expect(await latest().findByText("$67110.00")).toBeVisible();
    act(() => mocks.chartProps.onRealtimeMeta({ status: "live", currentBar: { ...flat, close: 67112 } }));
    expect(candle).toHaveTextContent("C:67100.00");
    act(() => mocks.chartProps.onCrosshairOHLC(null));
    expect(candle).toHaveTextContent("O:66941.09");
    expect(candle).toHaveTextContent("C:67112.00");
    expect(candle).toHaveTextContent("V:0");
  });

  it("clears inspected candles on scope change and never borrows latest volume for missing hover volume", async () => {
    renderPage();
    await waitFor(() => expect(mocks.chartProps).not.toBeNull());
    const candle = screen.getByRole("group", { name: "Candle values" });
    act(() => mocks.chartProps.onCrosshairOHLC({ time: 1, open: 1, high: 3, low: 0.5, close: 2 }));
    expect(candle).toHaveTextContent("O:1.00");
    expect(candle).toHaveTextContent("V:-");
    act(() => useStockStore.setState({ interval: "1h" }));
    expect(candle).toHaveTextContent("O:82000.00");
  });

  it("retains equity routing for non-crypto symbols", async () => {
    useStockStore.setState({ ticker: "^GSPC" });
    renderPage();
    expect(mocks.fetchQuotes).toHaveBeenCalledWith(["^GSPC"], "NASDAQ");
    await waitFor(() => expect(mocks.chartProps.market).toBe("NASDAQ"));
  });
});
