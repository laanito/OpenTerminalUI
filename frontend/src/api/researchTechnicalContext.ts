import { briefingValidation as v } from "./comparisonBriefing";
import { TECHNICAL_DEFINITIONS, TECHNICAL_REASONS, type ContextTechnicalAsset } from "./technicalContext";

export type ResearchTechnicalEvidence = Omit<ContextTechnicalAsset, "citation_id" | "sampling" | "supporting_points"> & {
  schema_version: 1; snapshot_id: string; input_contract: "yahoo-adjusted-instrument-window-v1"; interval: "1d";
  sampling: "own_utc_dates_within_instrument_window"; retrieved_at: string;
  history_semantics: "current_source_history_not_point_in_time";
  requested_start_date: string; requested_end_date: string; window_start_date: string | null; window_end_date: string | null;
  supporting_points: { date: string; provider_close: number; adjusted_close: number }[];
};

const id = (value: unknown, prefix: string) => typeof value === "string" && new RegExp(`^${prefix}_[a-f0-9]{24}$`).test(value);
const count = (value: unknown, max: number): value is number => v.finite(value) && Number.isInteger(value) && value >= 0 && value <= max;
const optionalDay = (value: unknown) => value === null || v.day(value);
const optionalText = (value: unknown) => value === null || (v.text(value) && value.length <= 128);
const sourceReasons = new Set([...Object.keys(TECHNICAL_REASONS), "provider_error", "provider_timeout", "no_observations_in_window"]);
const dayDifference = (first: string, last: string) => (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000;

/** Validate the supplied snapshot conventions/identities, not prose or source truth. */
export function validResearchTechnicalEvidence(raw: unknown, symbol: string): raw is ResearchTechnicalEvidence {
  if (!v.record(raw) || raw.schema_version !== 1 || !id(raw.snapshot_id, "ts") || raw.symbol !== symbol
    || raw.input_contract !== "yahoo-adjusted-instrument-window-v1" || raw.interval !== "1d"
    || raw.sampling !== "own_utc_dates_within_instrument_window" || raw.calculation_version !== "technical-indicators-v1"
    || raw.price_basis !== "yahoo_reported_adjclose" || raw.history_semantics !== "current_source_history_not_point_in_time"
    || raw.adjustment_verification !== "not_independently_verified" || raw.session_verification !== "not_performed" || raw.bar_completion !== "not_verified"
    || raw.annualized !== false || raw.value_decimal_places !== 8 || !v.timestamp(raw.retrieved_at)
    || !v.day(raw.requested_start_date) || !v.day(raw.requested_end_date)
    || raw.requested_end_date !== new Date(raw.retrieved_at as string).toISOString().slice(0, 10)
    || dayDifference(raw.requested_start_date as string, raw.requested_end_date as string) < 0
    || dayDifference(raw.requested_start_date as string, raw.requested_end_date as string) > 180
    || !optionalDay(raw.window_start_date) || !optionalDay(raw.window_end_date) || !optionalDay(raw.as_of_date)
    || !v.choice(raw.input_status, ["available", "unavailable"]) || !v.choice(raw.status, ["available", "partial", "unavailable"])
    || !count(raw.available_closes, 181) || !count(raw.shifted_local_dates, 181)
    || !optionalText(raw.source) || !optionalText(raw.feed) || !optionalText(raw.exchange_timezone)
    || !(raw.quote_unit === null || (typeof raw.quote_unit === "string" && /^[A-Za-z0-9]{2,12}$/.test(raw.quote_unit)))
    || !(raw.instrument_type === null || v.choice(raw.instrument_type, ["EQUITY", "ETF", "INDEX", "CRYPTOCURRENCY"]))
    || !(raw.input_id === null || id(raw.input_id, "ti")) || !(raw.freshness === null || v.choice(raw.freshness, ["current", "stale"]))
    || !(raw.input_reason === null || (typeof raw.input_reason === "string" && sourceReasons.has(raw.input_reason)))
    || !Array.isArray(raw.metrics) || raw.metrics.length !== 3 || !Array.isArray(raw.supporting_points) || raw.supporting_points.length > 21) return false;
  const start = raw.window_start_date, end = raw.window_end_date;
  if ((start === null) !== (end === null)) return false;
  if (typeof start === "string" && typeof end === "string"
    && (start > end || start < String(raw.requested_start_date) || end > String(raw.requested_end_date))) return false;
  if (raw.input_status === "unavailable" && (raw.available_closes !== 0 || raw.input_reason === null || raw.input_id !== null || raw.as_of_date !== null || raw.freshness !== null)) return false;
  if (raw.available_closes > 0 && (raw.input_status !== "available" || raw.input_reason !== null || !id(raw.input_id, "ti")
    || !start || !end || raw.as_of_date !== end || !raw.freshness || raw.feed !== "yahoo_chart" || !raw.quote_unit || !raw.instrument_type || !raw.exchange_timezone
    || raw.freshness !== (dayDifference(end as string, raw.requested_end_date as string) > 7 ? "stale" : "current"))) return false;
  if (raw.available_closes > 0 && (raw.available_closes > dayDifference(String(start), String(end)) + 1
    || raw.shifted_local_dates > raw.available_closes
    || (raw.instrument_type === "CRYPTOCURRENCY" && raw.available_closes !== dayDifference(String(start), String(end)) + 1))) return false;
  const supporting = new Map<string, number>(); let previous = "";
  for (const point of raw.supporting_points) {
    if (!v.record(point) || !v.day(point.date) || point.date <= previous || !start || !end || point.date < String(start) || point.date > String(end)
      || !v.finite(point.provider_close) || point.provider_close <= 0 || !v.finite(point.adjusted_close) || point.adjusted_close <= 0
      || (raw.instrument_type === "CRYPTOCURRENCY" && previous && dayDifference(previous, point.date) !== 1)) return false;
    supporting.set(point.date, point.adjusted_close); previous = point.date;
  }
  let usable = 0; const used = new Set<string>(), observationIds = new Set<string>();
  for (const [index, metric] of raw.metrics.entries()) {
    const spec = TECHNICAL_DEFINITIONS[index];
    if (!v.record(metric) || metric.citation_id !== `TECH${index + 1}` || metric.name !== spec.name || metric.unit !== spec.unit || metric.formula !== spec.formula
      || metric.required_closes !== spec.required || metric.lookback !== 20 || !Array.isArray(metric.observation_dates)) return false;
    if (metric.status === "available") {
      const expected = [...supporting.keys()].slice(-spec.required);
      if (raw.input_status !== "available" || raw.available_closes < spec.required || !v.finite(metric.value)
        || (metric.name === "volatility20_pp" && metric.value < 0) || metric.reason !== null || metric.used_closes !== spec.required
        || expected.length !== spec.required || metric.observation_dates.length !== spec.required || !id(metric.observation_id, "to")
        || observationIds.has(String(metric.observation_id)) || metric.start_date !== expected[0] || metric.end_date !== expected[expected.length - 1]
        || metric.end_date !== raw.as_of_date || metric.observation_dates.some((day, i) => day !== expected[i])) return false;
      for (const day of expected) used.add(day);
      observationIds.add(String(metric.observation_id)); usable++;
    } else if (metric.status !== "unavailable" || metric.value !== null || metric.observation_id !== null || metric.used_closes !== 0
      || metric.observation_dates.length || metric.start_date !== null || metric.end_date !== null
      || !v.choice(metric.reason, ["input_unavailable", "inconsistent_input", "insufficient_history", "non_finite_calculation"])
      || (raw.input_status === "unavailable" ? metric.reason !== "input_unavailable" : metric.reason === "input_unavailable")
      || (metric.reason === "insufficient_history" && raw.available_closes >= spec.required)) return false;
  }
  return raw.status === (usable === 3 ? "available" : usable ? "partial" : "unavailable")
    && supporting.size === used.size && [...supporting.keys()].every((day) => used.has(day));
}

export function validResearchTechnicalReferences(summary: string, sections: { title: string; points: string[] }[], evidence: ResearchTechnicalEvidence): boolean {
  const available = new Set(evidence.metrics.filter((metric) => metric.status === "available").map((metric) => `[${metric.citation_id}]`));
  const body = [summary, ...sections.flatMap((section) => section.points)].join("\n");
  const all = [body, ...sections.map((section) => section.title)].join("\n");
  return [...all.matchAll(/\[TECH[^\]\n]*\]/g)].every((match) => available.has(match[0]))
    && (!available.size || [...body.matchAll(/\[TECH[^\]\n]*\]/g)].some((match) => available.has(match[0])));
}
