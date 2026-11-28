import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchFrameworkModels, runFrameworkBacktest, type FrameworkBacktestRequest, type ModelDef } from "../api/framework";
import { CatalogueStatus, ResearchChoice, ResearchField, ResearchMetrics, ResearchNumber, ResearchStatus, ResearchWorkspace, researchNumber, useResearchRun } from "../components/backtesting/ResearchWorkflow";
import { AnalyticsTable } from "../components/terminal/AnalyticsRead";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalButton } from "../components/terminal/TerminalButton";

const defaults = (model: ModelDef) => Object.fromEntries(model.params.map(param => [param.key, param.default]));
export function AlgorithmFrameworkLab() {
  const [tickers, setTickers] = useState("AAPL,MSFT,GOOGL,AMZN,NVDA");
  const [benchmark, setBenchmark] = useState("^GSPC");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rebalanceFreq, setRebalanceFreq] = useState("ME");
  const [initialCash, setInitialCash] = useState(1000000);
  const [transactionCostBps, setTransactionCostBps] = useState(10);
  const [topN, setTopN] = useState(10);
  const [longOnly, setLongOnly] = useState(true);
  const [selectedAlphaId, setSelectedAlphaId] = useState("");
  const [alphaParams, setAlphaParams] = useState<Record<string, number>>({});
  const [selectedPCId, setSelectedPCId] = useState("");
  const [pcParams, setPcParams] = useState<Record<string, number>>({});
  const [enabledRiskModelIds, setEnabledRiskModelIds] = useState<Set<string>>(new Set());
  const [riskParams, setRiskParams] = useState<Record<string, Record<string, number>>>({});
  const catalogue = useQuery({ queryKey: ["framework-models"], queryFn: fetchFrameworkModels, retry: false });
  const models = catalogue.data;
  const run = useResearchRun(runFrameworkBacktest, "Failed to run backtest.");
  useEffect(() => {
    if (models?.alpha?.length && !selectedAlphaId) { setSelectedAlphaId(models.alpha[0].id); setAlphaParams(defaults(models.alpha[0])); }
    if (models?.portfolio_construction?.length && !selectedPCId) { setSelectedPCId(models.portfolio_construction[0].id); setPcParams(defaults(models.portfolio_construction[0])); }
  }, [models, selectedAlphaId, selectedPCId]);
  const alpha = models?.alpha?.find(model => model.id === selectedAlphaId);
  const construction = models?.portfolio_construction?.find(model => model.id === selectedPCId);
  const riskModels = (models?.risk || []).filter(model => enabledRiskModelIds.has(model.id));
  const symbols = tickers.split(",").map(symbol => symbol.trim()).filter(Boolean);
  const validParams = (model: ModelDef | undefined, values: Record<string, number>) => Boolean(model) && model!.params.every(param => Number.isFinite(values[param.key] ?? param.default) && (param.type !== "int" || Number.isInteger(values[param.key] ?? param.default)));
  const valid = Boolean(symbols.length && (!startDate || !endDate || startDate <= endDate) && Number.isFinite(initialCash) && initialCash > 0 && Number.isFinite(transactionCostBps) && transactionCostBps >= 0 && Number.isInteger(topN) && topN >= 1 && validParams(alpha, alphaParams) && validParams(construction, pcParams) && riskModels.every(model => validParams(model, riskParams[model.id] || {})));
  const parameters = (model: ModelDef | undefined, values: Record<string, number>, update: (key: string, value: number) => void) => model?.params.length ? <details className="mt-3 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Parameters · {model.label}</summary><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">{model.params.map(param => <ResearchNumber key={param.key} label={`${model.label} · ${["max_drawdown", "max_weight", "stop_pct"].includes(param.key) ? `${param.label.replace(/%/g, "").trim()} (fraction)` : param.label}`} value={values[param.key] ?? param.default} step={param.type === "int" ? 1 : "any"} onChange={value => update(param.key, value)} />)}</div></details> : <p className="mt-2 text-xs text-terminal-muted">No configurable parameters for this model.</p>;
  const submit = () => {
    if (!valid || run.pending) return;
    const request: FrameworkBacktestRequest = { tickers: symbols, start: startDate || null, end: endDate || null, benchmark: benchmark || null, rebalance_freq: rebalanceFreq, initial_cash: initialCash, transaction_cost_bps: transactionCostBps, top_n: topN, long_only: longOnly, alpha: { id: selectedAlphaId, params: alphaParams }, portfolio_construction: { id: selectedPCId, params: pcParams }, risk: Array.from(enabledRiskModelIds).map(id => ({ id, params: riskParams[id] || {} })) };
    void run.run(request);
  };
  const result = run.data;
  const latest = result?.holdings[result.holdings.length - 1];
  const submitted = run.input;
  return <ResearchWorkspace title="Algorithm Framework Lab" path="/backtesting/algorithm-framework" description="Compose an alpha model, portfolio construction and optional risk overlays for a historical simulation.">
    <CatalogueStatus pending={catalogue.isPending} failed={catalogue.isError} empty={!models?.alpha?.length || !models?.portfolio_construction?.length} retry={() => void catalogue.refetch()} />
    {models && !catalogue.isError && <details open className="rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Simulation setup</summary><form onSubmit={event => { event.preventDefault(); submit(); }} className="mt-3 min-w-0 space-y-3">
      <TerminalPanel title="Universe & Parameters" subtitle="Blank dates use service defaults; tickers are comma-separated">
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ResearchField label="Universe (Tickers)"><TerminalInput className="min-w-0 text-sm" value={tickers} onChange={event => setTickers(event.target.value)} /></ResearchField>
          <ResearchField label="Benchmark"><TerminalInput className="min-w-0 text-sm" value={benchmark} onChange={event => setBenchmark(event.target.value)} /></ResearchField>
          <ResearchField label="Start date"><TerminalInput className="min-w-0 text-sm" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></ResearchField>
          <ResearchField label="End date"><TerminalInput className="min-w-0 text-sm" type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></ResearchField>
        </div>
        <details className="mt-3 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Simulation settings</summary><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ResearchChoice label="Rebalance frequency" value={rebalanceFreq} onChange={setRebalanceFreq} items={[{ id: "W", label: "Weekly" }, { id: "ME", label: "Monthly (End)" }, { id: "QE", label: "Quarterly (End)" }]} />
          <ResearchNumber label="Initial cash (currency not supplied)" value={initialCash} min={0} onChange={setInitialCash} />
          <ResearchNumber label="Transaction costs (bps)" value={transactionCostBps} min={0} onChange={setTransactionCostBps} />
          <ResearchNumber label="Top N assets" value={topN} min={1} step={1} onChange={setTopN} />
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={longOnly} onChange={event => setLongOnly(event.target.checked)} />Long only</label>
        </div><p className="mt-2 text-xs text-terminal-muted">1 basis point = 0.01%. The response supplies no accounting currency.</p></details>
      </TerminalPanel>
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <TerminalPanel title="Alpha Strategy" subtitle="Signal generation"><ResearchChoice label="Alpha model" value={selectedAlphaId} items={models.alpha || []} onChange={id => { setSelectedAlphaId(id); const model = models.alpha.find(item => item.id === id); if (model) setAlphaParams(defaults(model)); }} />{parameters(alpha, alphaParams, (key, value) => setAlphaParams(previous => ({ ...previous, [key]: value })))}</TerminalPanel>
        <TerminalPanel title="Portfolio Construction" subtitle="Weighting logic"><ResearchChoice label="Construction model" value={selectedPCId} items={models.portfolio_construction || []} onChange={id => { setSelectedPCId(id); const model = models.portfolio_construction.find(item => item.id === id); if (model) setPcParams(defaults(model)); }} />{parameters(construction, pcParams, (key, value) => setPcParams(previous => ({ ...previous, [key]: value })))}</TerminalPanel>
      </div>
      <details className="rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Risk overlays · {enabledRiskModelIds.size} selected</summary><p className="mt-2 text-xs text-terminal-muted">Drawdown, position-weight and stop thresholds are fractions: 0.2 means 20%.</p><div className="mt-3 flex flex-wrap gap-2">{(models.risk || []).map(model => <TerminalButton key={model.id} type="button" aria-pressed={enabledRiskModelIds.has(model.id)} variant={enabledRiskModelIds.has(model.id) ? "accent" : "default"} onClick={() => { const next = new Set(enabledRiskModelIds); if (next.has(model.id)) next.delete(model.id); else { next.add(model.id); if (!riskParams[model.id]) setRiskParams(previous => ({ ...previous, [model.id]: defaults(model) })); } setEnabledRiskModelIds(next); }}>{model.label}</TerminalButton>)}{!models.risk?.length && <p className="text-sm text-terminal-muted">No risk overlays returned.</p>}</div>{riskModels.map(model => <div key={model.id}>{parameters(model, riskParams[model.id] || {}, (key, value) => setRiskParams(previous => ({ ...previous, [model.id]: { ...previous[model.id], [key]: value } })))}</div>)}</details>
      <div className="flex flex-wrap items-center gap-3"><TerminalButton variant="accent" type="submit" disabled={!valid} loading={run.pending}>{run.pending ? "Running backtest…" : "Run Backtest"}</TerminalButton><p className="text-xs text-terminal-muted">Historical research simulation.</p></div>
      {!valid && <p className="text-xs text-terminal-warning">Choose available models, enter at least one ticker, ordered dates, positive cash, nonnegative costs and finite parameters. Top N and integer parameters require whole numbers.</p>}
    </form></details>}
    {submitted && <section aria-label="Submitted framework setup" className="space-y-1 rounded border border-terminal-border p-3 text-xs text-terminal-muted"><p className="text-sm text-terminal-text">Submitted universe: {submitted.tickers.join(", ")}</p><p>{submitted.start || "Service default start"} to {submitted.end || "Service default end"} · benchmark {submitted.benchmark || "None"} · alpha {submitted.alpha.id} · construction {submitted.portfolio_construction.id}</p><p>Cash {researchNumber(submitted.initial_cash)} · costs {submitted.transaction_cost_bps} bps · top {submitted.top_n} · {submitted.long_only ? "Long only" : "Long/short"} · rebalance {submitted.rebalance_freq} · risk {submitted.risk.map(model => model.id).join(", ") || "None"}</p><details><summary className="cursor-pointer">Submitted model parameters</summary><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify({ alpha: submitted.alpha, construction: submitted.portfolio_construction, risk: submitted.risk }, null, 2)}</pre></details><p>Editing setup prepares the next run; results belong to this submission.</p></section>}
    <ResearchStatus phase={run.phase} error={run.error} idle="Configure the universe and models, then run a backtest to inspect results." pending="Running the submitted framework simulation…" />
    {result && <>
      {!result.summary.benchmark && <p className="text-xs text-terminal-muted">Benchmark metrics are unavailable. Without a benchmark, the service reports strategy return in the alpha field.</p>}
      <ResearchMetrics items={[
        { label: "Total return", value: result.summary.strategy.total_return, percent: true }, { label: "CAGR", value: result.summary.strategy.cagr, percent: true },
        { label: "Sharpe ratio", value: result.summary.strategy.sharpe }, { label: "Reported alpha total", value: result.summary.alpha_total_return, percent: true },
        { label: "Volatility", value: result.summary.strategy.volatility, percent: true }, { label: "Max drawdown", value: result.summary.strategy.max_drawdown, percent: true },
        { label: "Benchmark return", value: result.summary.benchmark?.total_return, percent: true }, { label: "Latest rebalance assets", value: latest ? Object.keys(latest.weights).length : null, digits: 0 },
      ]} />
      <TerminalPanel title="Equity Curve Simulation" subtitle="Returned strategy and benchmark indices; initial capital is normalized to 1">
        {result.equity_curve.length ? <div role="img" aria-label="Framework equity curve" className="h-80 min-w-0"><ResponsiveContainer><LineChart data={result.equity_curve} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="#374151" /><XAxis tick={{ fill: "#9ca3af" }} dataKey="date" fontSize={12} minTickGap={40} /><YAxis tick={{ fill: "#9ca3af" }} fontSize={12} width={56} domain={["auto", "auto"]} /><Tooltip contentStyle={{ backgroundColor: "#111827", borderColor: "#4b5563", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 12 }} /><Line isAnimationActive={false} strokeWidth={2} type="monotone" dataKey="strategy" name="Strategy" stroke="#3b82f6" dot={false} />{result.equity_curve.some(point => point.benchmark != null) && <Line isAnimationActive={false} type="monotone" dataKey="benchmark" name="Benchmark" stroke="#9ca3af" strokeDasharray="4 4" dot={false} />}</LineChart></ResponsiveContainer></div> : <p className="p-3 text-sm text-terminal-muted">No equity observations returned.</p>}
        <details className="mt-3"><summary className="cursor-pointer text-sm">Exact equity observations</summary><div className="mt-3"><AnalyticsTable name="Framework equity values" headers={["Date", "Strategy index", "Benchmark index"]} rows={result.equity_curve.map(point => [point.date, researchNumber(point.strategy, 6), researchNumber(point.benchmark, 6)])} /></div></details>
      </TerminalPanel>
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 2xl:grid-cols-2">
        <TerminalPanel title="Latest simulated holdings" subtitle={latest ? `Rebalanced ${latest.rebalance_date} · turnover ${researchNumber(latest.turnover, 1, true)}` : "No rebalance returned"}><AnalyticsTable name="Framework latest holdings" headers={["Symbol", "Weight"]} rows={Object.entries(latest?.weights || {}).sort((a, b) => b[1] - a[1]).map(([symbol, weight]) => [symbol, researchNumber(weight, 4, true)])} /></TerminalPanel>
        <TerminalPanel title="Strategy Insights" subtitle={`Latest response · first ${Math.min(result.insights.length, 200)} of ${result.insights.length} signals`}><AnalyticsTable name="Framework signal values" headers={["Date", "Symbol", "Direction", "Confidence", "Magnitude"]} rows={result.insights.slice(0, 200).map(row => [row.date, row.symbol, typeof row.direction !== "number" || !Number.isFinite(row.direction) ? "Unavailable" : row.direction > 0 ? "Up" : row.direction < 0 ? "Down" : "Flat", researchNumber(row.confidence, 1, true), researchNumber(row.magnitude, 6)])} /></TerminalPanel>
      </div>
      <details className="rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">All returned rebalances</summary><div className="mt-3"><AnalyticsTable name="Framework rebalance values" headers={["Rebalance date", "Symbol", "Weight", "Turnover"]} rows={result.holdings.flatMap(holding => Object.entries(holding.weights).map(([symbol, weight]) => [holding.rebalance_date, symbol, researchNumber(weight, 4, true), researchNumber(holding.turnover, 2, true)]))} /></div></details>
    </>}
  </ResearchWorkspace>;
}
