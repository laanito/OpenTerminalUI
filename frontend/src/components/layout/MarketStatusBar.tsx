import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CircleDot } from "lucide-react";

import { TerminalModal } from "../terminal/TerminalModal";
import { useMarketStatus } from "../../hooks/useStocks";
import { useAlertsStore } from "../../store/alertsStore";
import { useQuotesStore } from "../../realtime/useQuotesStream";

function formatZone(now: Date, timeZone: string) {
  return now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
  });
}

function marketLabel(value: unknown): "OPEN" | "CLOSED" | "UNAVAILABLE" {
  const raw = String(value || "").toUpperCase();
  if (!raw) return "UNAVAILABLE";
  return raw.includes("OPEN") ? "OPEN" : "CLOSED";
}

function Dot({ tone }: { tone: "green" | "yellow" | "red" | "gray" }) {
  const cls =
    tone === "green"
      ? "text-emerald-400"
      : tone === "yellow"
        ? "text-amber-400"
        : tone === "red"
          ? "text-rose-400"
          : "text-gray-500";
  return <CircleDot aria-hidden="true" className={`h-3.5 w-3.5 ${cls}`} fill="currentColor" />;
}

export function MarketStatusBar(_props: { tickerOverride?: string | null } = {}) {
  const { data: marketStatus } = useMarketStatus();
  const unreadAlerts = useAlertsStore((s) => s.unreadCount);
  const connectionState = useQuotesStore((s) => s.connectionState);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [lagMs, setLagMs] = useState(0);
  const lagRef = useRef(performance.now());

  useEffect(() => {
    const timer = setInterval(() => {
      const nextNow = new Date();
      const currentPerf = performance.now();
      const drift = Math.max(0, currentPerf - lagRef.current - 1000);
      lagRef.current = currentPerf;
      setLagMs(Math.round(drift));
      setNow(nextNow);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const perfStats = useMemo(() => {
    const memoryApi = (performance as Performance & { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } }).memory;
    const heapMb = memoryApi?.usedJSHeapSize ? Math.round(memoryApi.usedJSHeapSize / (1024 * 1024)) : null;
    const heapPct =
      memoryApi?.usedJSHeapSize && memoryApi?.jsHeapSizeLimit
        ? Math.round((memoryApi.usedJSHeapSize / memoryApi.jsHeapSizeLimit) * 100)
        : null;
    return { heapMb, heapPct };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lagMs, now]);

  const marketPayload = (marketStatus ?? {}) as {
    marketState?: Array<{ marketStatus?: string }>;
    nseStatus?: string;
    nyseStatus?: string;
    nextOpenTime?: string;
    fallbackEnabled?: boolean;
  };

  const nseOpen = marketLabel(marketPayload.marketState?.[0]?.marketStatus ?? marketPayload.nseStatus);
  const nyseOpen = marketLabel(marketPayload.nyseStatus);
  const connectionTone =
    connectionState === "connected" ? "green" : connectionState === "connecting" ? "yellow" : "red";
  const connText =
    connectionState === "connected" ? "CONNECTED" : connectionState === "connecting" ? "DEGRADED" : "DISCONNECTED";

  return (
    <>
      <footer aria-label="Terminal status" className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-terminal-border bg-terminal-panel px-3 py-1 text-xs text-terminal-muted">
        <span className="whitespace-nowrap font-mono">UTC {formatZone(now, "UTC")}</span>
        <span aria-label="Market session summary" className="hidden items-center gap-3 lg:inline-flex">
          <span>NSE: {nseOpen}</span><span>NYSE: {nyseOpen}</span>
        </span>
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex items-center gap-1"><Dot tone={connectionTone} />{connText}</span>
          <span className="inline-flex items-center gap-1" aria-label={`${unreadAlerts} unread alerts`}><Bell aria-hidden="true" className="h-3.5 w-3.5" />{unreadAlerts}</span>
          <button type="button" className="min-h-7 rounded border border-terminal-border px-2 text-xs hover:text-terminal-text" aria-haspopup="dialog" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(true)}>Status details</button>
        </div>
      </footer>
      <TerminalModal open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Terminal status details" size="sm">
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 break-words text-sm">
          <dt>Quote connection</dt><dd>{connText}</dd>
          <dt>Unread alerts</dt><dd>{unreadAlerts}</dd>
          <dt>UTC</dt><dd className="font-mono">{formatZone(now, "UTC")}</dd>
          <dt>New York</dt><dd className="font-mono">{formatZone(now, "America/New_York")}</dd>
          <dt>India</dt><dd className="font-mono">{formatZone(now, "Asia/Kolkata")}</dd>
          <dt>NSE</dt><dd>{nseOpen}</dd>
          <dt>NYSE</dt><dd>{nyseOpen}</dd>
          {marketPayload.nextOpenTime ? <><dt>Next open</dt><dd>{String(marketPayload.nextOpenTime)}</dd></> : null}
          <dt>Browser loop delay</dt><dd>{lagMs} ms</dd>
          <dt>JS heap</dt><dd>{perfStats.heapMb == null ? "Unavailable" : `${perfStats.heapMb} MB${perfStats.heapPct == null ? "" : ` (${perfStats.heapPct}%)`}`}</dd>
        </dl>
        <p className="mt-4 text-xs text-terminal-muted">Browser loop delay and JS heap are local browser diagnostics, not backend health or system CPU usage.</p>
      </TerminalModal>
    </>
  );
}
