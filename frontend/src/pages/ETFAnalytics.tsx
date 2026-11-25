import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { HoldingsViewer } from "../components/etf/HoldingsViewer";
import { OverlapAnalysis } from "../components/etf/OverlapAnalysis";
import { FlowTracker } from "../components/etf/FlowTracker";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

export function ETFAnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const requested = (params.get("ticker") || "SPY").trim().toUpperCase();
  const [ticker, setTicker] = useState(requested);
  const [draft, setDraft] = useState(requested);
  const [compareTickers, setCompareTickers] = useState(["SPY", "VOO"]);
  const [compareInput, setCompareInput] = useState("SPY, VOO");
  const [error, setError] = useState("");
  useEffect(() => { setTicker(requested); setDraft(requested); }, [requested]);
  function applyTicker() {
    const next = draft.trim().toUpperCase();
    if (!next) return;
    setTicker(next); setDraft(next);
    const query = new URLSearchParams(params); query.set("ticker", next); setParams(query);
  }
  function compare() {
    const next = compareInput.split(",").map(value => value.trim().toUpperCase()).filter(Boolean);
    if (next.length < 2) { setError("Enter at least two comma-separated ETF tickers. The applied comparison below is unchanged."); return; }
    setError(""); setCompareTickers(next);
  }
  return <main aria-label="ETF analytics" className="min-w-0 space-y-3 p-3 [overflow-wrap:anywhere] [&_input]:!text-sm">
    <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-lg font-semibold text-terminal-accent">ETF Analytics &amp; Intelligence</h1><p className="text-sm text-terminal-muted">Review holdings, compare overlap and inspect fund flows.</p></div>
      <form aria-label="ETF scope" onSubmit={event => { event.preventDefault(); applyTicker(); }} className="flex min-w-0 flex-wrap items-end gap-2">
        <label className="block min-w-0 space-y-1 text-xs text-terminal-muted">ETF ticker<TerminalInput required aria-label="ETF ticker" value={draft} onChange={event => setDraft(event.target.value.toUpperCase())} className="w-40 max-w-full"/></label>
        <TerminalButton type="submit" variant="accent">Load ETF</TerminalButton>
      </form>
    </header>
    <p className="text-sm text-terminal-muted">Applied ETF: <strong className="text-terminal-text">{ticker}</strong>. Draft fields only change results when submitted.</p>
    <div className="grid min-w-0 grid-cols-1 items-start gap-3 xl:grid-cols-2">
      <div className="min-w-0 space-y-3">
        <TerminalPanel title={`Holdings Analysis: ${ticker}`}><HoldingsViewer ticker={ticker}/></TerminalPanel>
        <details className="min-w-0 rounded border border-terminal-border"><summary className="cursor-pointer p-3 text-sm">Fund flows</summary><TerminalPanel title={`Fund Flows: ${ticker}`}><FlowTracker ticker={ticker}/></TerminalPanel></details>
      </div>
      <TerminalPanel title="Overlap Analysis" bodyClassName="min-w-0 space-y-3">
        <form aria-label="ETF comparison" onSubmit={event => { event.preventDefault(); compare(); }} className="flex min-w-0 flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1 basis-56 space-y-1 text-xs text-terminal-muted">Comparison tickers<TerminalInput aria-label="Comparison tickers" value={compareInput} onChange={event => setCompareInput(event.target.value)} placeholder="SPY, VOO"/></label>
          <TerminalButton type="submit">Compare ETFs</TerminalButton>
        </form>
        {error ? <p role="alert" className="text-sm text-terminal-neg">{error}</p> : null}
        <p className="text-xs text-terminal-muted">Applied comparison: {compareTickers.join(" vs ")}. Holdings and overlap may have different coverage; non-live markers apply to each response.</p>
        <OverlapAnalysis tickers={compareTickers}/>
      </TerminalPanel>
    </div>
  </main>;
}
