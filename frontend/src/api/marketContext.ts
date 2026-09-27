import { api } from "./base";

export type MarketContextPeriod = "1M" | "3M" | "6M";

export interface MarketComparisonRow {
  symbol: string;
  status: "available" | "unavailable";
  reason: "missing_history" | "insufficient_overlap" | "provider_error" | null;
  start_date: string | null;
  end_date: string | null;
  anchor_latest_date: string | null;
  comparison_latest_date: string | null;
  observations: number | null;
  freshness: "current" | "stale" | null;
  anchor_return_pct: number | null;
  comparison_return_pct: number | null;
  relative_return_pp: number | null;
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
