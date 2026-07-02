import { describe, expect, it } from "vitest";

import { CSV_COST_COLUMNS, legacyHoldingToPayload } from "../utils/portfolioMigration";

describe("legacyHoldingToPayload", () => {
  it("maps avg_buy_price -> cost_basis_per_share (the field that differed)", () => {
    expect(
      legacyHoldingToPayload({ ticker: "aapl", quantity: 10, avg_buy_price: 150, buy_date: "2025-01-02" }),
    ).toEqual({ symbol: "AAPL", shares: 10, cost_basis_per_share: 150, purchase_date: "2025-01-02" });
  });

  it("drops rows with no ticker or non-positive shares/cost (never fabricate)", () => {
    expect(legacyHoldingToPayload({ ticker: "", quantity: 10, avg_buy_price: 150 })).toBeNull();
    expect(legacyHoldingToPayload({ ticker: "MSFT", quantity: 0, avg_buy_price: 150 })).toBeNull();
    expect(legacyHoldingToPayload({ ticker: "MSFT", quantity: 10, avg_buy_price: 0 })).toBeNull();
  });

  it("falls back to today when buy_date is missing", () => {
    const payload = legacyHoldingToPayload({ ticker: "NVDA", quantity: 1, avg_buy_price: 500 });
    expect(payload?.purchase_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("CSV column aliases", () => {
  it("accepts the legacy export's avg_buy_price cost column", () => {
    // This is why a legacy CSV export previously failed to import.
    expect(CSV_COST_COLUMNS).toContain("avg_buy_price");
  });
});
