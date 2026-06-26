import { describe, expect, it } from "vitest";

import {
  type PairQuotes,
  convertCurrency,
  formatMoneyIn,
  nativeCurrencyForSymbol,
  resolveDisplayAmount,
} from "../lib/currency";

// 1 USD = 0.9 EUR, 1 USD = 80 INR, 1 USD = 0.8 GBP
const PAIRS: PairQuotes = {
  USDEUR: 0.9,
  EURUSD: 1 / 0.9,
  USDINR: 80,
  INRUSD: 1 / 80,
  USDGBP: 0.8,
  GBPUSD: 1 / 0.8,
  EURINR: 80 / 0.9,
  INREUR: 0.9 / 80,
};

describe("nativeCurrencyForSymbol", () => {
  it("reads the crypto pair's quote currency", () => {
    expect(nativeCurrencyForSymbol("BTC-USD")).toBe("USD");
    expect(nativeCurrencyForSymbol("BTC-EUR")).toBe("EUR");
    expect(nativeCurrencyForSymbol("ETH-GBP")).toBe("GBP");
  });
  it("ignores non-currency dashed suffixes (class shares)", () => {
    // BRK-B is not a EUR/USD pair — must not be read as a currency leg.
    expect(nativeCurrencyForSymbol("BRK-B", "NASDAQ")).toBe("USD");
  });
  it("maps Indian symbols to INR", () => {
    expect(nativeCurrencyForSymbol("RELIANCE.NS")).toBe("INR");
    expect(nativeCurrencyForSymbol("TCS", "NSE")).toBe("INR");
  });
  it("maps European Yahoo suffixes by exchange", () => {
    expect(nativeCurrencyForSymbol("ADS.DE")).toBe("EUR");
    expect(nativeCurrencyForSymbol("III.L")).toBe("GBP");
    expect(nativeCurrencyForSymbol("NESN.SW")).toBe("CHF");
    expect(nativeCurrencyForSymbol("ERIC.ST")).toBe("SEK");
  });
  it("defaults bare/US symbols to the market currency", () => {
    expect(nativeCurrencyForSymbol("AAPL")).toBe("USD");
    expect(nativeCurrencyForSymbol("AAPL", "NASDAQ")).toBe("USD");
    expect(nativeCurrencyForSymbol("FOO", "EU")).toBe("EUR");
  });
});

describe("convertCurrency", () => {
  it("returns the value unchanged for same currency", () => {
    expect(convertCurrency(100, "USD", "USD", PAIRS)).toBe(100);
  });
  it("converts via a direct pair", () => {
    expect(convertCurrency(100, "USD", "EUR", PAIRS)).toBeCloseTo(90);
  });
  it("converts via the inverse pair", () => {
    expect(convertCurrency(90, "EUR", "USD", PAIRS)).toBeCloseTo(100);
  });
  it("triangulates through USD when no direct pair exists", () => {
    // GBP -> INR has no direct pair: 1 GBP = 1.25 USD = 100 INR
    expect(convertCurrency(1, "GBP", "INR", PAIRS)).toBeCloseTo(100);
  });
  it("returns NaN when no rate path exists", () => {
    expect(Number.isNaN(convertCurrency(1, "SEK", "EUR", PAIRS))).toBe(true);
  });
});

describe("resolveDisplayAmount", () => {
  it("converts when a rate exists", () => {
    expect(resolveDisplayAmount(100, "USD", "EUR", PAIRS)).toEqual({ value: 90, currency: "EUR" });
  });
  it("falls back to the native currency when unconvertible", () => {
    const out = resolveDisplayAmount(100, "SEK", "EUR", PAIRS);
    expect(out.currency).toBe("SEK");
    expect(out.value).toBe(100);
  });
});

describe("formatMoneyIn", () => {
  it("uses the correct symbol per currency (no rupee leak)", () => {
    expect(formatMoneyIn(1000, "USD")).toContain("$");
    expect(formatMoneyIn(1000, "EUR")).toContain("€");
    expect(formatMoneyIn(1000, "INR")).toContain("₹");
  });
  it("uses Crore/Lakh compaction for INR and K/M/B otherwise", () => {
    expect(formatMoneyIn(2e7, "INR", { compact: true })).toContain("Cr");
    expect(formatMoneyIn(2e6, "USD", { compact: true })).toContain("M");
    expect(formatMoneyIn(2e6, "EUR", { compact: true })).toContain("M");
  });
  it("renders a dash for non-finite values", () => {
    expect(formatMoneyIn(Number.NaN, "USD")).toBe("-");
  });
  it("prefixes a sign when requested", () => {
    expect(formatMoneyIn(100, "USD", { signed: true }).startsWith("+")).toBe(true);
  });
});
