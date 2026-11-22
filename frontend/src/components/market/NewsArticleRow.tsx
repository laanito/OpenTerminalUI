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
  assessmentLabel?: string;
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

/** Shared readable headline row for the News hub and ticker detail. */
export function NewsArticleRow({ item, sentiment, rationale, assessmentLabel, meta, nowMs = Date.now() }: Props) {
  const published = Date.parse(item.publishedAt);
  const publishedLabel = Number.isFinite(published) ? new Date(published).toLocaleString() : "Publication time unavailable";
  return (
    <article aria-label={item.title} className="grid min-w-0 gap-2 rounded-sm border border-terminal-border bg-terminal-bg p-3 [overflow-wrap:anywhere]">
      <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium leading-relaxed text-terminal-text hover:text-terminal-accent hover:underline focus-visible:outline focus-visible:outline-terminal-accent">
        {item.title}<span className="sr-only"> (opens in a new tab)</span>
      </a>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-terminal-muted">
        <span className="min-w-0 font-semibold text-terminal-text/80">{item.source || "NEWS"}</span>
        <span>{Number.isFinite(published) ? relativeTime(item.publishedAt, nowMs) : "Publication time unavailable"}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {meta}
          {sentiment && <SentimentBadge label={sentiment.label} score={sentiment.score} confidence={sentiment.confidence} />}
        </span>
      </div>
      {rationale ? <p className="text-sm leading-relaxed text-terminal-muted">{rationale}</p> : item.summary ? <p className="text-sm leading-relaxed text-terminal-muted">{item.summary}</p> : null}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-terminal-muted">
        <span>{assessmentLabel || (rationale ? "Headline assessment" : item.summary ? "Publisher summary" : "Headline only")}</span>
        {Number.isFinite(published) ? <time dateTime={item.publishedAt}>{publishedLabel}</time> : null}
      </div>
    </article>
  );
}
