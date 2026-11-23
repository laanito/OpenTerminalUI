import { nativeCurrencyForSymbol } from "./currency";
import type { Watchlist } from "../types";

export type WatchlistQuoteRoute = { symbol: string; quote_symbol: string; market: string | null; currency: string | null; status: string };
export function watchlistQuoteRoute(list: Watchlist | undefined, input: string): WatchlistQuoteRoute {
  const symbol = input.trim().toUpperCase();
  const route = list?.quote_routes?.[symbol];
  if (route) return route;
  // Compatibility with older responses; the server supplies catalog identities.
  const [prefix, raw] = symbol.includes(":") ? symbol.split(":", 2) : ["", symbol];
  const quote = raw.split("-").pop() || "";
  const crypto = raw.includes("-") && ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "INR", "BRL", "TRY", "USDT", "USDC"].includes(quote);
  const india = /\.(NS|BO)$/.test(raw);
  const foreign = /\.(DE|MU|F|L|PA|AS|BR|LS|MI|MC|VI|IR|HE|SW|ST|CO|OL)$/.test(raw);
  const market = foreign ? "EU" : india ? raw.endsWith(".BO") ? "BSE" : "NSE" : crypto || prefix === "CRYPTO" ? "CRYPTO" : prefix || "NASDAQ";
  const quoteSymbol = india ? raw.slice(0, -3) : market === "CRYPTO" && prefix === "CRYPTO" && !crypto ? `${raw}-USD` : raw;
  return { symbol, quote_symbol: quoteSymbol, market, currency: nativeCurrencyForSymbol(quoteSymbol, market), status: ["EU", "NSE", "BSE", "NASDAQ", "NYSE", "CRYPTO"].includes(market) ? "resolved" : "unsupported" };
}
export function quoteToken(route: WatchlistQuoteRoute): string | null {
  return route.status === "resolved" && route.market ? `${route.market}:${route.quote_symbol}` : null;
}
