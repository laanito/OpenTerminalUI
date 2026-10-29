import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api/base";
import { fetchCollectionBriefing, fetchStockBriefing, fetchStockInterrogation } from "../api/sentiment";
import { streamInsight } from "../api/insightLifecycle";

vi.mock("../api/base", () => ({
  api: { post: vi.fn() },
}));
vi.mock("../api/insightLifecycle", () => ({ streamInsight: vi.fn() }));

describe("AI request deadlines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(streamInsight).mockResolvedValue({ engine: "unavailable", model: "test", summary: "unavailable", sections: [] });
  });

  it("uses announced lifecycle deadlines for collections and preserves research refresh/market input", async () => {
    const facts = [{ symbol: "SPY", price: 6500, change_pct: 0.2 }];
    await fetchCollectionBriefing(["SPY", "QQQ"], "global markets", facts);

    expect(streamInsight).toHaveBeenCalledWith(
      "collection",
      { symbols: ["SPY", "QQQ"], scope: "global markets", facts },
      {},
    );
    const options = { signal: new AbortController().signal };
    await fetchStockBriefing("BTC-USD", "CRYPTO", true, options);
    await fetchStockInterrogation("AAPL", "NASDAQ", true, options);
    expect(streamInsight).toHaveBeenCalledWith("briefing", { ticker: "BTC-USD", market: "CRYPTO", refresh: true }, options);
    expect(streamInsight).toHaveBeenCalledWith("interrogate", { ticker: "AAPL", market: "NASDAQ", refresh: true }, options);
    expect(api.post).not.toHaveBeenCalled();
  });
});
