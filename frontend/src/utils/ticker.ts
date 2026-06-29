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

// Market indices use Yahoo's caret notation (^GSPC, ^NSEI, ^IXIC, ^N225, ...).
// An index has no fundamentals (P/E, market cap, financials, peers, shareholding)
// and no order book, so callers gate those equity-only panels off with this to
// avoid presenting blank fields as if the data were merely missing.
export function isIndexSymbol(ticker: string | null | undefined): boolean {
  return (ticker || "").trim().startsWith("^");
}

// India-only panels (delivery-series, shareholding/promoter holdings, corporate
// actions, NSE events/dividends) hit NSE-bound endpoints that 404/error for
// non-India symbols. Treat a symbol as Indian when it carries an explicit
// NSE/BSE suffix, or — for bare symbols — when the selected market is Indian.
// Never crypto. As the app de-India-izes (default market moves off NSE), bare
// US/EU symbols stop being treated as Indian without further changes here.
export function isIndianSymbol(
  ticker: string | null | undefined,
  market?: string | null,
): boolean {
  const t = normalizeTicker(ticker || "");
  if (!t) return false;
  if (isCryptoSymbol(t)) return false;
  if (isIndexSymbol(t)) return false;
  if (/\.(NS|BO)$/i.test(t)) return true;
  return market === "NSE" || market === "BSE";
}
