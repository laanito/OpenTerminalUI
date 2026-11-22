import type { ChartPoint } from "../../types";
import "./ChartWorkstation.css";

interface Props {
  ticker: string | null;
  lastBar?: ChartPoint | null;
  liveLtp?: number | null;
  liveChangePct?: number | null;
}

export function ChartPanelFooter({ ticker, lastBar, liveLtp = null, liveChangePct = null }: Props) {
  if (!ticker || !lastBar) return null;
  const pct = lastBar.o > 0 ? (((lastBar.c - lastBar.o) / lastBar.o) * 100).toFixed(2) : null;
  const isUp = lastBar.c >= lastBar.o;
  return (
    <dl className="chart-panel-footer" aria-label={`${ticker} latest candle`} data-testid="chart-panel-footer">
      {[["O", "Open", lastBar.o], ["H", "High", lastBar.h], ["L", "Low", lastBar.l], ["C", "Close", lastBar.c]].map(([short, label, value]) => (
        <div key={String(short)} className="flex items-center gap-1 whitespace-nowrap">
          <dt aria-label={String(label)} className="text-terminal-muted">{short}</dt>
          <dd className={short === "C" ? (isUp ? "text-terminal-pos" : "text-terminal-neg") : undefined}>{Number(value).toFixed(2)}</dd>
        </div>
      ))}
      {pct !== null && <div className={`flex items-center gap-1 ${isUp ? "text-terminal-pos" : "text-terminal-neg"}`}><dt className="text-terminal-muted">Bar</dt><dd>{isUp ? "+" : ""}{pct}%</dd></div>}
      {liveLtp !== null && Number.isFinite(liveLtp) ? <div className="flex items-center gap-1 whitespace-nowrap"><dt className="text-terminal-muted">Quote</dt><dd className={liveChangePct !== null && liveChangePct < 0 ? "text-terminal-neg" : "text-terminal-pos"}>{liveLtp.toFixed(2)}</dd></div> : null}
    </dl>
  );
}
