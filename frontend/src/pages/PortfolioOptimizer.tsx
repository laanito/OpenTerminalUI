import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { fetchOptimizerMethods, runOptimize, type OptimizeRequest } from "../api/portfolioOptimizer";
import { CatalogueStatus, ResearchChoice, ResearchField, ResearchMetrics, ResearchNumber, ResearchStatus, ResearchWorkspace, researchNumber, useResearchRun } from "../components/backtesting/ResearchWorkflow";
import { AnalyticsTable } from "../components/terminal/AnalyticsRead";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalButton } from "../components/terminal/TerminalButton";

export function PortfolioOptimizer() {
  const [tickers, setTickers] = useState("AAPL,MSFT,GOOGL,AMZN,NVDA,META");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [model, setModel] = useState("");
  const [objective, setObjective] = useState("");
  const [riskMeasure, setRiskMeasure] = useState("");
  const [covMethod, setCovMethod] = useState("sample");
  const [confidence, setConfidence] = useState(0.95);
  const [riskFreeRate, setRiskFreeRate] = useState(0);
  const [riskAversion, setRiskAversion] = useState(2);
  const [minWeight, setMinWeight] = useState(0);
  const [maxWeight, setMaxWeight] = useState(1);
  const catalogue = useQuery({ queryKey: ["optimizer-methods"], queryFn: fetchOptimizerMethods, retry: false });
  const methods = catalogue.data;
  const run = useResearchRun(runOptimize, "Optimization failed.");
  useEffect(() => {
    if (!methods) return;
    if (!model && methods.models?.length) setModel(methods.models[0].id);
    if (!objective && methods.objectives?.length) setObjective(methods.objectives[0].id);
    if (!riskMeasure && methods.risk_measures?.length) setRiskMeasure(methods.risk_measures[0].id);
    if (!covMethod && methods.covariance_methods?.length) setCovMethod(methods.covariance_methods[0].id);
  }, [methods, model, objective, riskMeasure, covMethod]);
  const symbols = tickers.split(",").map(symbol => symbol.trim()).filter(Boolean);
  const managedObjective = model === "HRP" || model === "HERC" || model === "RP";
  const available = Boolean(methods?.models?.some(item => item.id === model) && methods?.objectives?.some(item => item.id === objective) && methods?.risk_measures?.some(item => item.id === riskMeasure) && methods?.covariance_methods?.some(item => item.id === covMethod));
  const valid = available && symbols.length >= 2 && (!startDate || !endDate || startDate <= endDate) && [confidence, riskFreeRate, riskAversion, minWeight, maxWeight].every(Number.isFinite) && confidence >= 0.5 && confidence <= 0.999 && minWeight <= maxWeight;
  const submit = () => {
    if (!valid || run.pending) return;
    const request: OptimizeRequest = { tickers: symbols, start: startDate || null, end: endDate || null, model, objective, risk_measure: riskMeasure, cov_method: covMethod, confidence, risk_free_rate: riskFreeRate, risk_aversion: riskAversion, min_weight: minWeight, max_weight: maxWeight };
    void run.run(request);
  };
  const result = run.data, submitted = run.input;
  const emptyCatalogue = !methods?.models?.length || !methods?.objectives?.length || !methods?.risk_measures?.length || !methods?.covariance_methods?.length;
  return <ResearchWorkspace title="Portfolio Optimizer" path="/backtesting/portfolio-optimizer" description="Explore historical portfolio weights, risk contributions and the returned efficient frontier.">
    <CatalogueStatus pending={catalogue.isPending} failed={catalogue.isError} empty={emptyCatalogue} retry={() => void catalogue.refetch()} />
    {methods && !catalogue.isError && <details open className="rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Optimization setup</summary><form onSubmit={event => { event.preventDefault(); submit(); }} className="mt-3 min-w-0 space-y-3">
      <TerminalPanel title="Universe" subtitle="At least two comma-separated tickers; blank dates use service defaults">
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
          <ResearchField label="Universe (Tickers)"><TerminalInput className="min-w-0 text-sm" value={tickers} onChange={event => setTickers(event.target.value)} /></ResearchField>
          <ResearchField label="Start date"><TerminalInput className="min-w-0 text-sm" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></ResearchField>
          <ResearchField label="End date"><TerminalInput className="min-w-0 text-sm" type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></ResearchField>
        </div>
      </TerminalPanel>
      <TerminalPanel title="Model & Objective" subtitle="Available service models; selected names stay readable below each control">
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ResearchChoice label="Model" value={model} onChange={setModel} items={methods.models || []} />
          <ResearchChoice label="Covariance estimator" value={covMethod} onChange={setCovMethod} items={methods.covariance_methods || []} />
          <ResearchChoice label="Objective" value={objective} onChange={setObjective} items={methods.objectives || []} disabled={managedObjective} />
          <ResearchChoice label="Risk measure" value={riskMeasure} onChange={setRiskMeasure} items={methods.risk_measures || []} disabled={managedObjective} />
        </div>
        {managedObjective && <p className="mt-2 text-xs text-terminal-muted">{model} manages objective and risk measure internally. The disabled selections are retained when this model is submitted.</p>}
      </TerminalPanel>
      <details className="rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Constraints and risk settings</summary><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ResearchNumber label="Minimum weight (fraction)" value={minWeight} onChange={setMinWeight} />
        <ResearchNumber label="Maximum weight (fraction)" value={maxWeight} onChange={setMaxWeight} />
        <ResearchNumber label="Confidence (fraction)" value={confidence} min={0.5} max={0.999} onChange={setConfidence} />
        <ResearchNumber label="Risk-free rate (fraction)" value={riskFreeRate} onChange={setRiskFreeRate} />
        <ResearchNumber label="Risk aversion" value={riskAversion} onChange={setRiskAversion} />
      </div><p className="mt-2 text-xs text-terminal-muted">A fraction of 0.25 is 25%. Confidence must be 0.5–0.999; weights must be ordered. Feasibility is checked by the optimization service.</p></details>
      <TerminalButton type="submit" variant="accent" disabled={!valid} loading={run.pending}>{run.pending ? "Optimizing…" : "Run Optimize"}</TerminalButton>
      {!valid && <p className="text-xs text-terminal-warning">Choose available methods and at least two tickers. Check date order, finite numeric settings, confidence and weight bounds.</p>}
    </form></details>}
    {submitted && <section aria-label="Submitted optimizer setup" className="space-y-1 rounded border border-terminal-border p-3 text-xs text-terminal-muted"><p className="text-sm text-terminal-text">Submitted universe: {submitted.tickers.join(", ")}</p><p>{submitted.start || "Service default start"} to {submitted.end || "Service default end"} · model {submitted.model} · objective {submitted.objective} · risk {submitted.risk_measure} · covariance {submitted.cov_method}</p><p>Weights {submitted.min_weight} to {submitted.max_weight} · confidence {researchNumber(submitted.confidence, 1, true)} · risk-free rate {submitted.risk_free_rate} · risk aversion {submitted.risk_aversion}</p><p>Editing setup prepares the next run; results belong to this submission.</p></section>}
    <ResearchStatus phase={run.phase} error={run.error} idle="Configure a universe and methods, then run an optimization to inspect its output." pending="Optimizing the submitted universe and constraints…" />
    {result && <>
      <p className="text-xs text-terminal-muted">Returned model: {result.model || "Not supplied"} · objective: {result.objective || "Not supplied"} · risk measure: {result.risk_measure || "Not supplied"}. These are research weights, not changes to your portfolios.</p>
      <ResearchMetrics items={[
        { label: "Expected return", value: result.metrics.expected_return, percent: true }, { label: "Volatility", value: result.metrics.volatility, percent: true },
        { label: "Sharpe ratio", value: result.metrics.sharpe }, { label: "Sortino ratio", value: result.metrics.sortino },
        { label: "Max drawdown", value: result.metrics.max_drawdown, percent: true }, { label: `CVaR · submitted confidence ${researchNumber(submitted?.confidence, 1, true)}`, value: result.metrics.cvar, percent: true },
        { label: "Ulcer index", value: result.metrics.ulcer_index }, { label: "CDaR", value: result.metrics.cdar, percent: true },
      ]} />
      <TerminalPanel title="Efficient Frontier" subtitle="Horizontal: volatility · vertical: return · both in percent">
        {result.frontier.length ? <div role="img" aria-label="Optimizer efficient frontier" className="h-80 min-w-0"><ResponsiveContainer><ScatterChart margin={{ top: 12, right: 16, left: 0, bottom: 12 }}><CartesianGrid strokeDasharray="3 3" stroke="#374151" /><XAxis tick={{ fill: "#9ca3af" }} type="number" dataKey="risk" name="Volatility" fontSize={12} tickFormatter={value => `${(value * 100).toFixed(0)}%`} /><YAxis tick={{ fill: "#9ca3af" }} type="number" dataKey="return" name="Return" width={60} fontSize={12} tickFormatter={value => `${(value * 100).toFixed(0)}%`} /><ZAxis type="number" range={[50, 400]} /><Tooltip contentStyle={{ backgroundColor: "#111827", borderColor: "#4b5563", fontSize: 12 }} formatter={value => researchNumber(value, 2, true)} /><Scatter isAnimationActive={false} name="Frontier" data={result.frontier} fill="#9ca3af" line shape="circle" /><Scatter isAnimationActive={false} name="Selected" data={result.selected_point ? [result.selected_point] : []} fill="#3b82f6"><Cell fill="#3b82f6" stroke="#fff" strokeWidth={2} /></Scatter></ScatterChart></ResponsiveContainer></div> : <p className="p-3 text-sm text-terminal-muted">No frontier points returned.</p>}
        <p className="mt-2 text-xs text-terminal-muted">Selected point · volatility {researchNumber(result.selected_point?.risk, 2, true)} · return {researchNumber(result.selected_point?.return, 2, true)}.</p>
        <details className="mt-3"><summary className="cursor-pointer text-sm">Exact frontier values</summary><div className="mt-3"><AnalyticsTable name="Optimizer frontier values" headers={["Point", "Volatility", "Return", "Sharpe"]} rows={result.frontier.map((point, index) => [index + 1, researchNumber(point.risk, 6, true), researchNumber(point.return, 6, true), researchNumber(point.sharpe, 6)])} /></div></details>
      </TerminalPanel>
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 2xl:grid-cols-2">
        <TerminalPanel title="Optimal Allocation" subtitle="All returned weights, including zero, small and negative values"><AnalyticsTable name="Optimizer allocation values" headers={["Symbol", "Weight"]} rows={Object.entries(result.weights).sort((a, b) => b[1] - a[1]).map(([symbol, weight]) => [symbol, researchNumber(weight, 6, true)])} /></TerminalPanel>
        <TerminalPanel title="Risk Contribution" subtitle="Returned component risk shares"><AnalyticsTable name="Optimizer risk contributions" headers={["Symbol", "Risk contribution"]} rows={Object.entries(result.risk_contributions).sort((a, b) => b[1] - a[1]).map(([symbol, share]) => [symbol, researchNumber(share, 6, true)])} /></TerminalPanel>
      </div>
      {!!result.clusters?.groups?.length && <TerminalPanel title="Cluster Structure" subtitle="Returned hierarchical groups in service leaf order"><div className="space-y-3">{result.clusters.groups.map(group => <section key={group.id} aria-label={`Cluster ${group.id}`} className="rounded border border-terminal-border p-3"><h2 className="text-sm text-terminal-accent">Cluster {group.id}</h2><ul className="mt-2 flex flex-wrap gap-2 text-sm">{[...group.symbols].sort((a, b) => (result.clusters?.leaf_order.indexOf(a) ?? 0) - (result.clusters?.leaf_order.indexOf(b) ?? 0)).map(symbol => <li key={symbol} className="max-w-full break-words rounded border border-terminal-border px-2 py-1">{symbol}</li>)}</ul></section>)}</div></TerminalPanel>}
      <TerminalPanel title="Per-Asset Metrics" subtitle="Individual returned performance"><AnalyticsTable name="Optimizer asset metrics" headers={["Symbol", "Annual return", "Annual volatility", "Weight"]} rows={result.asset_metrics.map(row => [row.symbol, researchNumber(row.annual_return, 4, true), researchNumber(row.annual_vol, 4, true), researchNumber(row.weight, 6, true)])} /></TerminalPanel>
    </>}
  </ResearchWorkspace>;
}
