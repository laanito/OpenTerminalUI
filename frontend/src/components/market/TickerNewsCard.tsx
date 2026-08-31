import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { fetchNewsByTicker } from "../../api/news";
import { scoreNewsArticles, type ArticleSentiment } from "../../api/sentiment";
import { NewsArticleRow } from "./NewsArticleRow";
import { newsSentimentEngineLabel, newsSentimentScoreKey } from "./newsAiSentiment";
import { TerminalPanel } from "../terminal/TerminalPanel";

type Props = {
  ticker: string;
  market?: string;
  limit?: number;
  title?: string;
  subtitle?: string;
};

/**
 * Compact ticker-scoped news feed backed by `/news/by-ticker`. Works for any
 * symbol — crypto and indices included — because the endpoint resolves
 * asset-aware search terms server-side (BTC-USD -> "Bitcoin crypto",
 * ^GSPC -> "S&P 500") rather than the equity "<sym> stock" query.
 *
 * Optional on-demand AI sentiment: one click scores every visible headline with
 * the local LLM (batched server-side), overlaying a trader's-eye bull/bear badge
 * and a one-line rationale. Falls back to the lexical scorer when the model is off.
 */
export function TickerNewsCard({ ticker, market, limit = 12, title = "News", subtitle }: Props) {
  const [scores, setScores] = useState<Record<string, ArticleSentiment>>({});

  const query = useQuery({
    queryKey: ["ticker-news", ticker, market, limit],
    queryFn: () => fetchNewsByTicker(ticker, limit, market),
    enabled: Boolean(ticker),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const items = query.data ?? [];

  const scoreMutation = useMutation({
    mutationFn: () =>
      scoreNewsArticles(items.slice(0, 20).map((i) => ({ id: i.id, title: i.title, summary: i.summary }))),
    onSuccess: (batch) => {
      const next: Record<string, ArticleSentiment> = {};
      const byId = new Map(batch.items.map((item) => [item.id, item]));
      for (const item of items.slice(0, 20)) {
        const result = byId.get(item.id);
        if (result) next[newsSentimentScoreKey(item)] = result;
      }
      setScores(next);
    },
  });

  useEffect(() => {
    setScores({});
    scoreMutation.reset();
    // The mutation object itself is not a stable dependency; reset is only
    // needed when this card is pointed at a different feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, market, limit]);

  const scored = scoreMutation.data;

  return (
    <TerminalPanel
      title={title}
      subtitle={subtitle ?? `Latest headlines for ${ticker.toUpperCase()}`}
      actions={
        items.length > 0 ? (
          <div className="flex items-center gap-2">
            {scored && (
              <span className="text-[10px] text-terminal-muted">
                {newsSentimentEngineLabel(scored)} · {scored.items.length}/{Math.min(items.length, 20)}
              </span>
            )}
            <button
              type="button"
              className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-text hover:border-terminal-accent disabled:opacity-50"
              onClick={() => scoreMutation.mutate()}
              disabled={scoreMutation.isPending}
            >
              {scoreMutation.isPending ? "Scoring…" : scored ? "Rescore" : "AI sentiment"}
            </button>
            {scoreMutation.isError && (
              <span className="text-[10px] text-terminal-neg">Scoring failed — retry</span>
            )}
          </div>
        ) : undefined
      }
    >
      {query.isLoading ? (
        <div className="py-6 text-center text-[11px] text-terminal-muted">Loading news…</div>
      ) : items.length === 0 ? (
        <div className="py-6 text-center text-[11px] text-terminal-muted">
          No recent news found for {ticker.toUpperCase()}.
        </div>
      ) : (
        <div className="grid gap-1">
          {items.map((item) => {
            const sentiment = scores[newsSentimentScoreKey(item)];
            return (
              <NewsArticleRow
                key={`${item.id}-${item.published_at}`}
                item={{
                  id: item.id,
                  title: item.title,
                  source: item.source,
                  url: item.url,
                  summary: item.summary,
                  publishedAt: item.published_at,
                }}
                sentiment={sentiment ? { label: sentiment.label, score: sentiment.score, confidence: sentiment.confidence } : undefined}
                rationale={sentiment?.rationale}
              />
            );
          })}
        </div>
      )}
    </TerminalPanel>
  );
}
