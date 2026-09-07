import { useMemo } from "react";

import { useSettingsStore } from "../store/settingsStore";
import { toPairQuotes } from "../api/forex";
import {
  type CurrencyCode,
  type MoneyFormatOptions,
  type PairQuotes,
  currencyMeta,
  financialUnitForCurrency,
  formatMoneyIn,
  nativeCurrencyForInstrument,
  nativeCurrencyForSymbol,
  resolveDisplayAmount,
  resolveFinancialDisplayAmount,
} from "../lib/currency";
import { useCrossRates } from "./useCrossRates";
import { useMarketStatus } from "./useStocks";

type MarketStatusPayload = {
  usdInr?: number | null;
  inrUsd?: number | null;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function useDisplayCurrency() {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency) as CurrencyCode;
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const { data: crossRates } = useCrossRates();
  const { data: statusData } = useMarketStatus();

  // Primary rate source is the cross-rates matrix; fall back to the single
  // USD/INR pair carried on market-status so India keeps converting if the
  // forex endpoint is unavailable.
  const pairs: PairQuotes = useMemo(() => {
    const fromCross = toPairQuotes(crossRates);
    if (Object.keys(fromCross).length > 0) return fromCross;
    const payload = (statusData ?? {}) as MarketStatusPayload;
    const direct = toNumber(payload.usdInr);
    const inverse = toNumber(payload.inrUsd);
    const usdInr = direct && direct > 0 ? direct : inverse && inverse > 0 ? 1 / inverse : null;
    if (usdInr) return { USDINR: usdInr, INRUSD: 1 / usdInr };
    return {};
  }, [crossRates, statusData]);

  const marketNative: CurrencyCode = useMemo(() => nativeCurrencyForSymbol(null, selectedMarket), [selectedMarket]);

  // Convert a value (in `fromCurrency`, defaulting to the active market's native
  // currency) into the display currency. Returns the resolved value plus the
  // currency it is actually expressed in (the native one when no rate exists).
  type Amount = number | null | undefined;

  const resolve = (value: number, fromCurrency?: CurrencyCode) =>
    resolveDisplayAmount(value, fromCurrency ?? marketNative, displayCurrency, pairs);

  const convertAmount = (value: Amount, fromCurrency?: CurrencyCode): number => {
    if (value === null || value === undefined || !Number.isFinite(value)) return Number.NaN;
    return resolve(value, fromCurrency).value;
  };

  const formatMoney = (value: Amount, fromCurrency?: CurrencyCode, options?: MoneyFormatOptions): string => {
    if (value === null || value === undefined || !Number.isFinite(value)) return "-";
    const { value: converted, currency } = resolve(value, fromCurrency);
    return formatMoneyIn(converted, currency, options);
  };

  const formatSignedMoney = (value: Amount, fromCurrency?: CurrencyCode, options?: MoneyFormatOptions): string =>
    formatMoney(value, fromCurrency, { ...options, signed: true });

  const formatCompactMoney = (value: Amount, fromCurrency?: CurrencyCode, options?: MoneyFormatOptions): string =>
    formatMoney(value, fromCurrency, { ...options, compact: true });

  // Back-compat alias kept for existing callers.
  const formatDisplayMoney = (value: Amount, fromCurrency?: CurrencyCode): string => formatMoney(value, fromCurrency);

  const resolvedFinancialCurrency = (fromCurrency?: CurrencyCode): CurrencyCode =>
    resolveDisplayAmount(1, fromCurrency ?? marketNative, displayCurrency, pairs).currency;

  const financialUnitFor = (fromCurrency?: CurrencyCode): "Cr" | "M" =>
    financialUnitForCurrency(resolvedFinancialCurrency(fromCurrency));

  const financialUnit = financialUnitFor();

  const scaleFinancialAmount = (value: Amount, fromCurrency?: CurrencyCode): number => {
    if (value === null || value === undefined || !Number.isFinite(value)) return Number.NaN;
    return resolveFinancialDisplayAmount(value, fromCurrency ?? marketNative, displayCurrency, pairs).value;
  };

  // Fixed-unit compact form (display currency symbol + the `financialUnit`
  // header callers render beside it). Distinct from formatCompactMoney, which
  // picks the magnitude tier (K/M/B) per value.
  const formatFinancialCompact = (value: number, fromCurrency?: CurrencyCode): string => {
    if (!Number.isFinite(value)) return "-";
    const resolved = resolveFinancialDisplayAmount(value, fromCurrency ?? marketNative, displayCurrency, pairs);
    const meta = currencyMeta(resolved.currency);
    return `${meta.symbol} ${resolved.value.toLocaleString(meta.locale, { maximumFractionDigits: 2 })} ${resolved.unit}`;
  };

  return {
    displayCurrency,
    marketNative,
    nativeFor: nativeCurrencyForSymbol,
    nativeForInstrument: nativeCurrencyForInstrument,
    convertAmount,
    formatMoney,
    formatSignedMoney,
    formatCompactMoney,
    formatDisplayMoney,
    financialUnit,
    financialUnitFor,
    scaleFinancialAmount,
    formatFinancialCompact,
  };
}
