import type { ReactNode } from "react";

import { SentimentBadge } from "../terminal/SentimentBadge";

export type NewsRowSentiment = {
  label: string;
  score: number;
  confidence: number;
};

export type NewsRowItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  summary?: string;
  publishedAt: string;
};

type Props = {
  item: NewsRowItem;
  sentiment?: NewsRowSentiment;
  /** One-line trader rationale (from AI sentiment); shown in place of the summary. */
  rationale?: string;
  /** Optional right-aligned chip in the header (e.g. a relevance reason). */
  meta?: ReactNode;
  /** Reference time for the relative timestamp; defaults to now. */
  nowMs?: number;
};

function relativeTime(iso: string, nowMs: number): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "recently";
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

/**
 * One news headline, rendered consistently everywhere news appears — the News
 * hub list and the compact TickerNewsCard both use this so an article reads the
 * same on a detail page and in the hub. Source badge + relative time on the left,
 * an optional sentiment badge and meta chip on the right, then the linked title
 * and either the AI rationale or the summary.
 */
export function NewsArticleRow({ item, sentiment, rationale, meta, nowMs = Date.now() }: Props) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="grid gap-0.5 rounded-sm border border-terminal-border bg-terminal-bg px-2 py-2 hover:border-terminal-accent"
    >
      <div className="flex items-center gap-2 text-[11px] text-terminal-muted">
        <span className="truncate font-semibold text-terminal-text/80">{item.source || "NEWS"}</span>
        {item.publishedAt && <span>· {relativeTime(item.publishedAt, nowMs)}</span>}
        <span className="ml-auto flex items-center gap-2">
          {meta}
          {sentiment && (
            <SentimentBadge label={sentiment.label} score={sentiment.score} confidence={sentiment.confidence} />
          )}
        </span>
      </div>
      <div className="text-sm text-terminal-text">{item.title}</div>
      {rationale ? (
        <div className="text-[11px] italic text-terminal-muted">{rationale}</div>
      ) : (
        item.summary && <div className="line-clamp-2 text-[11px] text-terminal-muted">{item.summary}</div>
      )}
    </a>
  );
}
