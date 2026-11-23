import { describe, expect, it } from "vitest";
import { quoteToken, watchlistQuoteRoute } from "../lib/watchlistQuotes";
import type { Watchlist } from "../types";

describe("Watchlist quote identity", () => {
  it("uses catalogue identity for a bare non-US symbol instead of the global selector", () => {
    const list = { quote_routes: { RELIANCE: { symbol: "RELIANCE", quote_symbol: "RELIANCE", market: "NSE", currency: "INR", status: "resolved" } } } as Watchlist;
    expect(quoteToken(watchlistQuoteRoute(list, "reliance"))).toBe("NSE:RELIANCE");
    expect(watchlistQuoteRoute(undefined, "MWRE.DE").currency).toBe("EUR");
    expect(quoteToken(watchlistQuoteRoute(undefined, "MIGA.MU"))).toBe("EU:MIGA.MU");
    expect(quoteToken(watchlistQuoteRoute(undefined, "BTC-EUR"))).toBe("CRYPTO:BTC-EUR");
    expect(quoteToken(watchlistQuoteRoute(undefined, "CRYPTO:MWRE.DE"))).toBe("EU:MWRE.DE");
  });
  it("does not fall back to a guessed stream when the server marks a listing ambiguous", () => {
    const list = { quote_routes: { TCS: { symbol: "TCS", quote_symbol: "TCS", market: null, currency: null, status: "ambiguous" } } } as Watchlist;
    expect(quoteToken(watchlistQuoteRoute(list, "TCS"))).toBeNull();
  });
});
