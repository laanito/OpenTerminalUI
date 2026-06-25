import { api } from "./base";
import type { PairQuotes } from "../lib/currency";

type ForexQuote = {
  pair: string;
  symbol: string;
  base_currency: string;
  quote_currency: string;
  rate: number;
};

export type CrossRatesResponse = {
  as_of: string;
  base_currency: string;
  currencies: string[];
  matrix: number[][];
  pair_quotes: Record<string, ForexQuote>;
};

export async function fetchCrossRates(): Promise<CrossRatesResponse> {
  const res = await api.get<CrossRatesResponse>("/forex/cross-rates");
  return res.data;
}

// Flatten the cross-rates pair_quotes into a "USDEUR" -> rate lookup used by the
// currency converter.
export function toPairQuotes(payload: CrossRatesResponse | undefined): PairQuotes {
  const pairs: PairQuotes = {};
  if (!payload?.pair_quotes) return pairs;
  for (const quote of Object.values(payload.pair_quotes)) {
    if (quote && typeof quote.rate === "number" && quote.rate > 0) {
      pairs[`${quote.base_currency}${quote.quote_currency}`] = quote.rate;
    }
  }
  return pairs;
}
