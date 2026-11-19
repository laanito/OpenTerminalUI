export const PORTFOLIO_BENCHMARKS = ["S&P500", "NASDAQ", "DOW", "MSCIWI", "NIFTY50"];
export const PORTFOLIO_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "INR", "HKD", "SEK", "DKK", "NOK"];

export function portfolioMoney(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  if (!currency) return `${value.toLocaleString("en-US", { maximumFractionDigits: 8 })} (currency unknown)`;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${value.toLocaleString("en-US", { maximumFractionDigits: 8 })} ${currency}`; }
}

export function portfolioQuantity(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 12 });
}
