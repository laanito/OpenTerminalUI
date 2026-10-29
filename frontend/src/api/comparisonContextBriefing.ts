import {
  briefingValidation as v, streamBriefing, validateBriefingResult, validateHypotheses,
  type BriefingEvidence, type BriefingSelection, type BriefingStatement, type ComparisonBriefingResult, type BriefingPhase,
} from "./comparisonBriefing";

export type MacroRegion = "us" | "euro_area";
export type BriefingContextOptions = { news: boolean; macro_regions: MacroRegion[] };
type ContextStatus = "available" | "partial" | "empty" | "unavailable" | "no_price_window";
export interface ContextSectionBase {
  citation_id: string; pair_citation_id: string; start_date: string | null; end_date: string | null;
  retrieved_at: string | null; status: ContextStatus; reason: string | null;
}
export interface ContextHeadline {
  citation_id: string; title: string; title_truncated: boolean; url: string; source: string; published_at: string;
}
export interface ContextNewsGroup {
  citation_id: string; symbol: string; status: "available" | "no_matches" | "feed_error";
  examined_count: number; matched_count: number; upstream_display_limit: number;
  returned_headline_count: number; withheld_invalid_count: number; withheld_duplicate_count: number;
  headlines: ContextHeadline[];
}
export interface ContextNewsSection extends ContextSectionBase {
  kind: "headlines"; source: "current_keyless_feeds"; fetch_limit_per_symbol: number | null; groups: ContextNewsGroup[];
}
export interface ContextMacroSeries {
  citation_id: string; series_id: string; label: string; source: "fred" | "eurostat" | "ecb"; source_url: string;
  title: string | null; units: string | null; frequency: string | null;
  status: "available" | "no_observations" | "feed_error"; returned_observation_count: number;
  upstream_matched_count: number | null; withheld_conflict_count: number | null;
  observations: { reference_date: string; value: number; flag: string | null }[];
}
export interface ContextMacroSection extends ContextSectionBase {
  kind: "macro"; region: MacroRegion; vintage_basis: "current_at_retrieval"; realtime_date: string | null; series: ContextMacroSeries[];
}
export type ContextSection = ContextNewsSection | ContextMacroSection;
export interface ContextEvidence {
  schema_version: "1"; evidence_kind: "comparison_with_optional_context"; citation_scope: "packet_local";
  packet_id: string; prepared_at: string; requested: BriefingContextOptions; price: BriefingEvidence;
  sections: ContextSection[]; news_limit_per_symbol: 5; macro_limit_per_series: 24; caveats: string[]; always_excluded: string[];
}
export interface ContextBriefingResult extends Omit<ComparisonBriefingResult, "evidence"> {
  evidence: ContextEvidence | null; possible_context: BriefingStatement[];
}

export const CONTEXT_CAVEATS = {
  context_is_not_causation_or_advice: "Context is not causation or investment advice.",
  headlines_are_untrusted_source_text_not_verified_facts: "Headlines are source-reported text, not verified facts or article-body research.",
  current_feeds_are_not_a_complete_historical_archive: "Current news feeds do not provide a complete historical archive.",
  macro_is_global_not_ticker_attribution: "Selected macro regions provide global context, not ticker-specific attribution.",
  reference_dates_are_not_publication_dates: "Macro reference dates are not publication dates.",
  current_vintages_do_not_establish_past_knowledge: "Current macro vintages do not establish what investors knew then.",
  missing_or_excluded_context_is_not_evidence_of_absence: "Missing or excluded sources are not evidence of absence.",
  price_packet_exclusions_apply_to_price_subpacket_only: "Price-only exclusions apply to the nested price packet, not the selected context.",
} as const;
export const CONTEXT_EXCLUSIONS = ["fundamentals", "sec_filing_checks", "technical_measures", "fx_views", "adjusted_views", "exchange_local_views", "private_research", "economic_calendar"];
export const CONTEXT_STATUS: Record<ContextStatus, string> = {
  available: "Available", partial: "Partial coverage", empty: "No returned matches", unavailable: "Source unavailable", no_price_window: "No shared price window",
};
export const CONTEXT_REASONS: Record<string, string> = {
  provider_error: "Provider failed", timed_out: "Source deadline reached", missing_api_key: "Provider key not configured",
  invalid_response: "Source response could not be validated", not_prepared: "Source not prepared", no_price_window: "No shared price window; source not queried",
};
export function safeContextUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
const count = (value: unknown): value is number => v.finite(value) && Number.isInteger(value) && value >= 0;
const nullableCount = (value: unknown) => value === null || count(value);
const boundedText = (value: unknown, max: number): value is string => v.text(value) && value.length <= max;
const sameSet = (value: unknown, expected: string[]) => v.strings(value) && v.unique(value) && value.length === expected.length && expected.every((key) => value.includes(key));

function validPacket(value: unknown, selection: BriefingSelection, options: BriefingContextOptions): value is ContextEvidence {
  if (!v.record(value) || value.schema_version !== "1" || value.evidence_kind !== "comparison_with_optional_context"
    || value.citation_scope !== "packet_local" || !v.text(value.packet_id) || !/^[a-f0-9]{64}$/.test(value.packet_id)
    || !v.timestamp(value.prepared_at) || !v.validEvidence(value.price, selection) || !v.record(value.requested)
    || value.requested.news !== options.news || !sameSet(value.requested.macro_regions, options.macro_regions)
    || value.news_limit_per_symbol !== 5 || value.macro_limit_per_series !== 24
    || !sameSet(value.caveats, Object.keys(CONTEXT_CAVEATS)) || !sameSet(value.always_excluded, CONTEXT_EXCLUSIONS)
    || !Array.isArray(value.sections)) return false;
  const kinds = [...(options.news ? ["headlines"] : []), ...options.macro_regions];
  if (value.sections.length !== kinds.length * value.price.comparisons.length) return false;
  for (const [index, raw] of value.sections.entries()) {
    if (!v.record(raw)) return false;
    const pair = value.price.comparisons[Math.floor(index / kinds.length)];
    const kind = kinds[index % kinds.length];
    const id = `C${index + 1}`;
    if (raw.citation_id !== id || raw.pair_citation_id !== pair.citation_id
      || raw.start_date !== (pair.returns?.start_date ?? null) || raw.end_date !== (pair.returns?.end_date ?? null)
      || !v.choice(raw.status, Object.keys(CONTEXT_STATUS)) || !v.nullableText(raw.reason)
      || (raw.retrieved_at !== null && !v.timestamp(raw.retrieved_at))
      || (!pair.returns && raw.status !== "no_price_window") || (pair.returns && raw.status === "no_price_window")) return false;
    if (kind === "headlines") {
      if (raw.kind !== "headlines" || raw.source !== "current_keyless_feeds" || !Array.isArray(raw.groups)
        || !nullableCount(raw.fetch_limit_per_symbol) || ![0, 2].includes(raw.groups.length)) return false;
      for (const [groupIndex, group] of raw.groups.entries()) {
        const groupId = `${id}G${groupIndex + 1}`;
        if (!v.record(group) || group.citation_id !== groupId || group.symbol !== (groupIndex === 0 ? pair.anchor.symbol : pair.comparison.symbol)
          || !v.choice(group.status, ["available", "no_matches", "feed_error"])
          || ![group.examined_count, group.matched_count, group.returned_headline_count, group.withheld_invalid_count, group.withheld_duplicate_count].every(count)
          || !count(group.upstream_display_limit) || group.upstream_display_limit < 1
          || !Array.isArray(group.headlines) || group.headlines.length > 5
          || (group.status !== "available" && group.headlines.length > 0)
          || (group.status === "available" && group.headlines.length === 0)
          || Number(group.matched_count) > Number(group.examined_count) || Number(group.returned_headline_count) > Number(group.matched_count)
          || group.headlines.length > Number(group.returned_headline_count)) return false;
        for (const [itemIndex, item] of group.headlines.entries()) {
          if (!v.record(item) || item.citation_id !== `${groupId}H${itemIndex + 1}` || !boundedText(item.title, 600)
            || typeof item.title_truncated !== "boolean" || !boundedText(item.source, 200) || !boundedText(item.url, 2048)
            || !safeContextUrl(item.url) || !v.timestamp(item.published_at) || !pair.returns
            || new Date(item.published_at as string).toISOString().slice(0, 10) < pair.returns.start_date
            || new Date(item.published_at as string).toISOString().slice(0, 10) > pair.returns.end_date) return false;
        }
      }
    } else {
      if (raw.kind !== "macro" || raw.region !== kind || raw.vintage_basis !== "current_at_retrieval"
        || (raw.realtime_date !== null && !v.day(raw.realtime_date)) || !Array.isArray(raw.series) || raw.series.length > 3) return false;
      if (kind === "us" && raw.retrieved_at !== null && raw.realtime_date !== new Date(raw.retrieved_at as string).toISOString().slice(0, 10)) return false;
      const ids = kind === "us" ? ["CPIAUCSL", "UNRATE", "FEDFUNDS"] : ["prc_hicp_minr", "une_rt_m", "FM.D.U2.EUR.4F.KR.DFR.LEV"];
      const seen = new Set();
      for (const series of raw.series) {
        if (!v.record(series) || typeof series.series_id !== "string" || !ids.includes(series.series_id) || seen.has(series.series_id)
          || series.citation_id !== `${id}S${ids.indexOf(series.series_id) + 1}` || !boundedText(series.label, 200)
          || !v.choice(series.source, kind === "us" ? ["fred"] : series.series_id === ids[2] ? ["ecb"] : ["eurostat"])
          || !safeContextUrl(series.source_url) || !v.nullableText(series.title) || !v.nullableText(series.units) || !v.nullableText(series.frequency)
          || !v.choice(series.status, ["available", "no_observations", "feed_error"])
          || !count(series.returned_observation_count) || !nullableCount(series.upstream_matched_count) || !nullableCount(series.withheld_conflict_count)
          || !Array.isArray(series.observations) || series.observations.length > 24 || series.observations.length > series.returned_observation_count
          || (series.status !== "available" && series.observations.length > 0)
          || (series.status === "available" && (!series.observations.length || !v.text(series.units) || !v.text(series.frequency)))) return false;
        seen.add(series.series_id);
        let previous = "";
        for (const observation of series.observations) {
          const first = pair.returns && String(series.frequency).toLowerCase() === "monthly" ? pair.returns.start_date.slice(0, 8) + "01" : pair.returns?.start_date;
          if (!v.record(observation) || !v.day(observation.reference_date) || !v.finite(observation.value) || !v.nullableText(observation.flag)
            || !pair.returns || !first || observation.reference_date < first || observation.reference_date > pair.returns.end_date || observation.reference_date <= previous) return false;
          previous = observation.reference_date;
        }
      }
    }
    const items = raw.kind === "headlines" ? raw.groups : raw.series;
    if (!Array.isArray(items) || ((raw.status === "no_price_window" || raw.retrieved_at === null) && items.length)) return false;
    if (["available", "partial", "empty"].includes(String(raw.status)) && (!raw.retrieved_at || !items.length)) return false;
    if (items.length) {
      const errors = items.filter((item) => item.status === "feed_error").length;
      const hasValues = items.some((item) => raw.kind === "headlines" ? item.headlines.length : item.observations.length);
      const expected = errors === items.length ? "unavailable" : errors ? "partial" : hasValues ? "available" : "empty";
      if (raw.status !== expected && !(raw.status === "unavailable" && !hasValues)) return false;
      if (raw.kind === "macro" && raw.status !== "unavailable" && items.length !== 3) return false;
    }
  }
  return true;
}

/** Check identity, transport shape and references, never semantic truth of prose. */
export function validateContextBriefingResult(value: unknown, selection: BriefingSelection, options: BriefingContextOptions): ContextBriefingResult {
  if (!v.record(value) || (value.evidence !== null && !validPacket(value.evidence, selection, options))) throw v.invalid();
  const packet = value.evidence as ContextEvidence | null;
  const known = new Set(["SCOPE", ...(packet?.price.comparisons.map((pair) => pair.citation_id) ?? [])]);
  const usable = new Map<string, string>();
  const missing = new Set<string>();
  const material = new Set(["SCOPE"]);
  for (const section of packet?.sections ?? []) {
    known.add(section.citation_id); material.add(section.citation_id);
    if (!["available", "partial"].includes(section.status)) missing.add(section.citation_id);
    if (section.kind === "headlines") {
      for (const group of section.groups) {
        known.add(group.citation_id);
        if (group.status !== "available") missing.add(group.citation_id);
        if (group.withheld_invalid_count || group.withheld_duplicate_count || group.returned_headline_count > group.headlines.length || group.matched_count > group.returned_headline_count) material.add(group.citation_id);
        for (const item of group.headlines) {
          known.add(item.citation_id); usable.set(item.citation_id, section.pair_citation_id);
          if (item.title_truncated) material.add(item.citation_id);
        }
      }
    } else for (const series of section.series) {
      known.add(series.citation_id);
      if (series.status === "available" && series.observations.length) usable.set(series.citation_id, section.pair_citation_id);
      else missing.add(series.citation_id);
      if (series.withheld_conflict_count || series.returned_observation_count > series.observations.length || series.observations.some((item) => item.flag)) material.add(series.citation_id);
    }
  }
  for (const name of ["observations", "possible_context", "limitations", "unknowns"]) {
    const points = value[name];
    if (!Array.isArray(points) || points.length > (name === "observations" ? 6 : name === "possible_context" ? 12 : 18)
      || points.some((point) => !v.record(point) || !boundedText(point.text, 600) || point.text.trim().length < 10
        || !v.strings(point.citation_ids) || !point.citation_ids.length || point.citation_ids.length > 160
        || !v.unique(point.citation_ids) || point.citation_ids.some((ref) => !known.has(ref)))) throw v.invalid();
  }
  const result = value as unknown as ContextBriefingResult;
  const available = new Set(packet?.price.comparisons.filter((pair) => pair.status === "available").map((pair) => pair.citation_id));
  validateHypotheses(result.hypotheses, result.status === "complete", available, usable);
  if (result.status === "complete") {
    const limited = new Set(result.limitations.flatMap((item) => item.citation_ids));
    const disclosed = new Set([...limited, ...result.unknowns.flatMap((item) => item.citation_ids)]);
    if ([...material].some((ref) => !limited.has(ref)) || [...missing].some((ref) => !disclosed.has(ref))) throw v.invalid();
    for (const point of result.possible_context) {
      const inputs = point.citation_ids.filter((ref) => usable.has(ref));
      if (!inputs.length || inputs.some((ref) => !point.citation_ids.includes(usable.get(ref)!))
        || point.citation_ids.some((ref) => !inputs.includes(ref) && !inputs.some((input) => usable.get(input) === ref))) throw v.invalid();
    }
  } else if (result.possible_context.length) throw v.invalid();
  const priceRefs = new Set(["SCOPE", ...(packet?.price.comparisons.map((pair) => pair.citation_id) ?? [])]);
  const project = (points: BriefingStatement[]) => {
    const refs = [...new Set(points.flatMap((item) => item.citation_ids).filter((ref) => priceRefs.has(ref)))];
    return refs.length ? [{ text: "Reference coverage projection only.", citation_ids: refs }] : [];
  };
  validateBriefingResult({ ...result, evidence: packet?.price ?? null,
    hypotheses: result.hypotheses.map((item) => ({ ...item, citation_ids: item.citation_ids.filter((ref) => available.has(ref)) })),
    limitations: project(result.limitations), unknowns: project(result.unknowns),
  }, selection);
  return result;
}

export function streamContextBriefing(selection: BriefingSelection, context: BriefingContextOptions,
  options: { signal?: AbortSignal; onProgress?: (phase: BriefingPhase) => void } = {}): Promise<ContextBriefingResult> {
  const requested: BriefingContextOptions = { news: context.news, macro_regions: (["us", "euro_area"] as const).filter((region) => context.macro_regions.includes(region)) };
  if (typeof context.news !== "boolean" || context.macro_regions.length !== requested.macro_regions.length || (!requested.news && !requested.macro_regions.length)) {
    return Promise.reject(new Error("Choose news or a macro region before generating a context briefing."));
  }
  return streamBriefing(selection, options, {
    path: "/market-context/briefing-context/stream", context: true,
    body: (normalized) => ({ ...normalized, context: requested }),
    validate: (value, normalized) => validateContextBriefingResult(value, normalized, requested),
  });
}
