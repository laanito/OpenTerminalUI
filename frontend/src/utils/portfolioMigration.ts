import type { PortfolioItem } from "../types";

// Migration: legacy (global, single) portfolio -> a Manager (per-user) portfolio.
// The one field that differs between the two models is the cost basis: legacy
// calls it `avg_buy_price`, the Manager `cost_basis_per_share`. Everything else
// maps directly. Keeping this mapping in one tested place is why the legacy CSV
// export never imported cleanly before (the importer didn't know `avg_buy_price`).

export type ManagerHoldingPayload = {
  symbol: string;
  shares: number;
  cost_basis_per_share: number;
  purchase_date: string;
};

// Map one legacy holding to a Manager holding payload, or null if it can't be
// migrated (missing ticker or non-positive shares/cost — never fabricate).
export function legacyHoldingToPayload(item: Partial<PortfolioItem>): ManagerHoldingPayload | null {
  const symbol = String(item.ticker || "").trim().toUpperCase();
  const shares = Number(item.quantity ?? 0);
  const cost = Number(item.avg_buy_price ?? 0);
  if (!symbol || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(cost) || cost <= 0) {
    return null;
  }
  return {
    symbol,
    shares,
    cost_basis_per_share: cost,
    purchase_date: String(item.buy_date || "").trim() || new Date().toISOString().slice(0, 10),
  };
}

// Column aliases the Manager CSV importer accepts, so a legacy CSV export
// (which writes `avg_buy_price` / `buy_date`) imports without hand-editing.
export const CSV_SYMBOL_COLUMNS = ["symbol", "ticker"];
export const CSV_SHARES_COLUMNS = ["shares", "qty", "quantity"];
export const CSV_COST_COLUMNS = ["cost_basis_per_share", "avg_cost", "avg_buy_price", "buy_price", "price", "cost"];
export const CSV_DATE_COLUMNS = ["purchase_date", "date", "buy_date"];
