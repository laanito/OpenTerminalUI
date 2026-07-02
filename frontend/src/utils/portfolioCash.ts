import type { PortfolioTransactionType } from "../api/types";

// Frontend mirror of backend services/portfolio_cash.py. The ledger is the
// single source of truth for cash; these helpers only PREVIEW a pending row's
// effect (and drive form field visibility) — the backend recomputes on save.

export const TX_TYPES: PortfolioTransactionType[] = ["buy", "sell", "dividend", "deposit", "withdrawal"];

// A row needs a security symbol only for trades; dividend/deposit/withdrawal are
// cash-only. Shares matter only for trades.
export const TX_NEEDS_SYMBOL: Record<PortfolioTransactionType, boolean> = {
  buy: true,
  sell: true,
  dividend: true,
  deposit: false,
  withdrawal: false,
};

export const TX_NEEDS_SHARES: Record<PortfolioTransactionType, boolean> = {
  buy: true,
  sell: true,
  dividend: false,
  deposit: false,
  withdrawal: false,
};

// Signed cash impact of a transaction (positive = cash in). Mirrors
// backend cash_delta: a buy debits cash, sell/dividend/deposit credit it,
// a withdrawal debits it, and fees always cost cash.
export function cashDeltaPreview(
  type: PortfolioTransactionType,
  shares: number,
  price: number,
  fees: number,
): number {
  const s = Number(shares) || 0;
  const p = Number(price) || 0;
  const f = Number(fees) || 0;
  switch (type) {
    case "buy":
      return -(s * p + f);
    case "sell":
      return s * p - f;
    case "dividend":
      return p - f;
    case "deposit":
      return p - f;
    case "withdrawal":
      return -(p + f);
    default:
      return 0;
  }
}
