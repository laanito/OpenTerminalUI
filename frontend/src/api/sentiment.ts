import { api } from "./base";
import type {
  NewsSentimentSummary,
  MarketSentimentSummary,
  NewsSentimentMarketSummary,
  AiInsight,
  StockEmotion,
  InsightData,
} from "./types";

export async function fetchNewsSentiment(ticker: string, days = 7, market?: string): Promise<NewsSentimentSummary> {
  const { data } = await api.get<NewsSentimentSummary>(`/news/sentiment/${encodeURIComponent(ticker)}`, {
    params: { days, market },
  });
  return data;
}

export async function fetchMarketSentiment(days = 7, market?: string): Promise<MarketSentimentSummary> {
  const { data } = await api.get<MarketSentimentSummary>("/news/sentiment/market", {
    params: { days, market },
  });
  return data;
}

export async function fetchNewsSentimentSummary(days = 7, limit = 200, market?: string): Promise<NewsSentimentMarketSummary> {
  const { data } = await api.get<NewsSentimentMarketSummary>("/news/sentiment/summary", {
    params: { days, limit, market },
  });
  return data;
}

export async function fetchStockEmotion(
  ticker: string,
  days = 7,
  market?: string,
): Promise<StockEmotion> {
  const { data } = await api.get<StockEmotion>(`/sentiment/emotion/${encodeURIComponent(ticker)}`, {
    params: { days, market },
  });
  return data;
}

export async function fetchStockBriefing(ticker: string, market?: string): Promise<InsightData> {
  const { data } = await api.get<InsightData>(`/ai/briefing/${encodeURIComponent(ticker)}`, {
    params: { market },
  });
  return data;
}

// v1.2 "research interrogates": an adversarial read that pressure-tests the bull
// case (and your own recorded notes) rather than another bullish briefing. Authed
// endpoint — folds in the user's notes on this ticker; goes through the same
// authed `api` instance as the briefing.
export async function fetchStockInterrogation(ticker: string, market?: string): Promise<InsightData> {
  const { data } = await api.get<InsightData>(`/ai/interrogate/${encodeURIComponent(ticker)}`, {
    params: { market },
  });
  return data;
}

export async function fetchAiRiskInsights(metrics: Record<string, any>, scope = "portfolio"): Promise<InsightData> {
  const { data } = await api.post<InsightData>("/ai/risk-insights", { metrics, scope });
  return data;
}

export async function fetchCollectionBriefing(symbols: string[], scope = "collection"): Promise<InsightData> {
  const { data } = await api.post<InsightData>("/ai/collection-briefing", { symbols, scope });
  return data;
}
