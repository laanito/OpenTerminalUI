import { briefingValidation as v, type BriefingPair } from "./comparisonBriefing";
import type { ContextSectionBase } from "./comparisonContextBriefing";

export const FILING_CAVEATS = {
  filings_are_current_aggregation_not_verified_historical_knowledge_or_revision_order: "Current SEC aggregates do not establish historical investor knowledge or revision order.",
  fiscal_periods_are_not_filing_dates_and_filing_dates_are_not_publication_instants: "Fiscal periods measure activity; filing dates are separate from publication instants and terminal retrieval.",
  filing_conflicts_withhold_values_before_output_limits: "Conflicting values and filing metadata are withheld before display limits.",
};
export const FILING_REASONS: Record<string, string> = {
  configuration_required: "SEC_USER_AGENT is not configured", not_covered: "No exact SEC ticker coverage",
  ambiguous_ticker: "SEC ticker mapping is ambiguous", provider_error: "SEC provider failed",
  timed_out: "SEC source deadline reached", invalid_response: "SEC response could not be validated",
  not_prepared: "SEC evidence was not prepared",
};
export const FILING_CONCEPTS = {
  Revenues: { label: "Revenue", unit: "USD" },
  RevenueFromContractWithCustomerExcludingAssessedTax: { label: "Revenue from customer contracts", unit: "USD" },
  NetIncomeLoss: { label: "Net income / loss", unit: "USD" },
  EarningsPerShareDiluted: { label: "Diluted earnings per share", unit: "USD/shares" },
} as const;
export interface FilingDisclosure { accession: string; form: string; filed_date: string; filing_url: string }
export interface FilingMetricGroup {
  citation_id: string; taxonomy: "us-gaap"; concept: keyof typeof FILING_CONCEPTS; unit: string;
  period_start: string; period_end: string; status: "available" | "conflicting_values" | "conflicting_filing_metadata";
  value: number | null; distinct_value_count: number; disclosure_count: number;
  omitted_disclosure_count: number; disclosures: FilingDisclosure[];
}
export interface FilingSnapshot {
  schema_version: "1"; evidence_kind: "sec_filing_briefing"; packet_id: string;
  symbol: string; cik: number | null; filed_start: string; filed_end: string; retrieved_at: string;
  source: "sec_current_companyfacts"; historical_availability: "not_established"; revision_order: "not_established";
  status: "available" | "partial" | "empty" | "unavailable"; reason: string | null;
  examined_count: number; matched_fact_count: number; matched_group_count: number; conflicting_group_count: number;
  omitted_group_count: number; source_records_id: string | null; group_limit: 8; disclosure_limit: 3;
  groups: FilingMetricGroup[]; caveats: string[];
}
export interface FilingContextAsset {
  citation_id: string; symbol: string; status: FilingSnapshot["status"]; reason: string | null;
  snapshot: FilingSnapshot | null; group_citations: Record<string, string>;
}
export interface ContextFilingSection extends ContextSectionBase {
  kind: "fundamentals"; source: "sec_current_companyfacts"; assets: FilingContextAsset[];
}
const count = (x: unknown): x is number => v.finite(x) && Number.isSafeInteger(x) && x >= 0;
const positiveCik = (x: unknown): x is number => count(x) && x > 0 && x <= 9_999_999_999;
const hash = (x: unknown) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const forms = ["10-K", "10-Q", "10-K/A", "10-Q/A"];
const snapshotReasons = ["configuration_required", "not_covered", "ambiguous_ticker", "provider_error", "timed_out"];

function validSnapshot(raw: Record<string, unknown>, symbol: string, window: NonNullable<BriefingPair["returns"]>): boolean {
  if (Date.parse(window.end_date) - Date.parse(window.start_date) > 730 * 86_400_000) return false;
  if (raw.schema_version !== "1" || raw.evidence_kind !== "sec_filing_briefing" || !hash(raw.packet_id)
    || raw.symbol !== symbol || raw.filed_start !== window.start_date || raw.filed_end !== window.end_date
    || !v.timestamp(raw.retrieved_at) || raw.filed_end > new Date(raw.retrieved_at as string).toISOString().slice(0, 10)
    || raw.source !== "sec_current_companyfacts" || raw.historical_availability !== "not_established" || raw.revision_order !== "not_established"
    || !v.choice(raw.status, ["available", "partial", "empty", "unavailable"]) || !v.nullableText(raw.reason)
    || !(raw.cik === null || positiveCik(raw.cik)) || raw.group_limit !== 8 || raw.disclosure_limit !== 3
    || ![raw.examined_count, raw.matched_fact_count, raw.matched_group_count, raw.conflicting_group_count, raw.omitted_group_count].every(count)
    || !Array.isArray(raw.groups) || raw.groups.length > 8 || !v.strings(raw.caveats) || !raw.caveats.length
    || raw.caveats.length > 16 || raw.caveats.some((text) => !text.trim() || text.length > 500)) return false;
  if (raw.status === "unavailable") return v.choice(raw.reason, snapshotReasons) && raw.source_records_id === null
    && !raw.groups.length && [raw.examined_count, raw.matched_fact_count, raw.matched_group_count, raw.conflicting_group_count, raw.omitted_group_count].every((x) => x === 0);
  if (!positiveCik(raw.cik) || raw.reason !== null || !hash(raw.source_records_id)
    || raw.groups.length !== Math.min(Number(raw.matched_group_count), 8)
    || raw.omitted_group_count !== Number(raw.matched_group_count) - raw.groups.length
    || Number(raw.examined_count) < Number(raw.matched_fact_count) || Number(raw.matched_fact_count) < Number(raw.matched_group_count)
    || (raw.matched_group_count === 0 && raw.matched_fact_count !== 0)) return false;
  let available = 0, conflicts = 0, disclosures = 0;
  const identities = new Set<string>();
  for (const [index, group] of raw.groups.entries()) {
    if (!v.record(group) || group.citation_id !== `F${index + 1}` || group.taxonomy !== "us-gaap"
      || typeof group.concept !== "string" || !Object.prototype.hasOwnProperty.call(FILING_CONCEPTS, group.concept)
      || group.unit !== FILING_CONCEPTS[group.concept as keyof typeof FILING_CONCEPTS].unit
      || !v.day(group.period_start) || !v.day(group.period_end) || group.period_start > group.period_end
      || !v.choice(group.status, ["available", "conflicting_values", "conflicting_filing_metadata"])
      || !count(group.distinct_value_count) || group.distinct_value_count < 1 || group.distinct_value_count > Number(raw.matched_fact_count)
      || !count(group.disclosure_count) || group.disclosure_count < 1 || !count(group.omitted_disclosure_count)
      || !Array.isArray(group.disclosures) || group.disclosures.length !== Math.min(group.disclosure_count, 3)
      || group.omitted_disclosure_count !== group.disclosure_count - group.disclosures.length) return false;
    const identity = JSON.stringify([group.concept, group.unit, group.period_start, group.period_end]);
    if (identities.has(identity)) return false;
    identities.add(identity); disclosures += group.disclosure_count;
    if (group.status === "available") {
      if (!v.finite(group.value) || group.distinct_value_count !== 1) return false;
      available++;
    } else {
      if (group.value !== null || (group.status === "conflicting_values" ? group.distinct_value_count < 2 : group.distinct_value_count !== 1 || group.disclosure_count < 2)) return false;
      conflicts++;
    }
    const seen = new Set<string>();
    const metadata = new Map<string, Set<string>>();
    for (const disclosure of group.disclosures) {
      if (!v.record(disclosure) || typeof disclosure.accession !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(disclosure.accession)
        || !v.choice(disclosure.form, forms) || !v.day(disclosure.filed_date)
        || disclosure.filed_date < window.start_date || disclosure.filed_date > window.end_date || disclosure.filed_date < group.period_end
        || disclosure.filing_url !== `https://www.sec.gov/Archives/edgar/data/${raw.cik}/${disclosure.accession.replace(/-/g, "")}/${disclosure.accession}-index.html`) return false;
      const key = JSON.stringify([disclosure.accession, disclosure.form, disclosure.filed_date]);
      if (seen.has(key)) return false;
      seen.add(key);
      const entries = metadata.get(disclosure.accession) ?? new Set<string>();
      entries.add(JSON.stringify([disclosure.filed_date, disclosure.form]));
      metadata.set(disclosure.accession, entries);
    }
    const metadataConflict = [...metadata.values()].some((entries) => entries.size > 1);
    if ((group.status === "available" && metadataConflict)
      || (group.status === "conflicting_filing_metadata" && !group.omitted_disclosure_count && !metadataConflict)) return false;
  }
  if (disclosures > Number(raw.matched_fact_count) || Number(raw.conflicting_group_count) < conflicts
    || Number(raw.conflicting_group_count) > conflicts + Number(raw.omitted_group_count)) return false;
  const limited = Number(raw.conflicting_group_count) > 0 || Number(raw.omitted_group_count) > 0
    || raw.groups.some((group) => Number(group.omitted_disclosure_count) > 0);
  return raw.status === (available ? limited ? "partial" : "available" : "empty");
}

/** Validate scope, counts, links and identities; hashes/reasoning are not independently verified. */
export function validFilingSection(raw: Record<string, unknown>, pair: BriefingPair, sectionId: string): boolean {
  if (raw.kind !== "fundamentals" || raw.source !== "sec_current_companyfacts" || raw.retrieved_at !== null
    || !Array.isArray(raw.assets)) return false;
  if (!pair.returns) return raw.status === "no_price_window" && raw.reason === "no_price_window" && !raw.assets.length;
  if (raw.assets.length !== 2) return false;
  for (const [index, asset] of raw.assets.entries()) {
    const id = `${sectionId}A${index + 1}`, symbol = index === 0 ? pair.anchor.symbol : pair.comparison.symbol;
    if (!v.record(asset) || asset.citation_id !== id || asset.symbol !== symbol
      || !v.record(asset.group_citations) || !v.choice(asset.status, ["available", "partial", "empty", "unavailable"])) return false;
    if (asset.snapshot === null) {
      if (asset.status !== "unavailable" || !v.choice(asset.reason, ["provider_error", "timed_out", "missing_api_key", "invalid_response", "not_prepared"])
        || Object.keys(asset.group_citations).length) return false;
    } else {
      if (!v.record(asset.snapshot) || !validSnapshot(asset.snapshot, symbol, pair.returns)
        || asset.status !== asset.snapshot.status || asset.reason !== asset.snapshot.reason) return false;
      const groups = asset.snapshot.groups as FilingMetricGroup[];
      const citations = asset.group_citations;
      if (Object.keys(citations).length !== groups.length
        || groups.some((group) => citations[group.citation_id] !== `${id}${group.citation_id}`)) return false;
    }
  }
  const usable = raw.assets.some((a) => ["available", "partial"].includes(a.status));
  const failed = raw.assets.some((a) => a.status === "unavailable");
  const status = raw.assets.every((a) => a.status === "available") ? "available" : usable ? "partial" : failed ? "unavailable" : "empty";
  return raw.status === status && raw.reason === (failed ? "filing_inputs_unavailable" : null);
}
