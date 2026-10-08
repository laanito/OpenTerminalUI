import { api } from "./base";

export type MarketContextPeriod = "1M" | "3M" | "6M";
export type MarketReportingCurrency = "USD" | "EUR" | "GBP" | "JPY" | "CHF" | "AUD" | "CAD" | "INR";

export interface MarketFXRateEvidence {
  rate: number;
  rate_at: string;
  requested_date: string;
  source: string;
  source_symbol: string;
  degraded: boolean;
  degraded_reason: string | null;
}

export interface MarketFXReturnComponents {
  price_return_pct: number;
  currency_return_pct: number;
  interaction_pct: number;
  converted_return_pct: number;
}

export interface MarketFXRelativeComponents {
  price_difference_pp: number;
  currency_difference_pp: number;
  interaction_difference_pp: number;
  converted_difference_pp: number;
}

export interface MarketFXEndpointComparison {
  status: "available" | "unavailable";
  reason: "price_unavailable" | "quote_unit_unknown" | "quote_unit_unsupported" | "fx_unavailable" | null;
  reporting_currency: MarketReportingCurrency;
  start_date: string | null;
  end_date: string | null;
  anchor_quote_unit: string | null;
  comparison_quote_unit: string | null;
  anchor_return_pct: number | null;
  comparison_return_pct: number | null;
  relative_return_pp: number | null;
  anchor_components?: MarketFXReturnComponents | null;
  comparison_components?: MarketFXReturnComponents | null;
  relative_components?: MarketFXRelativeComponents | null;
  degraded: boolean;
  anchor_start_fx: MarketFXRateEvidence | null;
  anchor_end_fx: MarketFXRateEvidence | null;
  comparison_start_fx: MarketFXRateEvidence | null;
  comparison_end_fx: MarketFXRateEvidence | null;
}

export interface MarketFXSharedPath {
  status: "available" | "unavailable";
  reason: MarketFXEndpointComparison["reason"];
  reporting_currency: MarketReportingCurrency;
  observations: number;
  degraded: boolean;
  points: {
    date: string;
    anchor_index: number;
    comparison_index: number;
    anchor_fx: MarketFXRateEvidence;
    comparison_fx: MarketFXRateEvidence;
  }[];
}

export interface MarketComparisonPoint {
  date: string;
  anchor_index: number;
  comparison_index: number;
}

export interface MarketTechnicalMeasures {
  max_drawdown_pct: number;
  max_drawdown_peak_date: string | null;
  max_drawdown_trough_date: string | null;
  sma20_gap_pct: number | null;
}

export interface MarketTechnicalObservations {
  basis: "shared_utc_date_provider_closes";
  as_of_date: string;
  anchor: MarketTechnicalMeasures;
  comparison: MarketTechnicalMeasures;
}

export interface MarketNativeAssetTechnicalObservations {
  start_date: string;
  end_date: string;
  observations: number;
  additional_dates_vs_pair: number;
  technical_measures: MarketTechnicalMeasures;
}

export interface MarketNativeTechnicalObservations {
  basis: "per_asset_utc_date_provider_closes_within_pair_window";
  anchor: MarketNativeAssetTechnicalObservations;
  comparison: MarketNativeAssetTechnicalObservations;
}

export interface MarketActionDisclosure {
  source: "yahoo_chart" | "unavailable";
  matched_count: number;
  display_limit: number;
  actions: { date: string; type: "split" | "dividend" }[];
}

export interface MarketCloseDateConflicts {
  provider_close_count: number;
  provider_close_dates: string[];
  adjusted_close_count: number;
  adjusted_close_dates: string[];
  display_limit: number;
}

export interface MarketQuoteUnitDisclosure {
  unit: string | null;
  source: "yahoo_chart_meta" | "unavailable";
}

export interface MarketAdjustedCloseCoverage {
  status: "complete" | "partial" | "unavailable";
  source: "yahoo_adjclose" | null;
  available_observations: number;
  shared_observations: number;
}

export interface MarketAdjustedAssetObservations {
  return_pct: number;
  provider_return_pct?: number;
  adjusted_minus_provider_return_pp?: number;
  technical_measures: MarketTechnicalMeasures;
}

export interface MarketAdjustedObservations {
  basis: "shared_utc_date_provider_adjusted_closes";
  source: "yahoo_adjclose";
  as_of_date: string;
  anchor: MarketAdjustedAssetObservations | null;
  comparison: MarketAdjustedAssetObservations | null;
}

export interface MarketAdjustedPairComparison {
  basis: "shared_utc_date_provider_adjusted_closes";
  source: "yahoo_adjclose";
  start_date: string;
  end_date: string;
  observations: number;
  anchor_return_pct: number;
  comparison_return_pct: number;
  relative_return_pp: number;
  provider_relative_return_pp?: number;
  adjusted_minus_provider_relative_return_pp?: number;
  points: MarketComparisonPoint[];
}

export interface MarketNativeAdjustedCloseCoverage {
  status: "complete" | "partial" | "unavailable";
  source: "yahoo_adjclose" | null;
  available_observations: number;
  native_observations: number;
}

export interface MarketNativeAdjustedAssetObservations extends MarketAdjustedAssetObservations {
  start_date: string;
  end_date: string;
  observations: number;
  additional_dates_vs_pair: number;
}

export interface MarketNativeAdjustedObservations {
  basis: "per_asset_utc_date_provider_adjusted_closes_within_pair_window";
  source: "yahoo_adjclose";
  anchor: MarketNativeAdjustedAssetObservations | null;
  comparison: MarketNativeAdjustedAssetObservations | null;
}

export interface MarketComparisonRow {
  symbol: string;
  status: "available" | "unavailable";
  reason: "missing_history" | "insufficient_overlap" | "provider_error" | null;
  start_date: string | null;
  end_date: string | null;
  anchor_latest_date: string | null;
  comparison_latest_date: string | null;
  anchor_history_source: string | null;
  comparison_history_source: string | null;
  anchor_history_feed?: string | null;
  comparison_history_feed?: string | null;
  anchor_reported_adjustment_basis?: "raw" | "non_split_adjusted" | "unspecified" | null;
  comparison_reported_adjustment_basis?: "raw" | "non_split_adjusted" | "unspecified" | null;
  pair_reported_basis_status?: "matching_reported" | "mixed_reported" | "unverified" | "unavailable";
  anchor_quote_unit?: MarketQuoteUnitDisclosure;
  comparison_quote_unit?: MarketQuoteUnitDisclosure;
  anchor_close_date_conflicts?: MarketCloseDateConflicts;
  comparison_close_date_conflicts?: MarketCloseDateConflicts;
  observations: number | null;
  freshness: "current" | "stale" | null;
  anchor_return_pct: number | null;
  comparison_return_pct: number | null;
  relative_return_pp: number | null;
  technical_observations?: MarketTechnicalObservations | null;
  native_technical_observations?: MarketNativeTechnicalObservations | null;
  action_disclosure?: { anchor: MarketActionDisclosure; comparison: MarketActionDisclosure } | null;
  adjusted_close_coverage?: { anchor: MarketAdjustedCloseCoverage; comparison: MarketAdjustedCloseCoverage } | null;
  adjusted_observations?: MarketAdjustedObservations | null;
  adjusted_pair?: MarketAdjustedPairComparison | null;
  native_adjusted_close_coverage?: { anchor: MarketNativeAdjustedCloseCoverage; comparison: MarketNativeAdjustedCloseCoverage } | null;
  native_adjusted_observations?: MarketNativeAdjustedObservations | null;
  fx_endpoint_comparison?: MarketFXEndpointComparison | null;
  fx_shared_path?: MarketFXSharedPath | null;
  points: MarketComparisonPoint[];
}

export interface MarketComparisonResponse {
  anchor: string;
  period: MarketContextPeriod;
  retrieved_at: string;
  data_source: "unified_history";
  return_basis: "native_quote_currency_provider_closes";
  method: "same_utc_date_daily_closes";
  reporting_currency?: MarketReportingCurrency | null;
  comparisons: MarketComparisonRow[];
}

export interface MarketHeadline {
  title: string;
  url: string;
  source: string;
  published_at: string;
}

export interface MarketHeadlineGroup {
  symbol: string;
  status: "available" | "feed_error";
  examined_count: number;
  matched_count: number;
  headlines: MarketHeadline[];
}

export interface MarketHeadlinesResponse {
  anchor: string;
  comparison: string;
  start_date: string;
  end_date: string;
  retrieved_at: string;
  source: "current_keyless_feeds";
  fetch_limit_per_symbol: number;
  display_limit_per_symbol: number;
  groups: MarketHeadlineGroup[];
}

export interface MarketMacroEvent {
  date: string;
  country: string | null;
  event_name: string;
  impact: "high" | "medium" | "low" | "unknown";
}

export interface MarketMacroEventsResponse {
  start_date: string;
  end_date: string;
  retrieved_at: string;
  status: "available" | "unavailable";
  reason: "missing_api_key" | "provider_error" | null;
  source: "finnhub" | "fmp" | null;
  matched_count: number;
  display_limit: number;
  events: MarketMacroEvent[];
}

export interface MarketMacroObservationSeries {
  series_id: "CPIAUCSL" | "UNRATE" | "FEDFUNDS";
  label: string;
  status: "available" | "no_observations" | "feed_error";
  title: string | null;
  units: string | null;
  frequency: string | null;
  matched_count: number;
  withheld_conflict_count: number;
  observations: { reference_date: string; value: number }[];
}

export interface MarketMacroObservationsResponse {
  start_date: string;
  end_date: string;
  retrieved_at: string;
  realtime_date: string;
  source: "fred";
  status: "available" | "unavailable";
  reason: "missing_api_key" | "provider_error" | null;
  series: MarketMacroObservationSeries[];
}

export interface MarketFundamentalRelease {
  release_date: string;
  fiscal_period_end: string;
  metric: "revenue" | "net_income" | "eps" | "free_cash_flow";
  value: number;
  source: string;
}

export interface MarketFundamentalConflict {
  release_date: string;
  fiscal_period_end: string;
  metric: MarketFundamentalRelease["metric"];
  source: string;
  distinct_value_count: number;
}

export interface MarketFundamentalsGroup {
  symbol: string;
  status: "available" | "ambiguous" | "no_usable_records" | "feed_error";
  examined_count: number;
  matched_count: number;
  conflicting_count: number;
  releases: MarketFundamentalRelease[];
  conflicts: MarketFundamentalConflict[];
}

export interface MarketFundamentalsResponse {
  anchor: string;
  comparison: string;
  start_date: string;
  end_date: string;
  retrieved_at: string;
  source: "on_demand_pit_fetch";
  display_limit_per_symbol: number;
  groups: MarketFundamentalsGroup[];
}

export interface SecFiledFact {
  filed_date: string;
  accession: string;
  taxonomy: "us-gaap";
  concept: string;
  unit: string;
  form: "10-K" | "10-Q" | "10-K/A" | "10-Q/A";
  period_start: string;
  period_end: string;
  value: number;
}

export interface SecDisclosureDifferenceCandidate {
  concept: string;
  unit: string;
  period_start: string;
  period_end: string;
  latest_filed_date: string;
  disclosure_count: number;
  distinct_accession_count: number;
  distinct_value_count: number;
  within_accession_conflict: boolean;
  disclosures: SecFiledFact[];
}

export interface SecFiledFactsResponse {
  contract_version: 1;
  symbol: string;
  filed_start: string;
  filed_end: string;
  retrieved_at: string;
  status: "available" | "no_matching_facts" | "not_covered" | "ambiguous_ticker" | "configuration_required" | "provider_error";
  evidence_scope: "sec_current_companyfacts_accession_tagged";
  cik: number | null;
  matched_count: number;
  examined_count: number;
  display_limit: number;
  facts: SecFiledFact[];
  difference_basis?: "same_concept_unit_exact_period_values_not_verified_revisions";
  candidate_group_count?: number;
  candidate_display_limit?: number;
  disclosures_per_candidate_limit?: number;
  difference_candidates?: SecDisclosureDifferenceCandidate[];
}

export interface SecSubmissionClaim {
  accession: string;
  form: "10-K" | "10-Q" | "10-K/A" | "10-Q/A";
  filed_date: string;
}

export interface SecSubmissionCrosscheckItem extends SecSubmissionClaim {
  status: "matched" | "metadata_mismatch" | "not_in_recent_index" | "ambiguous_in_recent_index";
  submission_form: string | null;
  submission_filed_date: string | null;
  accepted_at: string | null;
}

export interface SecSubmissionCrosscheckResponse {
  contract_version: 1;
  cik: number;
  retrieved_at: string;
  status: "available" | "configuration_required" | "provider_error";
  index_scope: "sec_current_recent_submissions_only";
  checked_count: number;
  matched_count: number;
  results: SecSubmissionCrosscheckItem[];
}

export interface FundamentalCaptureSummary {
  id: string;
  symbol: string;
  captured_at: string;
  status: "records_observed" | "no_eligible_records_observed" | "fetch_error";
  examined_count: number;
  record_count: number;
  content_hash: string;
  evidence_scope: "terminal_observation_only";
}

export interface FundamentalCaptureDetail extends FundamentalCaptureSummary {
  records: MarketFundamentalRelease[];
}

export interface ObservedFundamentalDelta {
  release_date: string;
  fiscal_period_end: string;
  metric: MarketFundamentalRelease["metric"];
  source: string;
  kind: "only_in_earlier" | "only_in_later" | "value_set_different";
  earlier_values: number[];
  later_values: number[];
}

export interface ObservedFundamentalsDeltaResponse {
  contract_version: 1;
  evidence_scope: "terminal_observation_only";
  comparison_basis: "retained_capture_candidate_sets";
  symbol: string;
  earlier_capture: FundamentalCaptureSummary;
  later_capture: FundamentalCaptureSummary;
  comparison_status: "comparable" | "unavailable";
  reason: "earlier_capture_not_records_observed" | "later_capture_not_records_observed" | null;
  unchanged_identity_count: number;
  deltas: ObservedFundamentalDelta[];
}

export async function compareMarketContext(
  anchor: string,
  comparisons: string[],
  period: MarketContextPeriod,
  reportingCurrency?: MarketReportingCurrency,
): Promise<MarketComparisonResponse> {
  const response = await api.post<MarketComparisonResponse>("/market-context/compare", { anchor, comparisons, period, ...(reportingCurrency ? { reporting_currency: reportingCurrency } : {}) });
  return response.data;
}

export async function fetchMarketContextHeadlines(
  anchor: string,
  comparison: string,
  startDate: string,
  endDate: string,
): Promise<MarketHeadlinesResponse> {
  const response = await api.post<MarketHeadlinesResponse>("/market-context/headlines", {
    anchor, comparison, start_date: startDate, end_date: endDate,
  });
  return response.data;
}

export async function fetchMarketContextMacroEvents(
  startDate: string,
  endDate: string,
): Promise<MarketMacroEventsResponse> {
  const response = await api.post<MarketMacroEventsResponse>("/market-context/macro-events", {
    start_date: startDate, end_date: endDate,
  });
  return response.data;
}

export async function fetchMarketContextMacroObservations(
  startDate: string,
  endDate: string,
  realtimeDate?: string,
): Promise<MarketMacroObservationsResponse> {
  const response = await api.post<MarketMacroObservationsResponse>("/market-context/macro-observations", {
    start_date: startDate, end_date: endDate, ...(realtimeDate ? { realtime_date: realtimeDate } : {}),
  });
  return response.data;
}

export async function fetchMarketContextFundamentalReleases(
  anchor: string,
  comparison: string,
  startDate: string,
  endDate: string,
): Promise<MarketFundamentalsResponse> {
  const response = await api.post<MarketFundamentalsResponse>("/market-context/fundamental-releases", {
    anchor, comparison, start_date: startDate, end_date: endDate,
  });
  return response.data;
}

export async function fetchMarketSecFiledFacts(symbol: string, filedStart: string, filedEnd: string): Promise<SecFiledFactsResponse> {
  const response = await api.post<SecFiledFactsResponse>("/market-context/sec-filed-facts", {
    symbol, filed_start: filedStart, filed_end: filedEnd,
  });
  return response.data;
}

export async function fetchSecSubmissionCrosscheck(cik: number, claims: SecSubmissionClaim[]): Promise<SecSubmissionCrosscheckResponse> {
  const response = await api.post<SecSubmissionCrosscheckResponse>("/market-context/sec-submission-crosscheck", { cik, claims });
  return response.data;
}

export async function captureMarketFundamentals(symbol: string): Promise<FundamentalCaptureDetail> {
  const response = await api.post<FundamentalCaptureDetail>("/market-context/fundamental-captures", { symbol });
  return response.data;
}

export async function listMarketFundamentalCaptures(symbol: string): Promise<FundamentalCaptureSummary[]> {
  const response = await api.get<FundamentalCaptureSummary[]>("/market-context/fundamental-captures", { params: { symbol } });
  return response.data;
}

export async function getMarketFundamentalCapture(id: string): Promise<FundamentalCaptureDetail> {
  const response = await api.get<FundamentalCaptureDetail>(`/market-context/fundamental-captures/${encodeURIComponent(id)}`);
  return response.data;
}

export async function compareMarketFundamentalCaptures(fromId: string, toId: string): Promise<ObservedFundamentalsDeltaResponse> {
  const response = await api.get<ObservedFundamentalsDeltaResponse>("/market-context/fundamental-captures/observed-delta", {
    params: { from_id: fromId, to_id: toId },
  });
  return response.data;
}
