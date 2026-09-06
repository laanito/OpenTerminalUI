import { api } from "./base";
import { DEFAULT_EQUITY_MARKET } from "../types/markets";
import type {
  FinancialsResponse,
  PeerResponse,
  DcfResponse,
  RelativeValuationResponse,
  FundamentalScoresResponse,
  PitFundamentalsResponse,
  UniverseMembersResponse,
  ShareholdingPatternResponse,
  EquityPerformanceSnapshot,
  PromoterHoldingsResponse,
  DeliverySeriesResponse,
  CapexTrackerResponse,
  TopBarTickersResponse,
} from "../types";
import type {
  SecurityHubOwnershipResponse,
  SecurityHubEstimatesResponse,
  SecurityHubEsgResponse,
} from "./types";

export async function getFinancials(symbol: string, market: string, period: "annual" | "quarterly"): Promise<FinancialsResponse> {
  const { data } = await api.get<FinancialsResponse>(`/stocks/${symbol}/financials`, { params: { market, period } });
  return data;
}

export async function fetchPeers(ticker: string): Promise<PeerResponse> {
  const { data } = await api.get<PeerResponse>(`/peers/${ticker}`);
  return data;
}

export async function fetchDcf(ticker: string): Promise<DcfResponse> {
  const { data } = await api.get<DcfResponse>(`/valuation/${ticker}/dcf`, { params: { auto: true } });
  return data;
}

export async function fetchRelativeValuation(ticker: string): Promise<RelativeValuationResponse> {
  const { data } = await api.get<RelativeValuationResponse>(`/valuation/${ticker}/relative`);
  return data;
}

export async function fetchFundamentalScores(ticker: string): Promise<FundamentalScoresResponse> {
  const { data } = await api.get<FundamentalScoresResponse>(`/stocks/${ticker}/scores`);
  return data;
}

export async function fetchSecurityHubOwnership(ticker: string, limit = 25): Promise<SecurityHubOwnershipResponse> {
  const { data } = await api.get<SecurityHubOwnershipResponse>(`/stocks/${encodeURIComponent(ticker)}/ownership`, {
    params: { limit },
  });
  return data;
}

export async function fetchSecurityHubEstimates(ticker: string, limit = 24): Promise<SecurityHubEstimatesResponse> {
  const { data } = await api.get<SecurityHubEstimatesResponse>(`/stocks/${encodeURIComponent(ticker)}/estimates`, {
    params: { limit },
  });
  return data;
}

export async function fetchSecurityHubEsg(ticker: string, limit = 10): Promise<SecurityHubEsgResponse> {
  const { data } = await api.get<SecurityHubEsgResponse>(`/stocks/${encodeURIComponent(ticker)}/esg`, {
    params: { limit },
  });
  return data;
}

export async function fetchPitFundamentals(
  symbol: string,
  opts?: { as_of?: string; data_version_id?: string },
): Promise<PitFundamentalsResponse> {
  const { data } = await api.get<PitFundamentalsResponse>(`/fundamentals/${encodeURIComponent(symbol)}`, { params: opts });
  return data;
}

export async function fetchUniverseMembers(
  universeId: string,
  opts?: { as_of?: string; data_version_id?: string },
): Promise<UniverseMembersResponse> {
  const { data } = await api.get<UniverseMembersResponse>(`/universe/${encodeURIComponent(universeId)}`, { params: opts });
  return data;
}

export async function fetchFinancials(
  ticker: string,
  period: "annual" | "quarterly",
  market: string = DEFAULT_EQUITY_MARKET,
): Promise<FinancialsResponse> {
  return getFinancials(ticker, market, period);
}

export async function fetchShareholding(ticker: string): Promise<{ history?: Array<Record<string, unknown>>; warning?: string }> {
  const { data } = await api.get<{ history?: Array<Record<string, unknown>>; warning?: string }>(`/stocks/${ticker}/shareholding`);
  return data;
}

export async function fetchCorporateActions(ticker: string): Promise<Record<string, unknown>> {
  const { data } = await api.get<Record<string, unknown>>(`/stocks/${ticker}/corporate-actions`);
  return data;
}

export async function fetchAnalystConsensus(ticker: string): Promise<Record<string, unknown>> {
  const { data } = await api.get<Record<string, unknown>>(`/stocks/${ticker}/analyst-consensus`);
  return data;
}

export async function fetchStockReturns(ticker: string): Promise<{ "1m"?: number | null; "3m"?: number | null; "1y"?: number | null }> {
  const { data } = await api.get<{ "1m"?: number | null; "3m"?: number | null; "1y"?: number | null }>(`/stocks/${ticker}/returns`);
  return data ?? {};
}

export async function fetchEquityPerformance(symbol: string): Promise<EquityPerformanceSnapshot> {
  const { data } = await api.get<EquityPerformanceSnapshot>(`/v1/equity/company/${encodeURIComponent(symbol)}/performance`);
  return data;
}

export async function fetchPromoterHoldings(symbol: string): Promise<PromoterHoldingsResponse> {
  const { data } = await api.get<PromoterHoldingsResponse>(`/v1/equity/company/${encodeURIComponent(symbol)}/promoter-holdings`);
  return data;
}

export async function fetchShareholdingPattern(symbol: string): Promise<ShareholdingPatternResponse> {
  const { data } = await api.get<ShareholdingPatternResponse>(`/shareholding/${encodeURIComponent(symbol)}`);
  return data;
}

export async function fetchDeliverySeries(symbol: string, interval = "1d", range = "1y"): Promise<DeliverySeriesResponse> {
  const { data } = await api.get<DeliverySeriesResponse>(`/v1/equity/company/${encodeURIComponent(symbol)}/delivery-series`, {
    params: { interval, range },
  });
  return data;
}

export async function fetchCapexTracker(symbol: string): Promise<CapexTrackerResponse> {
  const { data } = await api.get<CapexTrackerResponse>(`/v1/equity/company/${encodeURIComponent(symbol)}/capex-tracker`);
  return data;
}

export async function fetchTopBarTickers(): Promise<TopBarTickersResponse> {
  const { data } = await api.get<TopBarTickersResponse>("/v1/equity/overview/top-tickers");
  return data;
}
