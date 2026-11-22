import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { fetchCryptoNews, fetchLatestNews, fetchMarketSentiment, fetchNewsByTicker, fetchNewsSentiment, fetchNewsSentimentSummary, fetchNewsSummaries, fetchStockEmotion, scoreNewsArticles, searchLatestNews, type ArticleSentiment, type NewsLatestApiItem } from "../api/client";
import { EmotionIndicator } from "../components/terminal/EmotionIndicator";
import { NewsArticleRow } from "../components/market/NewsArticleRow";
import { SentimentTrend } from "../components/market/SentimentTrend";
import { newsSentimentEngineLabel, newsSentimentScoreKey } from "../components/market/newsAiSentiment";
import { NotesPanel } from "../components/notes/NotesPanel";
import { useStock } from "../hooks/useStocks";
import { useStockStore } from "../store/stockStore";
import { terminalColors } from "../theme/terminal";

type SentimentLabel = "Bullish" | "Bearish" | "Neutral";
type PeriodOption = 1 | 3 | 7 | 14 | 30;
type SourceMode = "by_ticker" | "search" | "latest" | "crypto" | "failed";
type NewsScope = "market" | "ticker" | "search";
type MarketSlice = "all" | "us" | "europe" | "india" | "crypto" | "indices";
type SentimentFilter = "all" | SentimentLabel;

type UiNewsItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  summary: string;
  publishedAt: string;
  sentiment: {
    score: number;
    label: SentimentLabel;
    confidence: number;
  };
};

type NewsQueryResult = {
  items: NewsLatestApiItem[];
  sourceMode: SourceMode;
  searchTerm?: string;
  errors: string[];
};

const PERIOD_OPTIONS: PeriodOption[] = [1, 3, 7, 14, 30];
const PAGE_SIZE = 20;

// Browse-by-market slices. Each drives the free sources with a market-flavored
// query (or the keyless crypto firehose), so "give me a general idea of X" needs
// no ticker. Labels are what the chips show; the query is what actually searches.
const MARKET_SLICES: Array<{ key: MarketSlice; label: string }> = [
  { key: "all", label: "All" },
  { key: "us", label: "US" },
  { key: "europe", label: "Europe" },
  { key: "india", label: "India" },
  { key: "crypto", label: "Crypto" },
  { key: "indices", label: "Indices" },
];

const MARKET_SLICE_QUERY: Record<Exclude<MarketSlice, "all" | "crypto">, string> = {
  us: "US stock market earnings Wall Street",
  europe: "European stocks Euronext DAX CAC 40 FTSE STOXX",
  india: "India stock market Sensex Nifty NSE",
  indices: "stock market index S&P 500 Nasdaq Dow Jones",
};

function clampScore(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function labelFromScore(score: number): SentimentLabel {
  if (score > 0.1) return "Bullish";
  if (score < -0.1) return "Bearish";
  return "Neutral";
}

function normalizeSentiment(item: NewsLatestApiItem): UiNewsItem["sentiment"] {
  const rawScore = Number(item.sentiment?.score ?? 0);
  const score = Number.isFinite(rawScore) ? clampScore(rawScore) : 0;
  const rawLabel = String(item.sentiment?.label ?? "").trim();
  const label = (rawLabel === "Bullish" || rawLabel === "Bearish" || rawLabel === "Neutral" ? rawLabel : labelFromScore(score)) as SentimentLabel;
  const confidence = Number(item.sentiment?.confidence ?? 0);
  return { score, label, confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0 };
}

function normalizeNewsItem(item: NewsLatestApiItem): UiNewsItem | null {
  const title = String(item.title || "").trim();
  const url = String(item.url || "").trim();
  if (!title || !url) return null;
  return {
    id: String(item.id),
    title,
    source: String(item.source || "Unknown"),
    url,
    summary: String(item.summary || ""),
    publishedAt: String(item.published_at || ""),
    sentiment: normalizeSentiment(item),
  };
}

function sentimentColor(label: SentimentLabel): string {
  if (label === "Bullish") return terminalColors.positive;
  if (label === "Bearish") return terminalColors.negative;
  return terminalColors.muted;
}

function toUpperWords(value: string): string[] {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
}

function relevanceScore(item: UiNewsItem, ticker: string, aliases: string[]): number {
  const text = `${item.title} ${item.summary}`.toUpperCase();
  const tickerToken = ticker.toUpperCase();
  let score = 0;
  if (tickerToken && new RegExp(`\\b${tickerToken}\\b`).test(text)) score += 6;
  for (const alias of aliases) {
    if (alias && new RegExp(`\\b${alias}\\b`).test(text)) score += 3;
  }
  return score;
}

function relevanceReason(item: UiNewsItem, ticker: string, aliases: string[]): string {
  const text = `${item.title} ${item.summary}`.toUpperCase();
  const tickerToken = ticker.toUpperCase();
  if (tickerToken && new RegExp(`\\b${tickerToken}\\b`).test(text)) return "Ticker match";
  for (const alias of aliases) {
    if (alias && new RegExp(`\\b${alias}\\b`).test(text)) return "Company match";
  }
  return "Market fallback";
}

async function loadTickerContextNews(ticker: string, companyName: string, market?: string, limit = 200): Promise<NewsQueryResult> {
  const symbol = ticker.trim().toUpperCase();
  const marketCode = String(market || "").trim().toUpperCase();
  const errors: string[] = [];
  if (!symbol) {
    try {
      const latest = await fetchLatestNews(limit);
      return { items: latest, sourceMode: "latest", errors };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "latest failed");
      return { items: [], sourceMode: "failed", errors };
    }
  }

  try {
    const byTicker = await fetchNewsByTicker(symbol, limit, marketCode || undefined);
    if (Array.isArray(byTicker) && byTicker.length > 0) {
      return { items: byTicker, sourceMode: "by_ticker", errors };
    }
  } catch (e) {
    errors.push(`by_ticker: ${e instanceof Error ? e.message : "failed"}`);
  }

  const searchTerms = Array.from(
    new Set([companyName, `${symbol} stock`, symbol].map((v) => v.trim()).filter((v) => v.length >= 2)),
  );
  if (marketCode === "NSE" || marketCode === "BSE") {
    searchTerms.unshift(
      `${symbol} ${marketCode} India stock`,
      `${companyName} ${marketCode}`.trim(),
    );
  }

  for (const term of searchTerms) {
    try {
      const searched = await searchLatestNews(term, limit);
      if (Array.isArray(searched) && searched.length > 0) {
        return { items: searched, sourceMode: "search", searchTerm: term, errors };
      }
    } catch (e) {
      errors.push(`search(${term}): ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  try {
    const latest = await fetchLatestNews(limit);
    return { items: latest, sourceMode: "latest", errors };
  } catch (e) {
    errors.push(`latest: ${e instanceof Error ? e.message : "failed"}`);
    return { items: [], sourceMode: "failed", errors };
  }
}

async function loadMarketNews(slice: MarketSlice, limit = 200): Promise<NewsQueryResult> {
  const errors: string[] = [];
  try {
    if (slice === "crypto") {
      const items = await fetchCryptoNews(Math.min(limit, 120));
      return { items, sourceMode: "crypto", errors };
    }
    if (slice === "all") {
      const items = await fetchLatestNews(limit);
      return { items, sourceMode: "latest", errors };
    }
    const term = MARKET_SLICE_QUERY[slice];
    const items = await searchLatestNews(term, limit);
    return { items, sourceMode: "search", searchTerm: term, errors };
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "market feed failed");
    return { items: [], sourceMode: "failed", errors };
  }
}

export function NewsPage() {
  const fieldId = useId();
  const currentTicker = useStockStore((s) => s.ticker);
  const { data: selectedStock } = useStock(currentTicker);
  // Land on the market overview — news without a ticker gives the general read;
  // the Ticker tab (below) is one click away when you want a symbol's context.
  const [scope, setScope] = useState<NewsScope>("market");
  const [marketSlice, setMarketSlice] = useState<MarketSlice>("all");
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [periodDays, setPeriodDays] = useState<PeriodOption>(7);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [nowMs, setNowMs] = useState(Date.now());
  const [sortMode, setSortMode] = useState<"time" | "sentiment">("time");
  const [keywordInput, setKeywordInput] = useState(localStorage.getItem("news:keyword-alerts") || "");
  const [keywordHits, setKeywordHits] = useState<Array<{ keyword: string; title: string; source: string; publishedAt: string }>>([]);
  const [lastRefreshMs, setLastRefreshMs] = useState<number | null>(null);
  const [aiScores, setAiScores] = useState<Record<string, ArticleSentiment>>({});

  const isTickerScope = scope === "ticker";
  const relevanceAliases = useMemo(
    () => Array.from(new Set(toUpperWords(String(selectedStock?.company_name || "")).slice(0, 6))),
    [selectedStock?.company_name],
  );

  const tickerDisplay = (selectedStock?.company_name || currentTicker || "").trim();
  const scopeLabel = isTickerScope
    ? `Ticker: ${tickerDisplay || currentTicker}`
    : scope === "search"
    ? `Search: ${debouncedSearch || "—"}`
    : `Market: ${MARKET_SLICES.find((s) => s.key === marketSlice)?.label ?? "All"}`;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const newsQuery = useQuery<NewsQueryResult>({
    queryKey: ["news-page", scope, marketSlice, currentTicker, selectedStock?.company_name || "", debouncedSearch],
    queryFn: async () => {
      if (scope === "ticker") {
        return loadTickerContextNews(
          currentTicker,
          String(selectedStock?.company_name || ""),
          String(selectedStock?.exchange || ""),
          200,
        );
      }
      if (scope === "search") {
        const items = debouncedSearch ? await searchLatestNews(debouncedSearch, 200) : await fetchLatestNews(200);
        return { items, sourceMode: debouncedSearch ? "search" : "latest", searchTerm: debouncedSearch || undefined, errors: [] };
      }
      return loadMarketNews(marketSlice, 200);
    },
    retry: 2,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (newsQuery.dataUpdatedAt > 0) {
      setLastRefreshMs(newsQuery.dataUpdatedAt);
    }
  }, [newsQuery.dataUpdatedAt]);

  useEffect(() => {
    localStorage.setItem("news:keyword-alerts", keywordInput);
  }, [keywordInput]);

  const sentimentQuery = useQuery({
    queryKey: ["news-sentiment", currentTicker, periodDays],
    queryFn: () => fetchNewsSentiment(currentTicker, periodDays, String(selectedStock?.exchange || "")),
    enabled: isTickerScope && Boolean(currentTicker),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const marketSentimentQuery = useQuery({
    queryKey: ["news-sentiment-market", periodDays, String(selectedStock?.exchange || "")],
    queryFn: () => fetchMarketSentiment(periodDays, String(selectedStock?.exchange || "")),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const sentimentSummaryQuery = useQuery({
    queryKey: ["news-sentiment-summary", periodDays],
    queryFn: () => fetchNewsSentimentSummary(periodDays, 200),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const emotionQuery = useQuery({
    queryKey: ["stock-emotion", currentTicker, periodDays, String(selectedStock?.exchange || "")],
    queryFn: ({ signal }) => fetchStockEmotion(currentTicker, periodDays, String(selectedStock?.exchange || ""), { signal }),
    enabled: isTickerScope && Boolean(currentTicker),
    staleTime: 120_000,
    refetchInterval: 300_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const normalizedItems = useMemo(() => {
    const raw = newsQuery.data?.items ?? [];
    const mapped = raw.map(normalizeNewsItem).filter((v): v is UiNewsItem => Boolean(v));
    if (!isTickerScope) return mapped;

    const ticker = currentTicker.trim().toUpperCase();
    const aliases = relevanceAliases;
    const scored = mapped.map((item) => ({ item, score: relevanceScore(item, ticker, aliases) }));
    const relevant = scored.filter((x) => x.score >= 3).map((x) => x.item);

    if (relevant.length > 0) return relevant;
    // Backend ticker feed is already symbol-scoped; trust it as-is.
    if (newsQuery.data?.sourceMode === "by_ticker") return mapped;
    // Search/latest fallbacks are not ticker-specific — show nothing rather
    // than generic market news when a specific ticker is selected.
    return [];
  }, [currentTicker, isTickerScope, newsQuery.data?.items, newsQuery.data?.sourceMode, relevanceAliases]);

  useEffect(() => {
    const keywords = keywordInput
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (!keywords.length || !normalizedItems.length) {
      setKeywordHits([]);
      return;
    }
    const hits: Array<{ keyword: string; title: string; source: string; publishedAt: string }> = [];
    for (const item of normalizedItems.slice(0, 80)) {
      const text = `${item.title} ${item.summary}`.toLowerCase();
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          hits.push({ keyword, title: item.title, source: item.source, publishedAt: item.publishedAt });
          break;
        }
      }
      if (hits.length >= 8) break;
    }
    setKeywordHits(hits);
  }, [keywordInput, normalizedItems]);

  const cutoffMs = nowMs - periodDays * 24 * 60 * 60 * 1000;
  const periodItems = useMemo(
    () =>
      normalizedItems.filter((item) => {
        const ts = Date.parse(item.publishedAt);
        return Number.isFinite(ts) ? ts >= cutoffMs : true;
      }),
    [normalizedItems, cutoffMs],
  );

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [debouncedSearch, periodDays, periodItems.length, currentTicker, scope, marketSlice, sentimentFilter]);

  const fallbackSummary = useMemo(() => {
    const total = periodItems.length;
    if (!total) {
      return {
        average_score: 0,
        bullish_pct: 0,
        bearish_pct: 0,
        neutral_pct: 0,
        overall_label: "Neutral" as SentimentLabel,
        total_articles: 0,
        daily_sentiment: [] as Array<{ date: string; avg_score: number; count: number }>,
      };
    }

    let bullish = 0;
    let bearish = 0;
    let neutral = 0;
    let sum = 0;
    const dayMap = new Map<string, number[]>();
    for (const item of periodItems) {
      sum += item.sentiment.score;
      if (item.sentiment.label === "Bullish") bullish += 1;
      else if (item.sentiment.label === "Bearish") bearish += 1;
      else neutral += 1;
      const d = item.publishedAt.slice(0, 10);
      const arr = dayMap.get(d) ?? [];
      arr.push(item.sentiment.score);
      dayMap.set(d, arr);
    }
    const average = sum / total;
    const daily = Array.from(dayMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, values]) => ({ date, avg_score: values.reduce((acc, v) => acc + v, 0) / values.length, count: values.length }));
    return {
      average_score: Number(average.toFixed(4)),
      bullish_pct: Number(((bullish * 100) / total).toFixed(1)),
      bearish_pct: Number(((bearish * 100) / total).toFixed(1)),
      neutral_pct: Number(((neutral * 100) / total).toFixed(1)),
      overall_label: labelFromScore(average),
      total_articles: total,
      daily_sentiment: daily,
    };
  }, [periodItems]);

  const summary = isTickerScope && sentimentQuery.data
    ? sentimentQuery.data
    : {
        ticker: currentTicker,
        period_days: periodDays,
        ...fallbackSummary,
      };

  // In-feed sentiment counts drive the clickable filter — click a bucket to see
  // only those headlines and validate (or break) a thesis against the evidence.
  const sentimentCounts = useMemo(() => {
    const counts = { Bullish: 0, Bearish: 0, Neutral: 0 } as Record<SentimentLabel, number>;
    for (const item of periodItems) counts[item.sentiment.label] += 1;
    return counts;
  }, [periodItems]);

  const sortedItems = useMemo(() => {
    const next = [...periodItems];
    if (sortMode === "sentiment") {
      next.sort((a, b) => b.sentiment.score - a.sentiment.score);
      return next;
    }
    next.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    return next;
  }, [periodItems, sortMode]);

  const filteredItems = useMemo(
    () => (sentimentFilter === "all" ? sortedItems : sortedItems.filter((i) => i.sentiment.label === sentimentFilter)),
    [sortedItems, sentimentFilter],
  );
  const visibleItems = filteredItems.slice(0, visibleCount);

  // Lazy summary enrichment: the keyless Yahoo feed returns headline-only rows, so
  // for the handful currently on screen that lack a summary we fetch the article's
  // own publisher blurb (og/meta description). Scoped to visible rows so cost
  // tracks what's actually read, and keyed on the URL set so it refetches only
  // when new summary-less rows appear (scroll / filter / sort change).
  const summarylessUrls = useMemo(
    () => visibleItems.filter((i) => !i.summary.trim() && i.url).map((i) => i.url),
    [visibleItems],
  );
  const summaryKey = useMemo(() => [...summarylessUrls].sort().join("|"), [summarylessUrls]);
  const summariesQuery = useQuery<Record<string, string>>({
    queryKey: ["news-summaries", summaryKey],
    queryFn: () => fetchNewsSummaries(summarylessUrls),
    enabled: summarylessUrls.length > 0,
    staleTime: 60 * 60 * 1000,
  });
  const summaryByUrl = summariesQuery.data ?? {};

  const unscoredVisibleItems = visibleItems.filter((item) => !aiScores[newsSentimentScoreKey(item)]);
  const aiBatchItems = (unscoredVisibleItems.length > 0 ? unscoredVisibleItems : visibleItems.slice(-PAGE_SIZE)).slice(0, PAGE_SIZE);
  const aiContextKey = [scope, marketSlice, currentTicker, debouncedSearch, periodDays, sentimentFilter, sortMode, visibleCount].join("|");
  const aiSentimentMutation = useMutation({
    mutationFn: ({ items }: { items: UiNewsItem[]; contextKey: string }) =>
      scoreNewsArticles(
        items.map((item) => ({
          id: item.id,
          title: item.title,
          summary: item.summary || summaryByUrl[item.url] || undefined,
        })),
      ),
    onSuccess: (batch, request) => {
      if (request.contextKey !== aiContextKey) return;
      const byId = new Map(batch.items.map((item) => [item.id, item]));
      setAiScores((current) => {
        const next = { ...current };
        for (const item of request.items) {
          const result = byId.get(item.id);
          if (result) next[newsSentimentScoreKey(item)] = result;
        }
        return next;
      });
    },
  });

  useEffect(() => {
    aiSentimentMutation.reset();
    // Reset only the status for the old view. Content-keyed verdicts remain
    // reusable if the same article is still present after filtering/sorting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiContextKey]);

  const aiResultIsCurrent = aiSentimentMutation.variables?.contextKey === aiContextKey;

  function goToSector(sector: string) {
    const term = `${sector} sector stocks`;
    setScope("search");
    setSearchInput(term);
    setDebouncedSearch(term);
    setSentimentFilter("all");
  }

  function selectMarketSlice(slice: MarketSlice) {
    setScope("market");
    setMarketSlice(slice);
    setSentimentFilter("all");
  }

  function toggleSentimentFilter(label: SentimentLabel) {
    setSentimentFilter((prev) => (prev === label ? "all" : label));
  }

  const scopeTabs: Array<{ key: NewsScope; label: string; show: boolean }> = [
    { key: "market", label: "Market", show: true },
    { key: "ticker", label: currentTicker ? `Ticker · ${currentTicker}` : "Ticker", show: Boolean(currentTicker) },
    { key: "search", label: "Search", show: true },
  ];

  const feedNames: Record<SourceMode, string> = { by_ticker: "Ticker headlines", search: "News search", latest: "Latest headlines", crypto: "Crypto headlines", failed: "Unavailable" };
  const feedFailed = newsQuery.isError || newsQuery.data?.sourceMode === "failed";
  const summaryArticleCount = isTickerScope && sentimentQuery.data
    ? sentimentQuery.data.total_articles ?? sentimentQuery.data.count
    : fallbackSummary.total_articles;
  const hasSummary = summaryArticleCount > 0;

  return (
    <main aria-label="News research" className="min-w-0 space-y-3 p-3 text-terminal-text sm:p-4 [&_button]:min-h-8 [&_button]:focus-visible:outline [&_select]:min-h-9 [&_input]:min-h-9 [overflow-wrap:anywhere]">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">News &amp; Sentiment</h1>
            <div className="text-xs text-terminal-muted">{scopeLabel}</div>
            <div className="text-xs text-terminal-muted">
              Feed: {newsQuery.data ? feedNames[newsQuery.data.sourceMode] : "Retrieving headlines"} {newsQuery.data?.searchTerm ? `(${newsQuery.data.searchTerm})` : ""} · {lastRefreshMs ? `Feed checked ${new Date(lastRefreshMs).toLocaleTimeString()}` : "Awaiting feed retrieval"}
            </div>
          </div>
        </div>

        {/* Scope tabs: Market (tickerless overview) · Ticker · Search */}
        <div role="group" aria-label="News scope" className="mt-3 flex flex-wrap gap-2">
          {scopeTabs.filter((t) => t.show).map((tab) => (
            <button
              key={tab.key}
              aria-pressed={scope === tab.key}
              className={`rounded border px-2 py-1 text-xs ${scope === tab.key
                ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                : "border-terminal-border text-terminal-muted hover:border-terminal-accent"
                }`}
              onClick={() => {
                setScope(tab.key);
                setSentimentFilter("all");
                if (tab.key !== "search") {
                  setSearchInput("");
                  setDebouncedSearch("");
                }
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-1">
          <label htmlFor={`${fieldId}-search`} className="block text-xs text-terminal-muted">Search all news</label>
          <input id={`${fieldId}-search`}
            className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-sm outline-none focus:border-terminal-accent"
            placeholder="Search news across all markets..."
            value={searchInput}
            onChange={(e) => {
              setScope("search");
              setSearchInput(e.target.value);
            }}
          />
        </div>
        <details className="mt-3 rounded border border-terminal-border px-2 py-1">
          <summary className="cursor-pointer text-xs text-terminal-muted focus-visible:outline">Feed filters · {periodDays}d · {sortMode === "time" ? "Newest first" : "Sentiment order"}</summary>
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1 text-xs text-terminal-muted"><label htmlFor={`${fieldId}-sort`} className="block">Sort headlines</label><select id={`${fieldId}-sort`}
                className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as "time" | "sentiment")}
              >
                <option value="time">Sort: Time</option>
                <option value="sentiment">Sort: Sentiment</option>
              </select></div>
              <div className="space-y-1 text-xs text-terminal-muted"><label htmlFor={`${fieldId}-period`} className="block">Time window</label><select id={`${fieldId}-period`}
                className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
                value={String(periodDays)}
                onChange={(e) => setPeriodDays(Number(e.target.value) as PeriodOption)}
              >
                {PERIOD_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}d
                  </option>
                ))}
              </select></div>
            </div>
            {/* Market-slice chips: browse by market without a ticker */}
            {scope === "market" && (
              <div role="group" aria-label="Browse markets" className="mt-2 flex flex-wrap gap-2">
                {MARKET_SLICES.map((slice) => (
                  <button
                    key={slice.key}
                    aria-pressed={marketSlice === slice.key}
                    className={`rounded border px-2 py-0.5 text-xs ${marketSlice === slice.key
                      ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                      : "border-terminal-border text-terminal-muted hover:border-terminal-accent"
                      }`}
                    onClick={() => selectMarketSlice(slice.key)}
                  >
                    {slice.label}
                  </button>
                ))}
              </div>
            )}

          </div>
        </details>
      </div>

      <nav aria-label="News sections" className="flex flex-wrap gap-4 text-xs text-terminal-accent">
        <a href="#news-headlines" className="underline focus-visible:outline">Headlines</a>
        <a href="#news-context" className="underline focus-visible:outline">Sentiment and research context</a>
      </nav>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section id="news-headlines" tabIndex={-1} aria-labelledby="news-headlines-title" className="min-w-0 scroll-mt-3 space-y-3">
          <h2 id="news-headlines-title" className="text-sm font-semibold text-terminal-accent">Headlines</h2>
          <div role="group" aria-label="Filter headline sentiment" className="space-y-2">
            <p className="text-xs text-terminal-muted">Original feed labels</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {(["Bullish", "Neutral", "Bearish"] as SentimentLabel[]).map((label) => {
                const active = sentimentFilter === label;
                return (
                  <button
                    key={label}
                    aria-pressed={active}
                    onClick={() => toggleSentimentFilter(label)}
                    className={`flex-1 rounded border px-1.5 py-0.5 ${active ? "border-terminal-accent text-terminal-accent" : "border-transparent text-terminal-muted hover:border-terminal-border"
                      }`}
                    title={`Show only ${label} headlines (${sentimentCounts[label]})`}
                  >
                    <span style={{ color: active ? undefined : sentimentColor(label) }}>{label}</span> · {sentimentCounts[label]}
                  </button>
                );
              })}
            </div>
            {sentimentFilter !== "all" && (
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded border border-terminal-accent/40 bg-terminal-accent/5 px-2 py-1 text-xs text-terminal-accent">
                <span>Filtered to {sentimentFilter} headlines ({sentimentCounts[sentimentFilter as SentimentLabel]})</span>
                <button className="underline" onClick={() => setSentimentFilter("all")}>
                  Clear
                </button>
              </div>
            )}

          </div>
          {newsQuery.isLoading && (
            <div role="status" className="space-y-2"><p className="text-sm text-terminal-muted">Loading headlines…</p>
              {Array.from({ length: 3 }).map((_, idx) => (
                <div key={idx} className="h-20 animate-pulse rounded border border-terminal-border bg-terminal-panel" />
              ))}
            </div>
          )}
          {feedFailed && (
            <div role="alert" className="space-y-2 rounded border border-terminal-neg bg-terminal-neg/10 p-3 text-sm text-terminal-neg"><p>News feed unavailable.{visibleItems.length ? " Previously retrieved headlines remain below." : ""}</p><button className="rounded border border-terminal-neg px-2 py-1" onClick={() => void newsQuery.refetch()} disabled={newsQuery.isFetching}>Retry headlines</button></div>
          )}
          {isTickerScope && sentimentQuery.isError && (
            <div role="alert" className="rounded border border-terminal-warn bg-terminal-warn/10 p-2 text-xs text-terminal-warn">
              Ticker sentiment unavailable. Showing retrieved headline data.
            </div>
          )}

          {!newsQuery.isLoading && visibleItems.length > 0 && (
            <section className="rounded border border-terminal-border bg-terminal-panel px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-terminal-muted">Score visible headlines on demand.</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {aiSentimentMutation.data && aiResultIsCurrent && (
                    <span className="text-xs text-terminal-muted">
                      {newsSentimentEngineLabel(aiSentimentMutation.data)} · {aiSentimentMutation.data.items.length}/{aiSentimentMutation.variables?.items.length ?? 0}
                    </span>
                  )}
                  {aiSentimentMutation.isError && aiResultIsCurrent && (
                    <span role="alert" className="text-xs text-terminal-neg">Scoring failed — retry</span>
                  )}
                  <button
                    type="button"
                    className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-text hover:border-terminal-accent disabled:opacity-50"
                    onClick={() => aiSentimentMutation.mutate({ items: aiBatchItems, contextKey: aiContextKey })}
                    disabled={aiSentimentMutation.isPending || aiBatchItems.length === 0}
                  >
                    {aiSentimentMutation.isPending
                      ? "Scoring…"
                      : unscoredVisibleItems.length > 0
                        ? `AI sentiment · ${Math.min(unscoredVisibleItems.length, PAGE_SIZE)}`
                        : `Rescore latest ${aiBatchItems.length}`}
                  </button>
                </div>
              </div>
            </section>
          )}

          <div className="grid min-w-0 gap-3">
            {visibleItems.map((item) => {
              const aiSentiment = aiScores[newsSentimentScoreKey(item)];
              return (
                <NewsArticleRow
                  key={item.id}
                  item={{ ...item, summary: item.summary || summaryByUrl[item.url] || "" }}
                  nowMs={nowMs}
                  sentiment={
                    aiSentiment
                      ? { label: aiSentiment.label, score: aiSentiment.score, confidence: aiSentiment.confidence }
                      : { label: item.sentiment.label, score: item.sentiment.score, confidence: item.sentiment.confidence }
                  }
                  rationale={aiSentiment?.rationale}
                  assessmentLabel={aiSentiment ? (aiSentiment.engine === "llm" ? "AI assessment" : "Lexical fallback") : "Original feed label"}
                  meta={
                    isTickerScope ? (
                      <span className="rounded border border-terminal-border px-1.5 py-0.5 text-xs text-terminal-muted">
                        {relevanceReason(item, currentTicker, relevanceAliases)}
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
            {!newsQuery.isLoading && !feedFailed && visibleItems.length === 0 && (
              <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs text-terminal-muted">
                {sentimentFilter !== "all"
                  ? `No ${sentimentFilter} headlines in this feed.`
                  : isTickerScope
                    ? `No relevant news found for ${currentTicker}.`
                    : "No news found for this view."}
              </div>
            )}
          </div>

          {visibleCount < filteredItems.length && (
            <div className="pt-1">
              <button className="rounded border border-terminal-border px-3 py-1 text-xs" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                Load more
              </button>
            </div>
          )}
        </section>
        <aside id="news-context" tabIndex={-1} aria-label="News context" className="min-w-0 scroll-mt-3 space-y-3">
          <section aria-labelledby="news-context-title" className="min-w-0 space-y-3 rounded border border-terminal-border bg-terminal-panel p-3">
            <h2 id="news-context-title" className="text-sm font-semibold text-terminal-accent">Sentiment context</h2>
            <p className="text-xs text-terminal-muted">{isTickerScope && sentimentQuery.data ? `Ticker aggregate · ${currentTicker}` : `${scopeLabel} · original feed labels`}. Separate from on-demand AI headline assessments.</p>
            {hasSummary ? <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded px-2 py-0.5 text-xs font-semibold text-black" style={{ backgroundColor: sentimentColor(summary.overall_label as SentimentLabel) }}>
                    {summary.overall_label}
                  </span>
                  <span className="text-sm font-semibold">
                    {summary.average_score >= 0 ? "+" : ""}
                    {Number(summary.average_score).toFixed(2)}
                  </span>
                </div>
                <div className="text-xs text-terminal-muted">
                  {summaryArticleCount} articles | {periodDays}d
                </div>
              </div>

              <div className="mt-2 h-2 w-full overflow-hidden rounded bg-terminal-bg">
                <div className="flex h-full w-full">
                  <div style={{ width: `${summary.bullish_pct}%`, background: terminalColors.positive }} />
                  <div style={{ width: `${summary.neutral_pct}%`, background: terminalColors.muted }} />
                  <div style={{ width: `${summary.bearish_pct}%`, background: terminalColors.negative }} />
                </div>
              </div>
              <dl className="mt-2 flex flex-wrap gap-3 text-xs text-terminal-muted">
                <div><dt>Bullish</dt><dd>{summary.bullish_pct}%</dd></div>
                <div><dt>Neutral</dt><dd>{summary.neutral_pct}%</dd></div>
                <div><dt>Bearish</dt><dd>{summary.bearish_pct}%</dd></div>
              </dl>
              <div className="mt-3 h-28 w-full">
                <SentimentTrend data={summary.daily_sentiment ?? []} />
              </div>
              {!!summary.daily_sentiment?.length && <details className="mt-2 text-xs text-terminal-muted"><summary className="cursor-pointer focus-visible:outline">Daily sentiment values</summary><dl className="mt-2 space-y-2">{summary.daily_sentiment.map(row => <div key={row.date} className="flex flex-wrap justify-between gap-2"><dt>{row.date}</dt><dd>{row.avg_score.toFixed(2)} · {row.count} articles</dd></div>)}</dl></details>}
            </div> : <p role="status" className="text-sm text-terminal-muted">{newsQuery.isLoading || (isTickerScope && sentimentQuery.isLoading) ? "Loading sentiment context…" : "No sentiment summary available for this feed."}</p>}
          </section>

          {marketSentimentQuery.data?.sectors?.length ? (
            <section aria-label="Market sector sentiment" className="rounded border border-terminal-border bg-terminal-panel p-3">
              <div className="mb-1 text-xs text-terminal-muted">Market sectors · separate from the selected headline feed</div>
              <div className="grid gap-2 text-xs">
                {marketSentimentQuery.data.sectors.slice(0, 8).map((row) => (
                  <button
                    key={row.sector}
                    onClick={() => goToSector(row.sector)}
                    className="rounded border border-terminal-border px-1.5 py-1 text-left hover:border-terminal-accent"
                    style={{
                      background:
                        row.avg_sentiment > 0
                          ? `rgba(34,197,94,${Math.min(0.55, Math.abs(row.avg_sentiment) + 0.1)})`
                          : row.avg_sentiment < 0
                            ? `rgba(244,63,94,${Math.min(0.55, Math.abs(row.avg_sentiment) + 0.1)})`
                            : "#0D1117",
                    }}
                  >
                    <div className="break-words text-terminal-muted">{row.sector}</div>
                    <div className="font-semibold">{row.avg_sentiment >= 0 ? "+" : ""}{row.avg_sentiment.toFixed(2)}</div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {marketSentimentQuery.isError ? <p role="alert" className="text-xs text-terminal-warn">Sector sentiment unavailable.</p> : null}
          <details className="rounded border border-terminal-border bg-terminal-panel p-3">
            <summary className="cursor-pointer text-sm font-semibold text-terminal-accent focus-visible:outline">Keyword matches{keywordHits.length ? ` · ${keywordHits.length}` : ""}</summary>
            <div className="mt-3 rounded border border-terminal-border bg-terminal-bg p-2">
              <label htmlFor={`${fieldId}-keywords`} className="mb-1 block text-xs text-terminal-muted">Keyword Alerts (comma separated)</label>
              <p className="mb-2 text-xs text-terminal-muted">Matches in this retrieved feed, stored in this browser.</p>
              <input id={`${fieldId}-keywords`}
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                placeholder="FDA approval, CEO resign, acquisition"
                className="w-full rounded border border-terminal-border bg-terminal-panel px-2 py-1 text-xs outline-none focus:border-terminal-accent"
              />
              {keywordHits.length ? (
                <div className="mt-2 space-y-1">
                  {keywordHits.map((hit, idx) => (
                    <div key={`${hit.keyword}-${idx}`} className="rounded border border-terminal-border bg-terminal-panel px-2 py-1 text-xs">
                      <span className="text-terminal-accent">{hit.keyword}</span> | {hit.title}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </details>
          <details className="rounded border border-terminal-border bg-terminal-panel p-3">
            <summary className="cursor-pointer text-sm font-semibold text-terminal-accent focus-visible:outline">Source coverage</summary>
            {sentimentSummaryQuery.data?.top_sources?.length ? (
              <div className="mt-3 rounded border border-terminal-border bg-terminal-bg p-2">
                <h3 className="mb-1 text-sm font-semibold">Top News Sources ({periodDays}d)</h3><p className="mb-2 text-xs text-terminal-muted">Market-wide source summary; independent of the selected feed.</p>
                <div className="grid grid-cols-1 gap-2">
                  {sentimentSummaryQuery.data.top_sources.slice(0, 6).map((row) => (
                    <div key={row.source} className="flex flex-wrap items-center justify-between gap-2 rounded border border-terminal-border px-2 py-1 text-xs">
                      <span className="min-w-0 break-words">{row.source}</span>
                      <span className="text-terminal-muted">{row.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {sentimentSummaryQuery.isError ? <p role="alert" className="mt-2 text-xs text-terminal-warn">News-source summary unavailable.</p> : !sentimentSummaryQuery.data?.top_sources?.length ? <p className="mt-2 text-xs text-terminal-muted">No source summary available.</p> : null}
          </details>
          {isTickerScope && currentTicker && (
            <EmotionIndicator
              ticker={currentTicker}
              data={emotionQuery.data}
              isLoading={emotionQuery.isLoading}
              isError={emotionQuery.isError}
            />
          )}

          {isTickerScope && currentTicker && (
            <details className="rounded border border-terminal-border bg-terminal-panel p-3">
              <summary className="mb-2 cursor-pointer text-sm font-semibold text-terminal-accent focus-visible:outline">Your notes on {currentTicker}</summary>
              <p className="mb-3 text-xs text-terminal-muted">Dated private research for the Second Brain, separate from headline assessments.</p>
              <NotesPanel symbol={currentTicker} context="news" />
            </details>
          )}

          <a href="#news-headlines" className="inline-block text-xs text-terminal-accent underline focus-visible:outline">Back to headlines</a>
        </aside>
      </div>
    </main>
  );
}
