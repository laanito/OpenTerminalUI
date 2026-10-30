import { api } from "./base";
import type {
  NewsSentimentSummary,
  MarketSentimentSummary,
  NewsSentimentMarketSummary,
  AiInsight,
  StockEmotion,
  InsightData,
} from "./types";
import { streamInsight, streamModelOperation, validateFastResult, type InsightRequestOptions } from "./insightLifecycle";
import type { InsightModelProfile } from "./types";

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
  options: InsightRequestOptions = {},
): Promise<StockEmotion> {
  return streamModelOperation("/sentiment/emotion/stream", { ticker, days, market }, (value, profile) => {
    const result = validateFastResult<StockEmotion>(value, profile);
    if (result.ticker !== ticker.trim().toUpperCase() || !["llm", "fallback"].includes(result.engine ?? "")
      || !Number.isFinite(result.emotion_index)) throw new Error("Invalid emotion result. Retry manually.");
    return result;
  }, options);
}

export async function fetchStockBriefing(
  ticker: string,
  market?: string,
  refresh = false,
  options: InsightRequestOptions = {},
): Promise<InsightData> {
  return streamInsight("briefing", { ticker, market, refresh }, options);
}

// v1.2 "research interrogates": an adversarial read that pressure-tests the bull
// case (and your own recorded notes) rather than another bullish briefing. Authed
// endpoint — folds in the user's notes on this ticker; goes through the same
// authed `api` instance as the briefing.
export async function fetchStockInterrogation(
  ticker: string,
  market?: string,
  refresh = false,
  options: InsightRequestOptions = {},
): Promise<InsightData> {
  return streamInsight("interrogate", { ticker, market, refresh }, options);
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
  model_profile?: InsightModelProfile;
};

// v1.2: score a page of headlines with the local LLM (trader's-eye bull/bear read),
// batched into one call and cached per headline server-side. Degrades per-item to
// the lexical scorer when the model is off — each item is tagged with its engine.
export async function scoreNewsArticles(
  items: { id: string; title: string; summary?: string }[],
  options: InsightRequestOptions = {},
): Promise<NewsSentimentBatch> {
  return streamModelOperation("/ai/news-sentiment/stream", { items }, (value, profile) => {
    const result = validateFastResult<NewsSentimentBatch>(value, profile);
    if (!["llm", "lexical", "mixed", "unavailable"].includes(result.engine) || !Array.isArray(result.items)) throw new Error("Invalid sentiment batch. Retry manually.");
    return result;
  }, options);
}

export async function fetchAiRiskInsights(
  metrics: Record<string, any>,
  scope = "portfolio",
  options: InsightRequestOptions = {},
): Promise<InsightData> {
  const payload = { metrics, scope };
  return streamInsight(
    "risk",
    payload,
    options,
  );
}

export type CollectionBriefingFact = {
  symbol: string;
  label?: string;
  price?: number | null;
  change?: number | null;
  change_pct?: number | null;
};

export async function fetchCollectionBriefing(
  symbols: string[],
  scope = "collection",
  facts?: CollectionBriefingFact[],
  options: InsightRequestOptions = {},
): Promise<InsightData> {
  const payload = facts ? { symbols, scope, facts } : { symbols, scope };
  return streamInsight(
    "collection",
    payload,
    options,
  );
}
