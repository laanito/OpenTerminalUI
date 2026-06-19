// "Region" contexts for the selector. IN/US are countries; EU and CRYPTO are
// asset/region contexts that drive search ranking (not real countries).
export type CountryCode = "IN" | "US" | "EU" | "CRYPTO";

export type MarketCode = "NSE" | "BSE" | "NYSE" | "NASDAQ" | "EU" | "CRYPTO";

export const COUNTRY_MARKETS: Record<CountryCode, MarketCode[]> = {
  IN: ["NSE", "BSE"],
  US: ["NYSE", "NASDAQ"],
  EU: ["EU"],
  CRYPTO: ["CRYPTO"],
};
