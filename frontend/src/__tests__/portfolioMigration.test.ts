import { describe, expect, it } from "vitest";

import { CSV_COST_COLUMNS } from "../utils/portfolioMigration";

describe("CSV column aliases", () => {
  it("accepts an avg_buy_price cost column (older export compatibility)", () => {
    expect(CSV_COST_COLUMNS).toContain("avg_buy_price");
  });
});
