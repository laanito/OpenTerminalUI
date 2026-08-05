import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { fetchNewsByTicker } from "../../api/news";
import { scoreNewsArticles, type ArticleSentiment } from "../../api/sentiment";
import { NewsArticleRow } from "./NewsArticleRow";
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
      scoreNewsArticles(items.map((i) => ({ id: i.id, title: i.title, summary: i.summary }))),
    onSuccess: (batch) => {
      const next: Record<string, ArticleSentiment> = {};
      for (const it of batch.items) next[it.id] = it;
      setScores(next);
    },
  });

  const scored = scoreMutation.data;
  const aiEngineLive = scored?.engine === "llm" || scored?.engine === "mixed";

  return (
    <TerminalPanel
      title={title}
      subtitle={subtitle ?? `Latest headlines for ${ticker.toUpperCase()}`}
      actions={
        items.length > 0 ? (
          <div className="flex items-center gap-2">
            {scored && (
              <span className="text-[10px] text-terminal-muted">
                {aiEngineLive ? scored.model ?? "LLM" : "LLM offline — lexical"}
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
            const sentiment = scores[item.id];
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
