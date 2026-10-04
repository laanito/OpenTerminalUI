import { api } from "./base";

export type MarketContextPeriod = "1M" | "3M" | "6M";

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
  basis: "shared_utc_date_unadjusted_closes";
  as_of_date: string;
  anchor: MarketTechnicalMeasures;
  comparison: MarketTechnicalMeasures;
}

export interface MarketActionDisclosure {
  source: "yahoo_chart" | "unavailable";
  matched_count: number;
  display_limit: number;
  actions: { date: string; type: "split" | "dividend" }[];
}

export interface MarketAdjustedCloseCoverage {
  status: "complete" | "partial" | "unavailable";
  source: "yahoo_adjclose" | null;
  available_observations: number;
  shared_observations: number;
}

export interface MarketAdjustedAssetObservations {
  return_pct: number;
  technical_measures: MarketTechnicalMeasures;
}

export interface MarketAdjustedObservations {
  basis: "shared_utc_date_provider_adjusted_closes";
  source: "yahoo_adjclose";
  as_of_date: string;
  anchor: MarketAdjustedAssetObservations | null;
  comparison: MarketAdjustedAssetObservations | null;
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
  observations: number | null;
  freshness: "current" | "stale" | null;
  anchor_return_pct: number | null;
  comparison_return_pct: number | null;
  relative_return_pp: number | null;
  technical_observations?: MarketTechnicalObservations | null;
  action_disclosure?: { anchor: MarketActionDisclosure; comparison: MarketActionDisclosure } | null;
  adjusted_close_coverage?: { anchor: MarketAdjustedCloseCoverage; comparison: MarketAdjustedCloseCoverage } | null;
  adjusted_observations?: MarketAdjustedObservations | null;
  points: MarketComparisonPoint[];
}

export interface MarketComparisonResponse {
  anchor: string;
  period: MarketContextPeriod;
  retrieved_at: string;
  data_source: "unified_history";
  return_basis: "native_quote_currency_unadjusted";
  method: "same_utc_date_daily_closes";
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

export interface MarketFundamentalRelease {
  release_date: string;
  fiscal_period_end: string;
  metric: "revenue" | "net_income" | "eps" | "free_cash_flow";
  value: number;
  source: string;
}

export interface MarketFundamentalsGroup {
  symbol: string;
  status: "available" | "no_usable_records" | "feed_error";
  examined_count: number;
  matched_count: number;
  releases: MarketFundamentalRelease[];
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

export async function compareMarketContext(
  anchor: string,
  comparisons: string[],
  period: MarketContextPeriod,
): Promise<MarketComparisonResponse> {
  const response = await api.post<MarketComparisonResponse>("/market-context/compare", { anchor, comparisons, period });
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
