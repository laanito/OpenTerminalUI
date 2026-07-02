import { describe, expect, it } from "vitest";

import { TX_NEEDS_SHARES, TX_NEEDS_SYMBOL, cashDeltaPreview } from "../utils/portfolioCash";

// This must stay in lockstep with backend services/portfolio_cash.cash_delta.
describe("cashDeltaPreview", () => {
  it("debits cash on a buy (notional + fees)", () => {
    expect(cashDeltaPreview("buy", 10, 100, 5)).toBe(-1005);
  });

  it("credits proceeds net of fees on a sell", () => {
    expect(cashDeltaPreview("sell", 10, 100, 5)).toBe(995);
  });

  it("credits dividends and deposits (amount in price)", () => {
    expect(cashDeltaPreview("dividend", 0, 42, 0)).toBe(42);
    expect(cashDeltaPreview("deposit", 0, 1000, 0)).toBe(1000);
  });

  it("debits withdrawals plus fees", () => {
    expect(cashDeltaPreview("withdrawal", 0, 250, 1)).toBe(-251);
  });

  it("treats empty/NaN inputs as zero", () => {
    expect(cashDeltaPreview("deposit", NaN, NaN, NaN)).toBe(0);
  });
});

describe("transaction field requirements", () => {
  it("requires a symbol only for security transactions", () => {
    expect(TX_NEEDS_SYMBOL.buy).toBe(true);
    expect(TX_NEEDS_SYMBOL.sell).toBe(true);
    expect(TX_NEEDS_SYMBOL.dividend).toBe(true);
    expect(TX_NEEDS_SYMBOL.deposit).toBe(false);
    expect(TX_NEEDS_SYMBOL.withdrawal).toBe(false);
  });

  it("requires shares only for trades", () => {
    expect(TX_NEEDS_SHARES.buy).toBe(true);
    expect(TX_NEEDS_SHARES.sell).toBe(true);
    expect(TX_NEEDS_SHARES.dividend).toBe(false);
    expect(TX_NEEDS_SHARES.deposit).toBe(false);
    expect(TX_NEEDS_SHARES.withdrawal).toBe(false);
  });
});
