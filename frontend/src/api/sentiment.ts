import { api } from "./base";
import type {
  NewsSentimentSummary,
  MarketSentimentSummary,
  NewsSentimentMarketSummary,
  AiInsight,
  StockEmotion,
  InsightData,
} from "./types";

// LLM generation regularly runs far past the api client's default 30s timeout —
// a local/cloud model producing a sectioned briefing can take a minute or more,
// and reasoning models longer still. Without a roomier per-call timeout the
// browser aborts mid-generation and the card shows "unavailable" for anything but
// the fastest model. Same treatment brain.ts already gives its LLM calls.
const AI_TIMEOUT = { timeout: 180_000 } as const;

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
    ...AI_TIMEOUT,
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
    ...AI_TIMEOUT,
  });
  return data;
}

export type ArticleSentiment = {
  id: string;
  label: string;
  score: number;
  confidence: number;
  rationale?: string;
  engine: "llm" | "lexical";
};

export type NewsSentimentBatch = {
  engine: "llm" | "lexical" | "mixed" | "unavailable";
  model?: string;
  items: ArticleSentiment[];
};

// v1.2: score a page of headlines with the local LLM (trader's-eye bull/bear read),
// batched into one call and cached per headline server-side. Degrades per-item to
// the lexical scorer when the model is off — each item is tagged with its engine.
export async function scoreNewsArticles(
  items: { id: string; title: string; summary?: string }[],
): Promise<NewsSentimentBatch> {
  const { data } = await api.post<NewsSentimentBatch>("/ai/news-sentiment", { items }, AI_TIMEOUT);
  return data;
}

export async function fetchAiRiskInsights(metrics: Record<string, any>, scope = "portfolio"): Promise<InsightData> {
  const { data } = await api.post<InsightData>("/ai/risk-insights", { metrics, scope }, AI_TIMEOUT);
  return data;
}

export async function fetchCollectionBriefing(symbols: string[], scope = "collection"): Promise<InsightData> {
  const { data } = await api.post<InsightData>("/ai/collection-briefing", { symbols, scope }, AI_TIMEOUT);
  return data;
}
