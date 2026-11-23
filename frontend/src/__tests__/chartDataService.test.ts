import { afterEach, describe, expect, it, vi } from "vitest";

import { setAccessTokenGetter, setRefreshHandler } from "../api/base";
import { fetchChartData } from "../services/chartDataService";

describe("fetchChartData", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setAccessTokenGetter(null); setRefreshHandler(null);
  });

  it("calls unified chart endpoint with normalized flag", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        symbol: "AAPL",
        interval: "1m",
        count: 1,
        data: [{ t: 1, o: 2, h: 3, l: 1, c: 2, v: 10 }],
      }),
    } as Response);

    const result = await fetchChartData("AAPL", { market: "NASDAQ", interval: "1m", period: "1d" });

    expect(result.symbol).toBe("AAPL");
    expect(result.count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/chart/AAPL?");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("normalized=true");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("market=NASDAQ");
  });
  it("authenticates listed-symbol charts and refreshes a rejected token once", async () => {
    setAccessTokenGetter(() => "old-token");
    const refresh = vi.fn().mockResolvedValue("fresh-token"); setRefreshHandler(refresh);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: false, status: 401 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ symbol: "MWRE.DE", count: 0, data: [] }) } as Response);
    const result = await fetchChartData("MWRE.DE", { market: "CRYPTO", interval: "1m", period: "1mo" });
    expect(result.symbol).toBe("MWRE.DE"); expect(refresh).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/chart/MWRE.DE?");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("market=CRYPTO");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer old-token");
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("Authorization")).toBe("Bearer fresh-token");
  });

});
