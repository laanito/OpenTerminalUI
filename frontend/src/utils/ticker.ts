const TICKER_ALIASES: Record<string, string> = {
  APPL: "AAPL",
};

export function normalizeTicker(input: string): string {
  const symbol = (input || "").trim().toUpperCase();
  if (!symbol) return symbol;
  return TICKER_ALIASES[symbol] || symbol;
}

// Crypto symbols are quoted against USD (e.g. BTC-USD, RENDER-USD). The chart
// + quote hooks route these to the /v1/crypto endpoints; equity/India-only
// endpoints (delivery-series, financials, shareholding, ...) don't apply and
// 404/422 for them, so callers gate those off with this.
export function isCryptoSymbol(ticker: string | null | undefined): boolean {
  return /-USD$/i.test(normalizeTicker(ticker || ""));
}
