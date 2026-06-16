import { describe, expect, it } from "vitest";

import { isCryptoSymbol, normalizeTicker } from "../utils/ticker";

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
