import { api } from "./base";
import type {
  NewsApiItem,
  NewsLatestApiItem,
  QuarterlyReportApiItem,
} from "./types";

export async function fetchSymbolNews(market: string, symbol: string, limit = 30): Promise<NewsApiItem[]> {
  const { data } = await api.get<{ items: NewsApiItem[] }>("/news/symbol", { params: { market, symbol, limit } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchMarketNews(market: string, limit = 30): Promise<NewsApiItem[]> {
  const { data } = await api.get<{ items: NewsApiItem[] }>("/news/market", { params: { market, limit } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchLatestNews(limit = 100): Promise<NewsLatestApiItem[]> {
  const { data } = await api.get<{ items: NewsLatestApiItem[] }>("/news/latest", { params: { limit } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function searchLatestNews(q: string, limit = 100): Promise<NewsLatestApiItem[]> {
  const { data } = await api.get<{ items: NewsLatestApiItem[] }>("/news/search", { params: { q, limit } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchNewsByTicker(ticker: string, limit = 100, market?: string): Promise<NewsLatestApiItem[]> {
  const { data } = await api.get<{ items: NewsLatestApiItem[] }>(`/news/by-ticker/${encodeURIComponent(ticker)}`, {
    params: { limit, market },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

/**
 * Keyless crypto-native news firehose (CoinDesk/Cointelegraph/Decrypt). Omit
 * `symbol` for the browsable market-wide feed, or pass a coin (e.g. BTC-USD) to
 * narrow the firehose to that coin.
 */
export async function fetchCryptoNews(limit = 60, symbol?: string): Promise<NewsLatestApiItem[]> {
  const { data } = await api.get<{ items: NewsLatestApiItem[] }>("/news/crypto", { params: { limit, symbol } });
  return Array.isArray(data?.items) ? data.items : [];
}

/**
 * Batch-fetch publisher summaries (Open Graph / meta description) for article URLs
 * that arrived without one — the keyless Yahoo search path returns headline-only
 * rows. Real publisher text, not generated; returns a url -> summary map (only
 * URLs that yielded a summary are present).
 */
export async function fetchNewsSummaries(urls: string[]): Promise<Record<string, string>> {
  const list = Array.from(new Set(urls.filter((u) => typeof u === "string" && u.trim()))).slice(0, 24);
  if (list.length === 0) return {};
  const { data } = await api.post<{ summaries: Record<string, string> }>("/news/summaries", { urls: list });
  return data && typeof data.summaries === "object" && data.summaries ? data.summaries : {};
}

export async function fetchQuarterlyReports(market: string, symbol: string, limit = 8): Promise<QuarterlyReportApiItem[]> {
  const { data } = await api.get<{ items: QuarterlyReportApiItem[] }>("/reports/quarterly", { params: { market, symbol, limit } });
  return Array.isArray(data?.items) ? data.items : [];
}
