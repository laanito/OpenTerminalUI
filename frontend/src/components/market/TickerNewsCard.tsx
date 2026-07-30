import { useQuery } from "@tanstack/react-query";

import { fetchNewsByTicker } from "../../api/news";
import { TerminalPanel } from "../terminal/TerminalPanel";

type Props = {
  ticker: string;
  market?: string;
  limit?: number;
  title?: string;
  subtitle?: string;
};

function formatWhen(value: string): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Compact ticker-scoped news feed backed by `/news/by-ticker`. Works for any
 * symbol — crypto included — because the endpoint resolves crypto-aware search
 * terms server-side (e.g. BTC-USD -> "Bitcoin crypto") rather than the equity
 * "<sym> stock" query that returns nothing for coins.
 */
export function TickerNewsCard({ ticker, market, limit = 12, title = "News", subtitle }: Props) {
  const query = useQuery({
    queryKey: ["ticker-news", ticker, market, limit],
    queryFn: () => fetchNewsByTicker(ticker, limit, market),
    enabled: Boolean(ticker),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const items = query.data ?? [];

  return (
    <TerminalPanel title={title} subtitle={subtitle ?? `Latest headlines for ${ticker.toUpperCase()}`}>
      {query.isLoading ? (
        <div className="py-6 text-center text-[11px] text-terminal-muted">Loading news…</div>
      ) : items.length === 0 ? (
        <div className="py-6 text-center text-[11px] text-terminal-muted">
          No recent news found for {ticker.toUpperCase()}.
        </div>
      ) : (
        <div className="grid gap-1">
          {items.map((item) => (
            <a
              key={`${item.id}-${item.published_at}`}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="grid gap-0.5 rounded-sm border border-terminal-border bg-terminal-bg px-2 py-2 hover:border-terminal-accent"
            >
              <div className="flex items-center gap-2 text-[11px] text-terminal-muted">
                <span className="truncate font-semibold text-terminal-text/80">{item.source || "NEWS"}</span>
                {item.published_at && <span>· {formatWhen(item.published_at)}</span>}
              </div>
              <div className="text-sm text-terminal-text">{item.title}</div>
              {item.summary && (
                <div className="line-clamp-2 text-[11px] text-terminal-muted">{item.summary}</div>
              )}
            </a>
          ))}
        </div>
      )}
    </TerminalPanel>
  );
}
