import { describe, expect, it } from "vitest";

import { isCryptoSymbol, isIndexSymbol, isIndianSymbol, normalizeTicker } from "../utils/ticker";

describe("isCryptoSymbol", () => {
  it("treats -USD quoted symbols as crypto", () => {
    expect(isCryptoSymbol("BTC-USD")).toBe(true);
    expect(isCryptoSymbol("RENDER-USD")).toBe(true);
    expect(isCryptoSymbol("btc-usd")).toBe(true);
  });

  it("does not treat equities/indices as crypto", () => {
    expect(isCryptoSymbol("RELIANCE")).toBe(false);
    expect(isCryptoSymbol("AAPL")).toBe(false);
    expect(isCryptoSymbol("RELIANCE.NS")).toBe(false);
    expect(isCryptoSymbol("^NSEI")).toBe(false);
    expect(isCryptoSymbol("USDINR=X")).toBe(false);
  });

  it("handles empty / nullish input", () => {
    expect(isCryptoSymbol("")).toBe(false);
    expect(isCryptoSymbol(null)).toBe(false);
    expect(isCryptoSymbol(undefined)).toBe(false);
  });

  it("normalizeTicker leaves crypto symbols intact", () => {
    expect(normalizeTicker("btc-usd")).toBe("BTC-USD");
  });
});

describe("isIndianSymbol", () => {
  it("treats explicit NSE/BSE suffixes as Indian regardless of market", () => {
    expect(isIndianSymbol("RELIANCE.NS", "NASDAQ")).toBe(true);
    expect(isIndianSymbol("TCS.BO", "NASDAQ")).toBe(true);
    expect(isIndianSymbol("reliance.ns", undefined)).toBe(true);
  });

  it("treats bare symbols as Indian only under an Indian market", () => {
    expect(isIndianSymbol("RELIANCE", "NSE")).toBe(true);
    expect(isIndianSymbol("RELIANCE", "BSE")).toBe(true);
    expect(isIndianSymbol("AAPL", "NASDAQ")).toBe(false);
    expect(isIndianSymbol("AAPL", "NYSE")).toBe(false);
    // No market context -> not assumed Indian (de-India default).
    expect(isIndianSymbol("AAPL", undefined)).toBe(false);
  });

  it("never treats crypto as Indian", () => {
    expect(isIndianSymbol("BTC-USD", "NSE")).toBe(false);
  });

  it("handles empty / nullish input", () => {
    expect(isIndianSymbol("", "NSE")).toBe(false);
    expect(isIndianSymbol(null, "NSE")).toBe(false);
    expect(isIndianSymbol(undefined, undefined)).toBe(false);
  });

  it("never treats an index as Indian, even under an Indian market", () => {
    // ^NSEI is the Nifty 50 index, not an NSE-listed equity; it must not route
    // to NSE-bound equity panels (shareholding/promoter/delivery).
    expect(isIndianSymbol("^NSEI", "NSE")).toBe(false);
  });
});

describe("isIndexSymbol", () => {
  it("detects Yahoo caret-notation indices", () => {
    for (const sym of ["^GSPC", "^NSEI", "^IXIC", "^DJI", "^N225", "^FTSE", "^GDAXI"]) {
      expect(isIndexSymbol(sym)).toBe(true);
    }
  });

  it("tolerates surrounding whitespace", () => {
    expect(isIndexSymbol("  ^GSPC ")).toBe(true);
  });

  it("does not flag equities, crypto or nullish input", () => {
    for (const sym of ["AAPL", "RELIANCE.NS", "SAP.DE", "BTC-USD", "", null, undefined]) {
      expect(isIndexSymbol(sym)).toBe(false);
    }
  });
});
