import { describe, expect, it } from "vitest";

import { CSV_COST_COLUMNS, CSV_CURRENCY_COLUMNS } from "../utils/portfolioMigration";

describe("CSV column aliases", () => {
  it("accepts an avg_buy_price cost column (older export compatibility)", () => {
    expect(CSV_COST_COLUMNS).toContain("avg_buy_price");
  });

  it("recognizes explicit cost-basis currency columns", () => {
    expect(CSV_CURRENCY_COLUMNS).toContain("cost_basis_currency");
    expect(CSV_CURRENCY_COLUMNS).toContain("currency");
  });
});
