import { useEffect, useRef, useState, type ReactNode } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchPairTest, fetchPairSpread, fetchPairSignals, fetchPairScan, type PairTestResult, type PairSpreadResult, type PairSignalsResult, type PairScanResult } from "../api/pairs";
import { AnalyticsTable, analyticsNumber as number, finite } from "../components/terminal/AnalyticsRead";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";

type Tool = "test" | "spread" | "backtest" | "scan";
type Draft = { symbol1: string; symbol2: string; period: string; entry_z: string; exit_z: string; zwindow: string };
type Capture = { symbol1?: string; symbol2?: string; period: string; entry_z?: number; exit_z?: number; zwindow?: number; symbols?: string[] };
type Run = { status: "pending" | "done" | "failed"; captured: Capture; data?: unknown };
const TOOLS: Record<Tool,{ label: string; description: string }> = {
  test: { label: "Pair test", description: "Reported cointegration tests and hedge-ratio estimates for two symbols." },
  spread: { label: "Spread and z-score", description: "Inspect the reported spread separately from its rolling z-score and thresholds." },
  backtest: { label: "Backtest", description: "Inspect the existing model’s historical equity series and reported statistics." },
  scan: { label: "Scan", description: "Test the existing fixed basket; pair fields and trading thresholds do not change this scan." },
};
const UNIVERSE = ["VOO", "SPY", "KO", "PEP", "XOM", "CVX", "GLD", "IAU"];
const PERIODS = ["1Y","2Y","3Y","5Y"];
const text = (value: unknown) => typeof value === "string" && value.trim() ? value : "Unavailable";
const threshold = (value: unknown) => finite(value) ? String(value) : "Unavailable";
const pct = (value: unknown) => finite(value) ? `${(value*100).toFixed(1)}%` : "Unavailable";
const conclusion = (value: unknown) => value === true ? "Cointegrated" : value === false ? "Not cointegrated" : "Unavailable";
const list = <T,>(value: T[] | null | undefined): T[] => Array.isArray(value) ? value : [];
const axis = { fill: "var(--ot-color-text-muted)", fontSize: 12 };
function Metrics({ items }: { items: [string,ReactNode][] }) {
  return <dl className="flex min-w-0 flex-wrap gap-3">{items.map(([label,value]) => <div key={label} className="min-w-0 flex-1 basis-48 rounded border border-terminal-border bg-terminal-panel p-3"><dt className="text-xs text-terminal-muted">{label}</dt><dd className="mt-2 break-words text-lg tabular-nums">{value}</dd></div>)}</dl>;
}
function Exact({ name, headers, rows }: { name: string; headers: string[]; rows: ReactNode[][] }) {
  return <details className="min-w-0"><summary className="cursor-pointer py-2 text-sm">{name}</summary><AnalyticsTable name={name} headers={headers} rows={rows} /></details>;
}
function Chart({ name, rows, field, label, color, lines = [], baseline }: { name: string; rows: any[]; field: string; label: string; color: string; lines?: [string,unknown][]; baseline?: number }) {
  return rows.some(row => finite(row[field])) ? <div role="img" aria-label={name} className="h-80 min-w-0 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows}><CartesianGrid stroke="#263040" vertical={false} /><XAxis dataKey="date" tick={axis} minTickGap={32} /><YAxis tick={axis} domain={["auto","auto"]} /><Tooltip contentStyle={{ backgroundColor: "#0d1117", border: "1px solid #263040", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 12 }} />{baseline !== undefined && <ReferenceLine y={baseline} ifOverflow="extendDomain" stroke="#94a3b8" strokeDasharray="3 3" />}{lines.filter(([,value]) => finite(value)).map(([title,value]) => <ReferenceLine key={title} y={value as number} ifOverflow="extendDomain" stroke={title.includes("Entry") ? "#F59E0B" : "#94a3b8"} strokeDasharray="3 3" />)}<Line type="monotone" dataKey={field} name={label} stroke={color} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div> : <p role="status" className="py-4 text-sm text-terminal-muted">No numeric observations returned for this chart.</p>;
}
function PairTest({ data }: { data: PairTestResult }) {
  return <div className="space-y-4"><section aria-label="Cointegration verdict" className="rounded border border-terminal-border p-4"><h3 className="text-base font-semibold">{conclusion(data.cointegrated)}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm text-terminal-muted">{text(data.verdict)}</p></section><Metrics items={[["Service first symbol",text(data.symbol1)],["Service second symbol",text(data.symbol2)],["Service period",text(data.period)],["Beta (Hedge Ratio)",number(data.beta,4)],["Cointegration p-value",number(data.coint_pvalue,4)],["ADF p-value",number(data.adf_pvalue,4)],["Half-life (observations)",number(data.half_life,1)],["Current z-score",number(data.zscore_current)],["Period start",text(data.period_start)],["Period end",text(data.period_end)]]} /><Exact name="Additional pair estimates" headers={["Estimate","Reported value"]} rows={[["Alpha",number(data.alpha,6)],["ADF statistic",number(data.adf_stat,4)],["Residual mean",number(data.resid_mean,6)],["Residual standard deviation",number(data.resid_std,6)]]} /></div>;
}
function Spread({ data }: { data: PairSpreadResult }) {
  const rows = list(data.points);
  const lines: [string,unknown][] = [["Entry +",data.entry_z],["Entry −",finite(data.entry_z) ? -data.entry_z : undefined],["Exit +",data.exit_z],["Exit −",finite(data.exit_z) ? -data.exit_z : undefined]];
  return <div className="space-y-4"><Metrics items={[["Service first symbol",text(data.symbol1)],["Service second symbol",text(data.symbol2)],["Hedge ratio",number(data.beta,4)],["Returned entry z-score",threshold(data.entry_z)],["Returned exit z-score",threshold(data.exit_z)]]} /><div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2"><TerminalPanel title="Spread" className="min-w-0"><Chart name="Pair spread chart" rows={rows} field="spread" label="Spread" color="#3B82F6" /></TerminalPanel><TerminalPanel title="Rolling z-score" className="min-w-0"><Chart name="Pair z-score chart" rows={rows} field="zscore" label="Z-score" color="#F59E0B" lines={lines} baseline={0} /><p className="mt-2 text-xs text-terminal-muted">Dashed lines show the returned positive and negative entry/exit thresholds.</p></TerminalPanel></div><Exact name="Exact spread observations" headers={["Date","First price","Second price","Hedged second price","Spread","Z-score"]} rows={rows.map(row => [row.date,number(row.price1,4),number(row.price2,4),number(row.hedged,4),number(row.spread,4),number(row.zscore,4)])} /></div>;
}
function Backtest({ data }: { data: PairSignalsResult }) {
  const rows = list(data.equity), stats = data.stats;
  return <div className="space-y-4"><Metrics items={[["Service first symbol",text(data.symbol1)],["Service second symbol",text(data.symbol2)],["Hedge ratio",number(data.beta,4)],["Returned entry z-score",threshold(data.entry_z)],["Returned exit z-score",threshold(data.exit_z)],["Completed model trades",number(stats?.trades,0)],["Win rate",pct(stats?.win_rate)],["Sharpe ratio",number(stats?.sharpe)],["Maximum drawdown",pct(stats?.max_drawdown)],["Total return",pct(stats?.total_return)]]} /><TerminalPanel title="Model equity curve" subtitle="Unitless model series; not portfolio value or recorded trades." className="min-w-0"><Chart name="Pair backtest equity chart" rows={rows} field="equity" label="Model equity" color="#10B981" baseline={1} /><Exact name="Exact backtest observations" headers={["Date","Model equity","Reported position","Z-score"]} rows={rows.map(row => [row.date,number(row.equity,6),number(row.position,0),number(row.zscore,4)])} /></TerminalPanel></div>;
}
function Scan({ data }: { data: PairScanResult }) {
  return <div className="space-y-3"><p className="text-sm text-terminal-muted">Service period: {text(data.period)}. Returned pairs keep the service’s ordering; missing pairs do not establish a failed test.</p><AnalyticsTable name="Pair scan results" headers={["First symbol","Second symbol","Hedge ratio","Cointegration p-value","ADF p-value","Half-life (observations)","Current z-score","Service conclusion"]} rows={list(data.results).map(row => [text(row.symbol1),text(row.symbol2),number(row.beta,4),number(row.coint_pvalue,4),number(row.adf_pvalue,4),number(row.half_life,1),number(row.zscore_current),conclusion(row.cointegrated)])} /></div>;
}
function Results({ tool,data }: { tool: Tool; data: unknown }) {
  if (!data || typeof data !== "object" || !Object.keys(data).length) return <p role="status" className="text-sm text-terminal-muted">No analysis values returned.</p>;
  if (tool === "test") return <PairTest data={data as PairTestResult} />;
  if (tool === "spread") return <Spread data={data as PairSpreadResult} />;
  if (tool === "backtest") return <Backtest data={data as PairSignalsResult} />;
  return <Scan data={data as PairScanResult} />;
}
function capturedRows(tool: Tool, captured: Capture): [string,ReactNode][] {
  const rows: [string,ReactNode][] = tool === "scan" ? [["Fixed scan basket",captured.symbols?.join(", ")]] : [["First symbol",captured.symbol1],["Second symbol",captured.symbol2]];
  rows.push(["History period",captured.period]);
  if (tool === "spread" || tool === "backtest") rows.push(["Entry z-score",String(captured.entry_z)],["Exit z-score",String(captured.exit_z)],["Z-score window (observations)",String(captured.zwindow)]);
  return rows;
}
function capture(tool: Tool,draft: Draft): Capture {
  const numeric = (value: string) => value.trim() ? Number(value) : NaN;
  if (tool === "scan") return { symbols: [...UNIVERSE],period: draft.period };
  const pair = { symbol1: draft.symbol1.trim().toUpperCase(),symbol2: draft.symbol2.trim().toUpperCase(),period: draft.period };
  return tool === "test" ? pair : { ...pair,entry_z: numeric(draft.entry_z),exit_z: numeric(draft.exit_z),zwindow: numeric(draft.zwindow) };
}
async function calculate(tool: Tool, captured: Capture) {
  if (tool === "scan") return fetchPairScan({ symbols: captured.symbols!,period: captured.period });
  const pair = { symbol1: captured.symbol1!,symbol2: captured.symbol2!,period: captured.period };
  if (tool === "test") return fetchPairTest(pair);
  const body = { ...pair,zwindow: captured.zwindow,entry_z: captured.entry_z,exit_z: captured.exit_z };
  return tool === "spread" ? fetchPairSpread(body) : fetchPairSignals(body);
}

export function PairTradingLabPage() {
  const [tool,setTool] = useState<Tool>("test"), [draft,setDraft] = useState<Draft>({ symbol1: "VOO",symbol2: "SPY",period: "2Y",entry_z: "2",exit_z: "0.5",zwindow: "60" });
  const [runs,setRuns] = useState<Partial<Record<Tool,Run>>>({}), [error,setError] = useState("");
  const pending = useRef(new Set<Tool>()), mounted = useRef(true), active = useRef(tool), focusResult = useRef<Tool | null>(null), resultRef = useRef<HTMLElement>(null);
  active.current = tool;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (focusResult.current === tool) { focusResult.current = null; resultRef.current?.focus(); resultRef.current?.scrollIntoView?.({ block: "start",behavior: "auto" }); } }, [tool,runs]);
  const run = runs[tool], running = run?.status === "pending", thresholds = tool === "spread" || tool === "backtest";
  function edit(key: keyof Draft,value: string) { setDraft(old => ({ ...old,[key]: value })); setError(""); }
  async function submit() {
    if (pending.current.has(tool)) return;
    const captured = capture(tool,draft);
    if (!PERIODS.includes(captured.period)) { setError("Choose an available history period."); return; }
    if (tool !== "scan" && (!captured.symbol1 || !captured.symbol2 || captured.symbol1 === captured.symbol2)) { setError("Enter two distinct symbols."); return; }
    if (thresholds && (!draft.zwindow.trim() || !Number.isInteger(captured.zwindow) || captured.zwindow! < 10 || captured.zwindow! > 252)) { setError("Z-score window must be a whole number from 10 to 252."); return; }
    if (thresholds && (!draft.entry_z.trim() || !draft.exit_z.trim() || !finite(captured.entry_z) || !finite(captured.exit_z))) { setError("Enter finite numbers for both z-score thresholds."); return; }
    const requested = tool;
    if (tool !== "scan") setDraft(old => ({ ...old,symbol1: captured.symbol1!,symbol2: captured.symbol2! }));
    pending.current.add(requested); setError(""); setRuns(old => ({ ...old,[requested]: { status: "pending",captured } }));
    try { const data = await calculate(requested,captured); if (mounted.current) { if (active.current === requested) focusResult.current = requested; setRuns(old => ({ ...old,[requested]: { status: "done",captured,data } })); } }
    catch { if (mounted.current) { if (active.current === requested) focusResult.current = requested; setRuns(old => ({ ...old,[requested]: { status: "failed",captured } })); } }
    finally { pending.current.delete(requested); }
  }
  return <main aria-label="Pair Trading workspace" className="min-w-0 space-y-4 p-3 text-terminal-text sm:p-4"><header className="space-y-2"><h1 className="text-lg font-semibold">Pair Trading Lab</h1><p className="text-sm text-terminal-muted">Choose an analysis, run its inputs and inspect the captured statistical evidence.</p></header>
    <nav aria-label="Pair analysis" className="flex min-w-0 flex-wrap gap-2">{Object.entries(TOOLS).map(([key,item]) => <TerminalButton key={key} type="button" aria-pressed={tool === key} variant={tool === key ? "accent" : "default"} className="normal-case tracking-normal" onClick={() => { const next = key as Tool; active.current = next; focusResult.current = null; setTool(next); setError(""); }}>{item.label}</TerminalButton>)}</nav><p className="text-sm text-terminal-muted">{TOOLS[tool].description}</p>
    <TerminalPanel title={`${TOOLS[tool].label} inputs`} className="min-w-0"><form aria-label="Pair analysis inputs" onSubmit={event => { event.preventDefault(); void submit(); }}><fieldset disabled={running} className="flex min-w-0 flex-wrap items-end gap-3">
      {tool !== "scan" && ([['symbol1','First pair symbol'],['symbol2','Second pair symbol']] as const).map(([key,label]) => <label key={key} className="min-w-0 flex-1 basis-48 space-y-2 text-xs">{label}<TerminalInput className="block text-sm" value={draft[key]} maxLength={80} required onChange={event => edit(key,event.target.value)} /></label>)}
      <label className="min-w-0 flex-1 basis-40 space-y-2 text-xs">History period<TerminalInput as="select" className="block text-sm" value={draft.period} onChange={event => edit("period",event.target.value)}>{PERIODS.map(period => <option key={period} value={period}>{period === "1Y" ? "1 year" : `${period.slice(0,-1)} years`}</option>)}</TerminalInput></label>
      {thresholds && ([['entry_z','Entry z-score'],['exit_z','Exit z-score'],['zwindow','Z-score window (observations)']] as const).map(([key,label]) => <label key={key} className="min-w-0 flex-1 basis-40 space-y-2 text-xs">{label}<TerminalInput type="number" className="block text-sm" value={draft[key]} step={key === "zwindow" ? 1 : "any"} min={key === "zwindow" ? 10 : undefined} max={key === "zwindow" ? 252 : undefined} required onChange={event => edit(key,event.target.value)} /></label>)}
      <TerminalButton type="submit" variant="accent" className="normal-case tracking-normal" disabled={running}>{running ? "Running analysis…" : "Run analysis"}</TerminalButton></fieldset>
      {tool === "scan" && <p className="mt-3 break-words text-sm text-terminal-muted">Fixed scan basket: {UNIVERSE.join(", ")}.</p>}{error && <p role="alert" className="mt-3 text-sm text-terminal-neg">{error}</p>}
    </form></TerminalPanel>
    <section aria-label="Pair analysis result" aria-busy={running} ref={resultRef} tabIndex={-1} className="min-w-0 space-y-4 focus-visible:outline focus-visible:outline-terminal-accent">{run ? <><h2 className="text-base font-semibold">{TOOLS[tool].label} · captured run</h2><dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-3 rounded border border-terminal-border p-3">{capturedRows(tool,run.captured).map(([label,value]) => <div key={label} className="min-w-0 max-w-full"><dt className="text-xs text-terminal-muted">{label}</dt><dd className="mt-1 break-words text-sm">{value}</dd></div>)}</dl>
      {JSON.stringify(capture(tool,draft)) !== JSON.stringify(run.captured) && <p className="text-xs text-terminal-muted">Inputs have changed. Results below still belong to the captured run.</p>}
      {running ? <p role="status" className="text-sm text-terminal-muted">Running the captured analysis. No previous result is shown; there is no automatic retry.</p> : run.status === "failed" ? <p role="alert" className="rounded border border-terminal-neg p-4 text-sm text-terminal-neg">Could not complete this analysis. No previous result is shown. Your inputs are kept; retry manually when ready.</p> : <Results tool={tool} data={run.data} />}
    </> : <p className="rounded border border-terminal-border p-4 text-sm text-terminal-muted">Set the inputs and run this analysis. Nothing runs automatically.</p>}</section>
    <details className="rounded border border-terminal-border p-3 text-sm"><summary className="cursor-pointer">Model scope and interpretation</summary><div className="mt-3 space-y-2 text-sm text-terminal-muted"><p>These are statistical model outputs, not verified trading outcomes. The historical backtest is separate from your portfolio and does not place orders. It does not include transaction fees, slippage or financing costs.</p><p>Spread and source prices have no currency metadata here; display-currency conversion is not applied. Observation dates do not imply simultaneous closes across markets. Model calibration, adjusted-price basis, missing-data handling and native listing coverage have not been independently verified here.</p><p>The scan uses the fixed basket shown above; omitted pairs may have unavailable data. Results and drafts are temporary and are not saved when you leave this page.</p></div></details>
  </main>;
}
