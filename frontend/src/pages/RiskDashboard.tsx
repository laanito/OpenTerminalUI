import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, ErrorBar, Legend, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchFactorAttribution, fetchFactorExposures, fetchFactorHistory, fetchFactorReturns, fetchRiskCorrelation, fetchRiskExposures, fetchRiskInsights, fetchRiskSummary, fetchSectorConcentration } from "../api/client";
import { ExposureHeatmap } from "../components/dashboard/ExposureHeatmap";
import { StressTestPanel } from "../components/risk/StressTestPanel";
import { finite, RiskPanel, RiskTable, riskNumber, riskPercent, useRiskRead } from "../components/risk/RiskRead";
import { AiInsightCard } from "../components/terminal/AiInsightCard";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { useStockStore } from "../store/stockStore";
import type { PortfolioItem } from "../types";

const COLORS = ["#26A65B", "#E84142", "#F39C12", "#5B8FF9", "#9B59B6", "#E67E22"];
const FACTORS = ["market", "size", "value", "momentum", "quality", "low_vol"] as const;
const LABELS = ["Market", "Size", "Value", "Momentum", "Quality", "Low volatility"];
const PERIODS = ["3M", "6M", "1Y", "3Y"] as const;
const tooltipStyle = { backgroundColor: "#0D1117", border: "1px solid #263040", fontSize: 12 };
const signed = (value: unknown) => finite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}` : "Unavailable";

function Overview({ ticker }: { ticker?: string }) {
  const scope = ticker || "portfolio";
  const summary = useRiskRead(scope, () => fetchRiskSummary(ticker));
  const exposure = useRiskRead(scope, () => fetchRiskExposures(ticker));
  const correlation = useRiskRead(scope, () => fetchRiskCorrelation(ticker));
  const classification = useRiskRead(scope, () => fetchSectorConcentration(ticker));
  const sectors = Object.entries(classification.data?.sectors || {}).map(([name, value]) => ({ name, value: finite(value) ? value : null }));
  const pca = (exposure.data?.pca_factors || []).map((row: any) => ({ name: row.factor, variance: finite(row.variance_explained) ? Number((row.variance_explained * 100).toFixed(1)) : null }));
  const assets: string[] = correlation.data?.assets || [];
  const matrix: unknown[][] = correlation.data?.matrix || [];
  const completeMatrix = assets.length > 0 && matrix.length === assets.length && matrix.every(row => row.length === assets.length && row.every(finite));
  const heatmapItems = sectors.filter(row => finite(row.value)).map((row, i) => ({ id: String(i), ticker: row.name, quantity: 0, avg_buy_price: 0, buy_date: "", sector: row.name, current_price: null, current_value: row.value, pnl: null, exchange: ticker ? undefined : "PORTFOLIO" })) as PortfolioItem[];
  return <div className="min-w-0 space-y-4">
    <p className="text-xs text-terminal-muted">{ticker ? `${ticker} and service-selected peers` : "Current portfolio symbols"} · overview uses the service’s equal-weighted model, not transaction-weighted portfolio returns.</p>
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <RiskPanel title="Statistical risk metrics" read={summary}>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded border border-terminal-border p-3"><p className="text-xs text-terminal-muted">EWMA volatility</p><p className="mt-2 text-2xl tabular-nums">{finite(summary.data?.ewma_vol) ? `${(summary.data.ewma_vol * 100).toFixed(2)}%` : "Unavailable"}</p></div>
          <div className="rounded border border-terminal-border p-3"><p className="text-xs text-terminal-muted">Systematic beta</p><p className="mt-2 text-2xl tabular-nums">{riskNumber(summary.data?.beta)}</p></div>
        </div>
        <p className="mb-2 text-sm">Marginal contribution to risk</p>
        {Object.keys(summary.data?.marginal_contribution || {}).length ? <RiskTable compact name="Marginal risk contributions" headers={["Asset", "Contribution"]} rows={Object.entries(summary.data.marginal_contribution).map(([asset, value]) => [asset, riskNumber(value, 4)])} /> : <p className="text-sm text-terminal-muted">No asset contributions returned. Zero summary values alone do not establish sufficient history.</p>}
      </RiskPanel>
      <RiskPanel title="PCA factor exposures" subtitle="Reported variance decomposition" read={exposure} empty={!pca.length}>
        <div className="h-64 min-w-0" role="img" aria-label="PCA variance chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={pca}><CartesianGrid stroke="#263040" vertical={false} /><XAxis tick={{ fill: "var(--ot-color-text-muted)" }} dataKey="name" fontSize={12} /><YAxis tick={{ fill: "var(--ot-color-text-muted)" }} fontSize={12} unit="%" /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="variance" name="Variance (%)" fill="#5B8FF9" isAnimationActive={false} /></BarChart></ResponsiveContainer></div>
        <RiskTable name="PCA variance values" headers={["Factor", "Variance (%)"]} rows={pca.map((row: any) => [row.name, riskNumber(row.variance, 1)])} />
      </RiskPanel>
    </div>
    <RiskPanel title="Reported classification share" subtitle="The service groups country metadata and counts symbols here; these are not market-value sector weights" read={classification} empty={!sectors.length}>
      <div className="grid min-w-0 grid-cols-1 items-center gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="h-60 min-w-0" role="img" aria-label="Reported classification share chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={sectors.filter(row => finite(row.value))} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} isAnimationActive={false}>{sectors.map((row, index) => <Cell key={row.name} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip contentStyle={tooltipStyle} /></PieChart></ResponsiveContainer></div>
        <RiskTable name="Reported classification values" headers={["Reported group", "Share (%)"]} rows={sectors.map(row => [row.name, finite(row.value) ? `${row.value.toFixed(2)}%` : "Unavailable"])} />
      </div>
    </RiskPanel>
    <RiskPanel title="Correlation dynamics" subtitle="Pairwise matrix · up to 60 observations, subject to service coverage" read={correlation} empty={!assets.length}>
      <RiskTable name="Risk correlation matrix" headers={["Asset", ...assets]} rows={assets.map((asset, i) => [asset, ...assets.map((_, j) => riskNumber(matrix[i]?.[j]))])} />
    </RiskPanel>
    <details className="min-w-0 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Exposure summary preview</summary><div className="mt-3 min-w-0">
      {completeMatrix || sectors.some(row => finite(row.value)) ? <><p className="mb-3 text-xs text-terminal-muted">Derived from the reported groups and matrix above, not a separate instrument/currency exposure analysis.</p><ExposureHeatmap title="Risk exposure preview" market={ticker || "PORTFOLIO"} items={heatmapItems} correlation={completeMatrix ? correlation.data : null} defaultMode={completeMatrix ? "correlation" : "sector"} /></> : <p className="text-sm text-terminal-muted">Load classifications or a complete matrix to inspect this preview.</p>}
    </div></details>
    <details className="min-w-0 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">AI risk insights</summary><div className="mt-3 min-w-0"><AiInsightCard key={`${scope}:${summary.revision}:${correlation.revision}`} title="AI Risk Insights" description={`${ticker || "Current portfolio"} · on-demand interpretation of the loaded summary and correlation scope`} disabled={!summary.data || summary.loading || !Object.keys(summary.data?.marginal_contribution || {}).length || !assets.length || correlation.loading} disabledMessage="Load usable summary contributions and correlation assets before requesting insights." fetcher={(_, options) => fetchRiskInsights(ticker ? `${ticker} and peers` : "the portfolio", { ...summary.data, correlation_assets: correlation.data?.assets }, options)} /></div></details>
  </div>;
}

function Factors({ period }: { period: string }) {
  const exposure = useRiskRead("current:1Y", () => fetchFactorExposures("current"));
  const attribution = useRiskRead(`current:${period}`, () => fetchFactorAttribution("current", period));
  const history = useRiskRead(`current:${period}:60`, () => fetchFactorHistory("current", period, 60));
  const returns = useRiskRead(period, () => fetchFactorReturns(period));
  const [hidden, setHidden] = useState<string[]>([]);
  const loadings = FACTORS.map((key, i) => {
    const row = exposure.data?.exposures?.[key];
    const value = row?.exposure;
    const ci = finite(value) && finite(row?.confidence) ? Math.max(0.05, Math.abs(value) * (1 - Math.min(row.confidence, 0.95))) : null;
    return { key, label: LABELS[i], exposure: finite(value) ? value : null, t: row?.t_stat, confidence: row?.confidence, confidenceInterval: ci === null ? null : [ci, ci] };
  });
  const size = exposure.data?.exposures?.size?.exposure, value = exposure.data?.exposures?.value?.exposure;
  const style = finite(size) && finite(value) ? { row: size > .35 ? "Small" : size < -.35 ? "Large" : "Mid", column: value > .35 ? "Value" : value < -.35 ? "Growth" : "Blend" } : null;
  const waterfall = useMemo(() => {
    const data = attribution.data;
    if (!data || !FACTORS.every(key => finite(data.factor_contributions?.[key])) || !finite(data.alpha) || !finite(data.total_return)) return [];
    let running = 0;
    const values = [...FACTORS.map((key, i) => ({ key, label: LABELS[i], value: data.factor_contributions[key] })), { key: "alpha", label: "Alpha", value: data.alpha }];
    const rows = values.map(row => { const start = running; running += row.value; return { ...row, offset: Math.min(start, running), contribution: Math.abs(row.value), runningTotal: running }; });
    return [...rows, { key: "total", label: "Total", value: data.total_return, offset: 0, contribution: Math.abs(data.total_return), runningTotal: data.total_return }];
  }, [attribution.data]);
  const rolling = useMemo(() => {
    const map = new Map<string, Record<string, any>>();
    FACTORS.forEach(key => (history.data?.series?.[key] || []).forEach((row: any) => { const item = map.get(row.date) || { date: row.date }; item[key] = finite(row.exposure) ? row.exposure : null; map.set(row.date, item); }));
    return Array.from(map.values());
  }, [history.data]);
  const marketReturns = returns.data?.factors?.market;
  const marketSum = Array.isArray(marketReturns) && marketReturns.length && marketReturns.every(row => finite(row.return)) ? marketReturns.reduce((sum, row) => sum + row.return, 0) : null;
  return <div className="min-w-0 space-y-4">
    <p className="text-xs text-terminal-muted">Current portfolio · attribution, rolling history and factor returns: {period}. Exposure/style uses the endpoint’s fixed 1Y context. Rolling window: 60 observations.</p>
    <RiskPanel title="Factor exposures and style" subtitle="Illustrative confidence whiskers use the retained client heuristic; they are not statistical confidence bounds" read={exposure} empty={!Object.keys(exposure.data?.exposures || {}).length}>
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="h-80 min-w-0" role="img" aria-label="Factor loading chart" data-testid="factor-exposure-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={loadings.filter(row => row.exposure !== null)} layout="vertical" margin={{ left: 8, right: 24 }}><CartesianGrid stroke="#263040" horizontal={false} /><XAxis tick={{ fill: "var(--ot-color-text-muted)" }} domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]} type="number" fontSize={12} /><YAxis tick={{ fill: "var(--ot-color-text-muted)" }} type="category" dataKey="label" width={100} fontSize={12} /><Tooltip contentStyle={tooltipStyle} /><ReferenceLine x={0} stroke="#8e98a8" /><Bar dataKey="exposure" fill="#5B8FF9" isAnimationActive={false}>{loadings.filter(row => row.exposure !== null).map(row => <Cell key={row.key} fill={row.exposure! >= 0 ? "#5B8FF9" : "#F39C12"} />)}<ErrorBar dataKey="confidenceInterval" width={4} stroke="#8e98a8" /></Bar></BarChart></ResponsiveContainer></div>
        <div className="min-w-0 space-y-3"><p className="text-sm">Size / value style</p>{style ? <><div data-testid="factor-style-box" className="grid grid-cols-3 gap-1 text-center text-xs">{["Small", "Mid", "Large"].flatMap(row => ["Value", "Blend", "Growth"].map(column => <div key={`${row}:${column}`} className={`min-w-0 break-words rounded border px-1 py-3 ${style.row === row && style.column === column ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}>{row}<br />{column}</div>))}</div><p className="text-sm text-terminal-accent">Current positioning: {style.row} / {style.column}</p></> : <p className="text-sm text-terminal-muted">Style unavailable: both size and value exposures are required.</p>}</div>
      </div>
      <RiskTable name="Factor loading values" headers={["Factor", "Exposure", "T-statistic", "Confidence score"]} rows={loadings.map(row => [row.label, signed(row.exposure), signed(row.t), riskNumber(row.confidence)])} />
    </RiskPanel>
    <RiskPanel title="Return attribution" subtitle={`${period} · retained waterfall decomposition`} read={attribution} empty={!attribution.data || !Object.keys(attribution.data).length}>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">{[["Total return", riskPercent(attribution.data?.total_return)], ["Alpha", riskPercent(attribution.data?.alpha)], ["R-squared", finite(attribution.data?.r_squared) ? `${(attribution.data.r_squared * 100).toFixed(1)}%` : "Unavailable"]].map(([label, result]) => <div key={label} className="min-w-0 rounded border border-terminal-border p-3"><p className="text-xs text-terminal-muted">{label}</p><p className="mt-2 break-words text-xl tabular-nums">{result}</p></div>)}</div>
      {waterfall.length ? <div className="h-80 min-w-0" role="img" aria-label="Return attribution waterfall" data-testid="factor-waterfall-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={waterfall}><CartesianGrid stroke="#263040" vertical={false} /><XAxis tick={{ fill: "var(--ot-color-text-muted)" }} dataKey="label" fontSize={12} minTickGap={20} /><YAxis tick={{ fill: "var(--ot-color-text-muted)" }} fontSize={12} tickFormatter={value => `${(Number(value) * 100).toFixed(1)}%`} /><Tooltip contentStyle={tooltipStyle} formatter={(_, key, item: any) => key === "contribution" ? [riskPercent(item.payload.value), item.payload.label] : key === "runningTotal" ? [riskPercent(item.payload.runningTotal), "Running total"] : ["", ""]} /><ReferenceLine y={0} stroke="#8e98a8" /><Bar dataKey="offset" stackId="waterfall" fill="transparent" tooltipType="none" isAnimationActive={false} /><Bar dataKey="contribution" stackId="waterfall" isAnimationActive={false}>{waterfall.map(row => <Cell key={row.key} fill={row.key === "total" ? "#5B8FF9" : row.value >= 0 ? "#26A65B" : "#E84142"} />)}</Bar><Line dataKey="runningTotal" stroke="#8e98a8" isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div> : <p className="mb-3 text-sm text-terminal-muted">Attribution is incomplete; no partial waterfall is shown.</p>}
      <RiskTable name="Factor return contributions" headers={["Component", "Contribution"]} rows={[...FACTORS.map((key, i) => [LABELS[i], riskPercent(attribution.data?.factor_contributions?.[key])]), ["Alpha", riskPercent(attribution.data?.alpha)], ["Total", riskPercent(attribution.data?.total_return)]]} />
    </RiskPanel>
    <RiskPanel title="Market factor return series" subtitle={`${period} · sum of daily returns, not a compounded return`} read={returns} empty={!marketReturns?.length}><p className="mb-3 text-2xl tabular-nums">{riskPercent(marketSum)}</p><details><summary className="cursor-pointer text-sm">Exact market factor values</summary><div className="mt-3"><RiskTable name="Market factor returns" headers={["Date", "Daily return"]} rows={(marketReturns || []).map((row: any) => [row.date, riskPercent(row.return)])} /></div></details></RiskPanel>
    <RiskPanel title="Rolling factor exposures" subtitle={`${period} · 60-observation betas`} read={history} empty={!rolling.length}>
      <fieldset className="mb-3 flex flex-wrap gap-x-4 gap-y-2"><legend className="mb-2 text-xs text-terminal-muted">Visible factors</legend>{FACTORS.map((key, i) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!hidden.includes(key)} onChange={() => setHidden(old => old.includes(key) ? old.filter(item => item !== key) : [...old, key])} />{LABELS[i]}</label>)}</fieldset>
      <div className="h-80 min-w-0" role="img" aria-label="Rolling factor exposure chart" data-testid="factor-history-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={rolling}><CartesianGrid stroke="#263040" vertical={false} /><XAxis tick={{ fill: "var(--ot-color-text-muted)" }} dataKey="date" fontSize={12} minTickGap={30} /><YAxis tick={{ fill: "var(--ot-color-text-muted)" }} fontSize={12} /><Tooltip contentStyle={tooltipStyle} /><Legend wrapperStyle={{ fontSize: 12 }} /><ReferenceLine y={0} stroke="#8e98a8" />{FACTORS.map((key, i) => hidden.includes(key) ? null : <Line key={key} type="monotone" dataKey={key} name={LABELS[i]} stroke={COLORS[i]} dot={false} isAnimationActive={false} />)}</LineChart></ResponsiveContainer></div>
      <details><summary className="cursor-pointer text-sm">Exact rolling values</summary><div className="mt-3"><RiskTable name="Rolling exposure values" headers={["Date", ...LABELS]} rows={rolling.map(row => [row.date, ...FACTORS.map(key => signed(row[key]))])} /></div></details>
    </RiskPanel>
  </div>;
}

export function RiskDashboardPage() {
  const storeTicker = useStockStore(state => state.ticker);
  const [tab, setTab] = useState<"overview" | "factors" | "stress">("overview");
  const [mode, setMode] = useState("portfolio");
  const [draft, setDraft] = useState(storeTicker);
  const [ticker, setTicker] = useState(storeTicker);
  const [period, setPeriod] = useState("1Y");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(storeTicker); setTicker(storeTicker); }, [storeTicker]);
  return <main aria-label="Risk workspace" className="min-w-0 space-y-4 p-3 text-terminal-text sm:p-4">
    <header className="space-y-2"><h1 className="text-lg font-semibold">Risk analytics</h1><p className="text-sm text-terminal-muted">Review observed risk, factor attribution or a hypothetical portfolio stress run.</p></header>
    <nav aria-label="Risk views" className="flex flex-wrap gap-2">{(["overview", "factors", "stress"] as const).map((key, i) => <TerminalButton key={key} type="button" aria-pressed={key === tab} disabled={busy} variant={tab === key ? "accent" : "default"} onClick={() => setTab(key)} className="normal-case tracking-normal">{["Overview", "Factor attribution", "Stress test"][i]}</TerminalButton>)}</nav>
    {tab === "overview" && <form aria-label="Risk overview scope" className="flex flex-wrap items-end gap-3 rounded border border-terminal-border bg-terminal-panel p-3" onSubmit={event => { event.preventDefault(); if (draft.trim()) setTicker(draft.trim().toUpperCase()); }}>
      <label className="min-w-0 flex-1 basis-52 space-y-2 text-xs">Risk scope<TerminalInput as="select" className="block text-sm" value={mode} onChange={event => setMode(event.target.value)}><option value="portfolio">Current portfolio</option><option value="ticker">Ticker and peers</option></TerminalInput></label>
      {mode === "ticker" && <><label className="min-w-0 flex-1 basis-52 space-y-2 text-xs">Risk ticker<TerminalInput className="block text-sm" value={draft} required maxLength={80} onChange={event => setDraft(event.target.value)} /></label><TerminalButton type="submit" disabled={!draft.trim()} className="normal-case tracking-normal">Apply ticker</TerminalButton></>}
      <p className="w-full break-words text-xs text-terminal-muted">Applied scope: {mode === "ticker" ? `${ticker} and peers` : "current portfolio"}. Other views always use the service’s current portfolio.</p>
    </form>}
    {tab === "factors" && <label className="block max-w-sm space-y-2 text-xs">Attribution and history period<TerminalInput as="select" value={period} onChange={event => setPeriod(event.target.value)} className="block text-sm">{PERIODS.map(item => <option key={item}>{item}</option>)}</TerminalInput></label>}
    {tab === "overview" ? <Overview key={mode === "ticker" ? ticker : "portfolio"} ticker={mode === "ticker" ? ticker : undefined} /> : tab === "factors" ? <Factors period={period} /> : <StressTestPanel onBusyChange={setBusy} />}
    <details className="min-w-0 rounded border border-terminal-border p-3 text-sm"><summary className="cursor-pointer">Model scope and limits</summary><div className="mt-3 space-y-2 text-sm text-terminal-muted"><p>These are existing service models, not verified trading or accounting results. Overview uses equal-weighted symbols and a simplified beta benchmark; history alignment, coverage and zero sentinels need validation. No response freshness metadata is provided.</p><p>Factor exposures use a fixed 1Y context. Attribution and rolling exposures use the chosen period; the market factor snapshot sums daily returns. Whiskers use an illustrative client heuristic.</p><p>Stress tests use the service’s current holdings and stored purchase-cost values, with inferred classifications. Currency conversion is not established. The FX shock retains the legacy INR factor. The separate Monte Carlo simulation is not conditioned on the selected scenario.</p><p>Run history is a legacy process-local service list; it is not a durable personal journal. Calculation, provider, currency and ownership coverage require the v5 functionality audit.</p></div></details>
  </main>;
}
