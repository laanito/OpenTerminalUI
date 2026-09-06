// "Region" contexts for the selector. IN/US are countries; EU and CRYPTO are
// asset/region contexts that drive search ranking (not real countries).
export type CountryCode = "IN" | "US" | "EU" | "CRYPTO";

export type MarketCode = "NSE" | "BSE" | "NYSE" | "NASDAQ" | "EU" | "CRYPTO";

export const DEFAULT_COUNTRY: CountryCode = "US";
export const DEFAULT_EQUITY_MARKET: MarketCode = "NASDAQ";
export const DEFAULT_EQUITY_REGION = "US" as const;
export const DEFAULT_EQUITY_UNIVERSE = "sp_500";
export const DEFAULT_SCAN_MARKETS = ["NYSE", "NASDAQ"] as const;

export const COUNTRY_MARKETS: Record<CountryCode, MarketCode[]> = {
  IN: ["NSE", "BSE"],
  US: ["NYSE", "NASDAQ"],
  EU: ["EU"],
  CRYPTO: ["CRYPTO"],
};

export const COUNTRY_DEFAULT_MARKET: Record<CountryCode, MarketCode> = {
  IN: "NSE",
  US: DEFAULT_EQUITY_MARKET,
  EU: "EU",
  CRYPTO: "CRYPTO",
};

export function equityRegionForMarket(market: MarketCode): "IN" | "US" {
  return market === "NSE" || market === "BSE" ? "IN" : DEFAULT_EQUITY_REGION;
}

export function equityUniverseForMarket(market: MarketCode): string {
  return equityRegionForMarket(market) === "IN" ? "nse_500" : DEFAULT_EQUITY_UNIVERSE;
}

export function benchmarkForMarket(market: MarketCode): "^NSEI" | "SPY" {
  return equityRegionForMarket(market) === "IN" ? "^NSEI" : "SPY";
}
