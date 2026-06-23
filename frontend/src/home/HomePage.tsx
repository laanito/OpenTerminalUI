import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useMarketStatus } from "../hooks/useStocks";
import logo from "../assets/logo.png";
import { AsciiHero } from "./AsciiHero";

function fmt(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function HomePage() {
  const navigate = useNavigate();
  const { data: marketStatus } = useMarketStatus();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "e") {
        navigate("/equity/stocks");
      }
      if (key === "f") {
        navigate("/fno");
      }
      if (key === "b") {
        navigate("/backtesting");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const statusPayload = marketStatus as {
    marketState?: Array<{ marketStatus?: string }>;
    sp500?: number | null;
    sp500Pct?: number | null;
    nasdaq?: number | null;
    nasdaqPct?: number | null;
    dowjones?: number | null;
    dowjonesPct?: number | null;
  } | undefined;

  const marketOpen = String(statusPayload?.marketState?.[0]?.marketStatus || "").toUpperCase() === "OPEN";
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const sp500 = num(statusPayload?.sp500);
  const sp500Pct = num(statusPayload?.sp500Pct);
  const nasdaq = num(statusPayload?.nasdaq);
  const nasdaqPct = num(statusPayload?.nasdaqPct);
  const dow = num(statusPayload?.dowjones);
  const dowPct = num(statusPayload?.dowjonesPct);

  return (
    <div className="flex h-screen flex-col bg-terminal-bg text-terminal-text">
      <div className="border-b border-terminal-border bg-terminal-panel px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <img src={logo} alt="OpenTerminalUI" className="h-12 w-auto object-contain" />
          <div className="text-right">
            <div className="text-lg font-semibold uppercase tracking-widest text-terminal-accent">OpenTerminal UI</div>
            <div className="text-xs uppercase tracking-wide text-terminal-muted">Trading Analytics Workspace</div>
          </div>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <AsciiHero
          className="absolute inset-0 h-full w-full rounded-none border-0 bg-transparent opacity-55"
          palette="amber"
          quality="med"
          glow={0.7}
        />

        <div className="absolute inset-0 z-10 overflow-auto p-6">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-3">
            <button
              onClick={() => navigate("/equity/stocks")}
              className="group rounded border border-terminal-border bg-terminal-panel/80 p-5 text-left backdrop-blur-[1px] hover:border-terminal-accent"
            >
              <div className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Equity & Analysis</div>
              <ul className="mt-3 space-y-1 text-xs text-terminal-muted">
                <li>Stock Charts</li>
                <li>Screener</li>
                <li>Fundamentals</li>
                <li>Valuation (DCF)</li>
                <li>Peer Comparison</li>
                <li>Backtest</li>
                <li>News & Sentiment</li>
                <li>Alerts</li>
              </ul>
              <div className="mt-4 inline-block rounded border border-terminal-border px-3 py-1 text-xs text-terminal-accent group-hover:border-terminal-accent">OPEN ?</div>
            </button>

            <button
              onClick={() => navigate("/fno")}
              className="group rounded border border-terminal-border bg-terminal-panel/80 p-5 text-left backdrop-blur-[1px] hover:border-terminal-accent"
            >
              <div className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Futures & Options</div>
              <ul className="mt-3 space-y-1 text-xs text-terminal-muted">
                <li>Option Chain</li>
                <li>Greeks Dashboard</li>
                <li>OI Analysis</li>
                <li>Strategy Builder</li>
                <li>PCR Tracker</li>
                <li>IV Surface</li>
                <li>F&O Heatmap</li>
                <li>Expiry Dashboard</li>
              </ul>
              <div className="mt-4 inline-block rounded border border-terminal-border px-3 py-1 text-xs text-terminal-accent group-hover:border-terminal-accent">OPEN ?</div>
            </button>

            <button
              onClick={() => navigate("/backtesting")}
              className="group rounded border border-terminal-border bg-terminal-panel/80 p-5 text-left backdrop-blur-[1px] hover:border-terminal-accent"
            >
              <div className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Backtesting Lab</div>
              <ul className="mt-3 space-y-1 text-xs text-terminal-muted">
                <li>Daily OHLCV fetch</li>
                <li>Built-in SMA strategy</li>
                <li>Python script strategy runner</li>
                <li>Queued job execution</li>
                <li>Status polling + result retrieval</li>
                <li>Equity curve + metrics</li>
                <li>Trade blotter + logs</li>
                <li>Paper trading isolation</li>
              </ul>
              <div className="mt-4 inline-block rounded border border-terminal-border px-3 py-1 text-xs text-terminal-accent group-hover:border-terminal-accent">OPEN ?</div>
            </button>
          </div>
        </div>
      </div>

      <div className="border-t border-terminal-border bg-terminal-panel px-4 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className={marketOpen ? "text-terminal-pos" : "text-terminal-neg"}>? {marketOpen ? "OPEN" : "CLOSED"}</span>
          <span>S&amp;P 500: {fmt(sp500)} ({sp500Pct === null ? "-" : `${sp500Pct >= 0 ? "+" : ""}${sp500Pct.toFixed(2)}%`})</span>
          <span>NASDAQ: {fmt(nasdaq)} ({nasdaqPct === null ? "-" : `${nasdaqPct >= 0 ? "+" : ""}${nasdaqPct.toFixed(2)}%`})</span>
          <span>DOW: {fmt(dow)} ({dowPct === null ? "-" : `${dowPct >= 0 ? "+" : ""}${dowPct.toFixed(2)}%`})</span>
          <span className="ml-auto text-terminal-muted">Press E for Equity | F for F&O | B for Backtesting</span>
        </div>
      </div>
    </div>
  );
}
