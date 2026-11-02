import { briefingValidation as v, type BriefingPair } from "./comparisonBriefing";
import type { ContextSectionBase } from "./comparisonContextBriefing";

export const TECHNICAL_CAVEATS = {
  technical_is_observed_adjusted_input_not_a_trading_signal: "Technical values describe observed adjusted closes; they are not trading signals.",
  technical_adjustments_sessions_and_bar_completion_are_unverified: "Adjustment methods, exchange sessions and bar completion have not been independently verified.",
  technical_lookbacks_are_own_observations_not_identical_calendar_spans: "Each asset uses its own observations; matching lookbacks can span different calendar periods.",
};
export const TECHNICAL_DEFINITIONS = [
  { name: "sma20_gap_pct", label: "20-close moving-average gap", required: 20, unit: "percent", formula: "100 * (last_adjusted_close / mean(last_20_adjusted_closes) - 1)" },
  { name: "return20_pct", label: "20-period return", required: 21, unit: "percent", formula: "100 * (last_adjusted_close / adjusted_close_20_observations_earlier - 1)" },
  { name: "volatility20_pp", label: "20-return volatility", required: 21, unit: "percentage_points", formula: "100 * sample_stddev(last_20_simple_close_to_close_returns, ddof=1)" },
] as const;
export const TECHNICAL_REASONS: Record<string, string> = {
  input_unavailable: "Technical input unavailable", inconsistent_input: "Input metadata could not be reconciled",
  insufficient_history: "Insufficient history", non_finite_calculation: "Calculation could not produce a finite value",
  pair_unavailable: "No shared price window", unsupported_or_unknown_feed: "Selected history feed is not supported for technical observations",
  invalid_source_shape: "Source data could not be validated", incomplete_source_arrays: "Incomplete source data",
  source_symbol_mismatch: "Source symbol does not match", daily_interval_unconfirmed: "Daily interval could not be confirmed",
  unsupported_instrument_type: "Instrument type is not supported", quote_unit_unavailable: "Quote unit unavailable",
  timezone_unavailable: "Source timezone unavailable", invalid_timestamp: "Invalid source timestamp",
  duplicate_utc_date: "Duplicate source dates", invalid_or_missing_close: "Invalid or missing adjusted close",
  selected_rows_differ_from_source: "Selected history does not match the source", incomplete_window: "Incomplete window",
  missing_crypto_dates: "Missing crypto calendar dates", future_observation: "Source contains a future observation",
};
export interface ContextTechnicalMetric {
  citation_id: string; name: typeof TECHNICAL_DEFINITIONS[number]["name"]; status: "available" | "unavailable";
  reason: "input_unavailable" | "inconsistent_input" | "insufficient_history" | "non_finite_calculation" | null;
  value: number | null; unit: "percent" | "percentage_points"; formula: string; lookback: 20;
  required_closes: 20 | 21; used_closes: number; observation_dates: string[];
  start_date: string | null; end_date: string | null; observation_id: string | null;
}
export interface ContextTechnicalAsset {
  citation_id: string; calculation_version: "technical-indicators-v1"; symbol: string;
  status: "available" | "partial" | "unavailable"; input_status: "available" | "unavailable";
  input_reason: string | null; input_id: string | null; source: string | null; feed: string | null; quote_unit: string | null;
  price_basis: "yahoo_reported_adjclose"; sampling: "own_utc_dates_within_pair_window";
  adjustment_verification: "not_independently_verified"; session_verification: "not_performed"; bar_completion: "not_verified";
  annualized: false; value_decimal_places: 8; available_closes: number; as_of_date: string | null;
  freshness: "current" | "stale" | null; instrument_type: string | null; exchange_timezone: string | null;
  shifted_local_dates: number; metrics: ContextTechnicalMetric[]; supporting_points: { date: string; adjusted_close: number }[];
}
export interface ContextTechnicalSection extends ContextSectionBase {
  kind: "technical"; assets: ContextTechnicalAsset[];
}
const count = (value: unknown, max: number): value is number => v.finite(value) && Number.isInteger(value) && value >= 0 && value <= max;
const id = (value: unknown, prefix: string) => typeof value === "string" && new RegExp(`^${prefix}_[0-9a-f]{24}$`).test(value);
const nullableText = (value: unknown, max: number) => value === null || (v.text(value) && value.length <= max);
const nullableDay = (value: unknown) => value === null || v.day(value);

/** Validate identities/windows/conventions, not the truth of source adjustments or model prose. */
export function validTechnicalSection(raw: Record<string, unknown>, pair: BriefingPair, sectionId: string, retrievedAt: string): boolean {
  if (raw.kind !== "technical" || !Array.isArray(raw.assets) || ![0, 2].includes(raw.assets.length)) return false;
  if (raw.retrieved_at !== null && raw.retrieved_at !== retrievedAt) return false;
  if (!raw.assets.length) return raw.status === "no_price_window"
    ? raw.reason === "no_price_window" && raw.retrieved_at === null
    : raw.status === "unavailable" && ["not_prepared", "invalid_response"].includes(String(raw.reason));
  if (!pair.returns || raw.retrieved_at !== retrievedAt || !v.timestamp(raw.retrieved_at) || !["available", "partial", "unavailable"].includes(String(raw.status))) return false;
  const window = pair.returns;
  let total = 0, complete = 0;
  for (const [index, asset] of raw.assets.entries()) {
    const group = `${sectionId}A${index + 1}`;
    const price = index === 0 ? pair.anchor : pair.comparison;
    if (!v.record(asset) || asset.citation_id !== group || asset.symbol !== price.symbol
      || asset.calculation_version !== "technical-indicators-v1" || asset.price_basis !== "yahoo_reported_adjclose"
      || asset.sampling !== "own_utc_dates_within_pair_window" || asset.adjustment_verification !== "not_independently_verified"
      || asset.session_verification !== "not_performed" || asset.bar_completion !== "not_verified"
      || asset.annualized !== false || asset.value_decimal_places !== 8
      || asset.source !== price.history_adapter || asset.feed !== price.history_feed
      || !nullableText(asset.source, 128) || !nullableText(asset.feed, 128)
      || !(asset.quote_unit === null || (typeof asset.quote_unit === "string" && /^[A-Za-z0-9]{2,12}$/.test(asset.quote_unit) && asset.quote_unit === price.quote_unit))
      || !v.choice(asset.status, ["available", "partial", "unavailable"]) || !v.choice(asset.input_status, ["available", "unavailable"])
      || !(asset.input_id === null || id(asset.input_id, "ti")) || !nullableDay(asset.as_of_date)
      || !(asset.freshness === null || v.choice(asset.freshness, ["current", "stale"]))
      || !(asset.instrument_type === null || v.choice(asset.instrument_type, ["EQUITY", "ETF", "INDEX", "CRYPTOCURRENCY"]))
      || !nullableText(asset.exchange_timezone, 128) || !count(asset.shifted_local_dates, 181) || !count(asset.available_closes, 181)
      || !Array.isArray(asset.metrics) || asset.metrics.length !== 3 || !Array.isArray(asset.supporting_points) || asset.supporting_points.length > 21) return false;
    if (asset.input_status === "available" ? asset.input_reason !== null : typeof asset.input_reason !== "string" || !Object.keys(TECHNICAL_REASONS).includes(asset.input_reason)) return false;
    if (asset.input_status === "unavailable" && ["input_unavailable", "inconsistent_input", "insufficient_history", "non_finite_calculation"].includes(String(asset.input_reason))) return false;
    if (asset.available_closes > 0 && (asset.input_status !== "available" || !id(asset.input_id, "ti") || asset.as_of_date !== window.end_date || !asset.freshness)) return false;
    const supporting = new Map<string, number>();
    let previous = "";
    for (const point of asset.supporting_points) {
      if (!v.record(point) || !v.day(point.date) || point.date <= previous || point.date < window.start_date || point.date > window.end_date
        || !v.finite(point.adjusted_close) || point.adjusted_close <= 0) return false;
      if (asset.instrument_type === "CRYPTOCURRENCY" && previous
        && Date.parse(`${point.date}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`) !== 86_400_000) return false;
      supporting.set(point.date, point.adjusted_close); previous = point.date;
    }
    const used = new Set<string>(), ids = new Set<string>();
    let available = 0;
    for (const [number, metric] of asset.metrics.entries()) {
      const spec = TECHNICAL_DEFINITIONS[number];
      if (!v.record(metric) || metric.citation_id !== `${group}T${number + 1}` || metric.name !== spec.name
        || metric.unit !== spec.unit || metric.formula !== spec.formula || metric.lookback !== 20 || metric.required_closes !== spec.required
        || !v.choice(metric.status, ["available", "unavailable"]) || !count(metric.used_closes, 21)
        || !Array.isArray(metric.observation_dates) || !nullableDay(metric.start_date) || !nullableDay(metric.end_date)) return false;
      if (metric.status === "available") {
        if (asset.input_status !== "available" || asset.feed !== "yahoo_chart" || !asset.quote_unit || !asset.exchange_timezone || !asset.instrument_type
          || !id(asset.input_id, "ti") || asset.available_closes < spec.required || asset.as_of_date !== window.end_date
          || !v.finite(metric.value) || metric.reason !== null || metric.used_closes !== spec.required
          || metric.observation_dates.length !== spec.required || !id(metric.observation_id, "to") || ids.has(String(metric.observation_id))) return false;
        const expected = [...supporting.keys()].slice(-spec.required);
        if (metric.name === "volatility20_pp" && metric.value < 0) return false;
        if (metric.observation_dates.some((day, i) => !v.day(day) || day !== expected[i])
          || metric.start_date !== expected[0] || metric.end_date !== expected[expected.length - 1] || metric.end_date !== asset.as_of_date) return false;
        for (const day of metric.observation_dates) used.add(day as string);
        ids.add(String(metric.observation_id)); available++;
      } else {
        if (metric.value !== null || metric.observation_id !== null || metric.used_closes !== 0 || metric.observation_dates.length
          || metric.start_date !== null || metric.end_date !== null
          || !v.choice(metric.reason, ["input_unavailable", "inconsistent_input", "insufficient_history", "non_finite_calculation"])) return false;
        if (asset.input_status === "unavailable" ? metric.reason !== "input_unavailable" : metric.reason === "input_unavailable") return false;
        if (metric.reason === "insufficient_history" && asset.available_closes >= spec.required) return false;
      }
    }
    if (supporting.size !== used.size || [...supporting.keys()].some((day) => !used.has(day))) return false;
    if (asset.status !== (available === 3 ? "available" : available ? "partial" : "unavailable")) return false;
    total += available; if (available === 3) complete++;
  }
  return raw.status === (complete === 2 ? "available" : total ? "partial" : "unavailable")
    && raw.reason === (total ? null : "technical_inputs_unavailable");
}
