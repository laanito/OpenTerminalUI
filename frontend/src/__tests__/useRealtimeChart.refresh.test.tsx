import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bar } from "oakscriptjs";
import { useQuotesStore } from "../realtime/useQuotesStream";
import { useUSQuotesStore } from "../realtime/useUsQuotesStream";
import { useRealtimeChart } from "../shared/chart/useRealtimeChart";

const streams = vi.hoisted(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("../realtime/useQuotesStream", async (original) => ({
  ...await original<typeof import("../realtime/useQuotesStream")>(),
  useQuotesStream: () => streams,
}));
vi.mock("../realtime/useUsQuotesStream", async (original) => ({
  ...await original<typeof import("../realtime/useUsQuotesStream")>(),
  useUSQuotesStream: () => streams,
}));

const time = Date.parse("2026-11-14T00:00:00Z") / 1000;
const fullBar: Bar = { time, open: 66944, high: 67400, low: 66600, close: 67110, volume: 1234 };

describe("chart history refreshes", () => {
  beforeEach(() => {
    useQuotesStore.setState({ connectionState: "connected", ticksByToken: {}, candlesByKey: {} });
    useUSQuotesStore.setState({ lastTradeBySymbol: {}, closedBars1mBySymbol: {}, partialBar1mBySymbol: {} });
  });

  it("replaces a quote-only daily candle with full OHLCV at the same timestamp", () => {
    const { result, rerender } = renderHook(({ seed }) => useRealtimeChart("CRYPTO", "BTC-USD", "1D", seed, true),
      { initialProps: { seed: [] as Bar[] } });
    act(() => useQuotesStore.getState().upsertTick({
      token: "CRYPTO:BTC-USD", market: "CRYPTO", symbol: "BTC-USD", ltp: 66941.09,
      change: 0, change_pct: 0, oi: null, volume: null, ts: "2026-11-14T00:01:00Z",
    }));
    expect(result.current.bars[0]).toMatchObject({ open: 66941.09, high: 66941.09, low: 66941.09, close: 66941.09, volume: 0 });
    rerender({ seed: [fullBar] });
    expect(result.current.realtimeMeta.currentBar).toEqual(fullBar);
    rerender({ seed: [{ ...fullBar, high: 67500, close: 67200, volume: 1500 }] });
    expect(result.current.realtimeMeta.currentBar).toMatchObject({ open: 66944, high: 67500, close: 67200, volume: 1500 });
  });

  it("accepts interior corrections and metadata while preserving identical-input references", () => {
    const seed = [{ ...fullBar, time: time - 86400 }, fullBar];
    const { result, rerender } = renderHook(({ seed }) => useRealtimeChart("CRYPTO", "BTC-USD", "1D", seed, false),
      { initialProps: { seed } });
    const original = result.current.bars;
    rerender({ seed: seed.map((row) => ({ ...row })) });
    expect(result.current.bars).toBe(original);
    rerender({ seed: [{ ...seed[0], high: 68000, s: "regular", ext: true } as Bar, fullBar] });
    expect(result.current.bars[0]).toMatchObject({ high: 68000, s: "regular", ext: true });
  });

  it("keeps known bucket open, extremes and volume when a live aggregate starts mid-candle", () => {
    const seed = [fullBar];
    const { result } = renderHook(() => useRealtimeChart("CRYPTO", "BTC-USD", "1m", seed, true));
    act(() => useQuotesStore.getState().upsertCandle({
      token: "CRYPTO:BTC-USD", interval: "1m", t: time * 1000,
      o: 66941.09, h: 67110, l: 66941.09, c: 67110, v: 0,
    }));
    expect(result.current.bars[0]).toEqual(fullBar);
    act(() => useQuotesStore.getState().upsertCandle({
      token: "CRYPTO:BTC-USD", interval: "1m", t: time * 1000,
      o: 66941.09, h: 68000, l: 66000, c: 67800, v: 10,
    }));
    expect(result.current.bars[0]).toMatchObject({ open: 66944, high: 68000, low: 66000, close: 67800, volume: 1234 });
    act(() => useQuotesStore.getState().upsertCandle({
      token: "CRYPTO:BTC-USD", interval: "1m", t: (time + 60) * 1000,
      o: 67900, h: 67900, l: 67900, c: 67900, v: 2,
    }));
    expect(result.current.bars).toHaveLength(2);
    expect(result.current.bars[1]).toMatchObject({ open: 67900, high: 67900, low: 67900, close: 67900, volume: 2 });
  });
});
