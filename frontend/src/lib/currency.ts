import { isCryptoSymbol, isIndianSymbol, normalizeTicker } from "../utils/ticker";

// Currencies we may encounter as an instrument's *native* currency. The backend
// cross-rates service (GET /api/forex/cross-rates) can only convert between the
// CONVERTIBLE set; the Nordic currencies (SEK/DKK/NOK) can still appear as a
// native currency, in which case amounts are shown unconverted in that currency
// rather than fabricating a wrong number.
export type CurrencyCode =
  | "USD"
  | "EUR"
  | "GBP"
  | "JPY"
  | "CHF"
  | "AUD"
  | "CAD"
  | "INR"
  | "SEK"
  | "DKK"
  | "NOK";

// Mirrors backend SUPPORTED_CURRENCIES in services/forex_service.py.
export const CONVERTIBLE_CURRENCIES: CurrencyCode[] = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "INR"];

type CompactTier = { threshold: number; divisor: number; suffix: string };

// Western magnitudes use K/M/B/T; Indian financials use Lakh/Crore.
const WESTERN_COMPACT: CompactTier[] = [
  { threshold: 1e12, divisor: 1e12, suffix: "T" },
  { threshold: 1e9, divisor: 1e9, suffix: "B" },
  { threshold: 1e6, divisor: 1e6, suffix: "M" },
  { threshold: 1e3, divisor: 1e3, suffix: "K" },
];

const INDIAN_COMPACT: CompactTier[] = [
  { threshold: 1e7, divisor: 1e7, suffix: "Cr" },
  { threshold: 1e5, divisor: 1e5, suffix: "L" },
];

type CurrencyMeta = { symbol: string; locale: string; compact: CompactTier[] };

const CURRENCY_META: Record<CurrencyCode, CurrencyMeta> = {
  USD: { symbol: "$", locale: "en-US", compact: WESTERN_COMPACT },
  EUR: { symbol: "€", locale: "en-IE", compact: WESTERN_COMPACT },
  GBP: { symbol: "£", locale: "en-GB", compact: WESTERN_COMPACT },
  JPY: { symbol: "¥", locale: "ja-JP", compact: WESTERN_COMPACT },
  CHF: { symbol: "CHF", locale: "de-CH", compact: WESTERN_COMPACT },
  AUD: { symbol: "A$", locale: "en-AU", compact: WESTERN_COMPACT },
  CAD: { symbol: "C$", locale: "en-CA", compact: WESTERN_COMPACT },
  INR: { symbol: "₹", locale: "en-IN", compact: INDIAN_COMPACT },
  SEK: { symbol: "kr", locale: "sv-SE", compact: WESTERN_COMPACT },
  DKK: { symbol: "kr", locale: "da-DK", compact: WESTERN_COMPACT },
  NOK: { symbol: "kr", locale: "nb-NO", compact: WESTERN_COMPACT },
};

export function currencyMeta(currency: CurrencyCode): CurrencyMeta {
  return CURRENCY_META[currency] ?? CURRENCY_META.USD;
}

export function currencySymbol(currency: CurrencyCode): string {
  return currencyMeta(currency).symbol;
}

// Yahoo/home-exchange suffix -> native currency. Mirrors backend
// instruments/sources.py `_EU_SUFFIX` so FE classification matches what the
// universe seeder stored.
const SUFFIX_CURRENCY: Record<string, CurrencyCode> = {
  DE: "EUR",
  F: "EUR",
  PA: "EUR",
  AS: "EUR",
  BR: "EUR",
  LS: "EUR",
  MI: "EUR",
  MC: "EUR",
  VI: "EUR",
  IR: "EUR",
  HE: "EUR",
  L: "GBP",
  SW: "CHF",
  ST: "SEK",
  CO: "DKK",
  OL: "NOK",
};

function marketNativeCurrency(market?: string | null): CurrencyCode {
  if (market === "NSE" || market === "BSE") return "INR";
  if (market === "EU") return "EUR";
  return "USD";
}

// Best-effort native currency for an instrument, from its symbol (and the active
// market as a hint for bare symbols). Crypto is quoted in USD; Indian symbols in
// INR; foreign Yahoo suffixes map by exchange; everything else defaults to the
// market's native currency (USD for US/unknown).
export function nativeCurrencyForSymbol(symbol?: string | null, market?: string | null): CurrencyCode {
  const t = normalizeTicker(symbol || "");
  if (!t) return marketNativeCurrency(market);
  if (isCryptoSymbol(t)) return "USD";
  if (isIndianSymbol(t, market)) return "INR";
  const dot = t.lastIndexOf(".");
  if (dot > 0) {
    const suffix = t.slice(dot + 1).toUpperCase();
    const mapped = SUFFIX_CURRENCY[suffix];
    if (mapped) return mapped;
  }
  return marketNativeCurrency(market);
}

// "USDEUR" -> rate (1 USD = rate EUR). Built from the cross-rates pair_quotes.
export type PairQuotes = Record<string, number>;

function usdLeg(currency: CurrencyCode, pairs: PairQuotes): number | null {
  if (currency === "USD") return 1;
  const direct = pairs[`${currency}USD`];
  if (direct && direct > 0) return direct;
  const inverse = pairs[`USD${currency}`];
  if (inverse && inverse > 0) return 1 / inverse;
  return null;
}

// Convert `value` from one currency to another. Returns NaN when no rate path
// exists (e.g. a Nordic currency the cross-rates service doesn't cover).
export function convertCurrency(value: number, from: CurrencyCode, to: CurrencyCode, pairs: PairQuotes): number {
  if (!Number.isFinite(value)) return Number.NaN;
  if (from === to) return value;
  const direct = pairs[`${from}${to}`];
  if (direct && direct > 0) return value * direct;
  const inverse = pairs[`${to}${from}`];
  if (inverse && inverse > 0) return value / inverse;
  // Triangulate through USD (covers the usdInr-only fallback table).
  const fromUsd = usdLeg(from, pairs);
  const toUsd = usdLeg(to, pairs);
  if (fromUsd && toUsd && toUsd > 0) return value * (fromUsd / toUsd);
  return Number.NaN;
}

// Resolve an amount for display: convert to `display` if a rate exists, else
// keep it in its native currency (honest fallback, no fabricated number).
export function resolveDisplayAmount(
  value: number,
  from: CurrencyCode,
  display: CurrencyCode,
  pairs: PairQuotes,
): { value: number; currency: CurrencyCode } {
  const converted = convertCurrency(value, from, display, pairs);
  if (Number.isFinite(converted)) return { value: converted, currency: display };
  return { value, currency: from };
}

export type MoneyFormatOptions = {
  compact?: boolean;
  signed?: boolean;
  maximumFractionDigits?: number;
};

// Format a value already expressed in `currency`. Uses Intl currency formatting
// for the full form (correct symbol/grouping for any ISO code) and a
// currency-aware compact form (Cr/L for INR, K/M/B/T otherwise).
export function formatMoneyIn(value: number, currency: CurrencyCode, options: MoneyFormatOptions = {}): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "-";
  const { compact = false, signed = false, maximumFractionDigits = 2 } = options;
  const sign = signed && value > 0 ? "+" : "";

  if (compact) {
    const meta = currencyMeta(currency);
    const abs = Math.abs(value);
    const tier = meta.compact.find((t) => abs >= t.threshold);
    if (tier) {
      const scaled = (value / tier.divisor).toLocaleString(meta.locale, { maximumFractionDigits });
      return `${sign}${meta.symbol} ${scaled} ${tier.suffix}`;
    }
    const plain = value.toLocaleString(meta.locale, { maximumFractionDigits });
    return `${sign}${meta.symbol} ${plain}`;
  }

  const formatted = new Intl.NumberFormat(currencyMeta(currency).locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(value);
  return `${sign}${formatted}`;
}
