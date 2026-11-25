import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fetchPredefinedStressScenarios,
  fetchStressScenarioHistory,
  runStressMonteCarlo,
  runStressScenario,
} from "../../api/client";
import { finite, RiskPanel, RiskTable, riskNumber, riskPercent, useRiskRead } from "./RiskRead";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalPanel } from "../terminal/TerminalPanel";

type ScenarioDescriptor = {
  id: string;
  name: string;
  description: string;
  severity: "medium" | "high" | "extreme";
  shocks: Record<string, number>;
};

type ScenarioResult = {
  scenario_name: string;
  total_impact_pct: number;
  total_impact_value: number;
  by_holding: Array<{
    symbol: string;
    sector: string;
    weight: number;
    current_value: number;
    impact_pct: number;
    impact_value: number;
    new_value: number;
  }>;
  by_sector: Array<{
    sector: string;
    weight: number;
    impact_pct: number;
    impact_value: number;
  }>;
  worst_holdings: Array<{
    symbol: string;
    sector: string;
    current_value: number;
    impact_pct: number;
    impact_value: number;
  }>;
};

type MonteCarloResult = {
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  worst_case: number;
  best_case: number;
  paths: number[][];
};

type HistoryRow = {
  id: string;
  scenario_name: string;
  run_date: string;
  total_impact_pct: number;
};

type CustomShocks = {
  equity: number;
  rates: number;
  volatility: number;
  fx_inr: number;
  gold: number;
  crude_oil: number;
};

const DEFAULT_CUSTOM_SHOCKS: CustomShocks = {
  equity: -0.2,
  rates: 0,
  volatility: 0.1,
  fx_inr: 0,
  gold: 0,
  crude_oil: 0,
};

const HOLDING_COLORS = ["#E84142", "#F39C12", "#F7D154", "#26A65B", "#5B8FF9", "#9B59B6", "#1ABC9C"];
const PIE_COLORS = ["#E84142", "#F39C12", "#F7D154", "#5B8FF9", "#26A65B", "#9B59B6", "#1ABC9C"];

const FACTOR_SLIDERS: Array<{
  key: keyof CustomShocks;
  label: string;
  min: number;
  max: number;
  step: number;
  toStored: (value: number) => number;
  fromStored: (value: number) => number;
  format: (value: number) => string;
}> = [
  {
    key: "equity",
    label: "Equity",
    min: -50,
    max: 50,
    step: 1,
    toStored: (value) => value / 100,
    fromStored: (value) => value * 100,
    format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}%`,
  },
  {
    key: "rates",
    label: "Interest Rates",
    min: -500,
    max: 500,
    step: 25,
    toStored: (value) => value / 10000,
    fromStored: (value) => value * 10000,
    format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(0)} bps`,
  },
  {
    key: "volatility",
    label: "Volatility",
    min: -50,
    max: 50,
    step: 1,
    toStored: (value) => value / 100,
    fromStored: (value) => value * 100,
    format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}%`,
  },
  {
    key: "fx_inr",
    label: "FX (legacy INR)",
    min: -50,
    max: 50,
    step: 1,
    toStored: (value) => value / 100,
    fromStored: (value) => value * 100,
    format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}%`,
  },
  {
    key: "gold",
    label: "Gold",
    min: -50,
    max: 50,
    step: 1,
    toStored: (value) => value / 100,
    fromStored: (value) => value * 100,
    format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}%`,
  },
  {
    key: "crude_oil",
    label: "Crude",
    min: -50,
    max: 50,
    step: 1,
    toStored: (value) => value / 100,
    fromStored: (value) => value * 100,
    format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}%`,
  },
];

function formatCurrency(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildFanChart(paths: number[][]) {
  if (!paths.length) return [];
  const maxLength = Math.max(...paths.map((path) => path.length));
  const rows = [];
  for (let index = 0; index < maxLength; index += 1) {
    const points = paths.map((path) => path[index] ?? path[path.length - 1] ?? 0).sort((left, right) => left - right);
    const percentile = (ratio: number) => {
      const position = Math.max(0, Math.min(points.length - 1, Math.floor((points.length - 1) * ratio)));
      return points[position] ?? 0;
    };
    const p5 = percentile(0.05);
    const p25 = percentile(0.25);
    const p50 = percentile(0.5);
    const p75 = percentile(0.75);
    const p95 = percentile(0.95);
    rows.push({
      step: index,
      p5,
      p25,
      p50,
      p75,
      p95,
      band95Base: p5,
      band95Range: p95 - p5,
      band75Base: p25,
      band75Range: p75 - p25,
    });
  }
  return rows;
}

const money = (value: unknown) => finite(value) ? formatCurrency(value) : "Unavailable";
const chartTooltip = { backgroundColor: "#0D1117", border: "1px solid #263040", fontSize: 12 };

export function StressTestPanel({ onBusyChange }: { onBusyChange?: (busy: boolean) => void } = {}) {
  const library = useRiskRead<ScenarioDescriptor[]>("scenarios", fetchPredefinedStressScenarios);
  const history = useRiskRead<HistoryRow[]>("history", fetchStressScenarioHistory);
  const [selectedId, setSelectedId] = useState("gfc_2008");
  const [custom, setCustom] = useState<CustomShocks>(DEFAULT_CUSTOM_SHOCKS);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [simulation, setSimulation] = useState<MonteCarloResult | null>(null);
  const [applied, setApplied] = useState<{ name: string; shocks: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [runError, setRunError] = useState(false);
  const [simulationError, setSimulationError] = useState(false);
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onBusyChange?.(false); }; }, [onBusyChange]);
  const scenarios = Array.isArray(library.data) ? library.data : [];
  const selected = scenarios.find(row => row.id === selectedId);
  const isCustom = selectedId === "custom";
  useEffect(() => { if (!loading && scenarios.length && selectedId !== "custom" && !selected) setSelectedId(scenarios[0].id); }, [library.data, selectedId, loading]);
  const canRun = isCustom || Boolean(selected);
  const holdingChart = [...(result?.by_holding || [])].sort((a,b) => a.impact_pct - b.impact_pct).slice(0,10).map(row => ({ symbol: row.symbol, impactPct: finite(row.impact_pct) ? Number((row.impact_pct * 100).toFixed(2)) : null }));
  const sectors = [...(result?.by_sector || [])].sort((a,b) => Math.abs(b.impact_value) - Math.abs(a.impact_value)).map(row => ({ ...row, value: finite(row.impact_value) ? Math.abs(row.impact_value) : null }));
  const fan = useMemo(() => Array.isArray(simulation?.paths) && simulation.paths.length && simulation.paths.every(path => Array.isArray(path) && path.length && path.every(finite)) ? buildFanChart(simulation.paths) : [], [simulation]);

  async function run() {
    if (pending.current || !canRun) return;
    pending.current = true; setLoading(true); onBusyChange?.(true);
    const snapshot = { name: isCustom ? "Custom Scenario" : selected!.name, shocks: { ...(isCustom ? custom : selected!.shocks) } };
    setApplied(snapshot); setResult(null); setSimulation(null); setRunError(false); setSimulationError(false);
    const payload = { portfolio_id: "current", ...(isCustom ? { custom_shocks: snapshot.shocks } : { scenario_id: selectedId }) };
    // These outcomes are independent. A simulation/history read failure must not
    // erase a scenario that the service has already completed and recorded.
    await Promise.allSettled([
      Promise.resolve().then(() => runStressScenario(payload)).then(data => { if (mounted.current) { setResult(data); history.reload(); } }).catch(() => { if (mounted.current) setRunError(true); }),
      Promise.resolve().then(() => runStressMonteCarlo({ portfolio_id: "current", n_simulations: 1000 })).then(data => { if (mounted.current) setSimulation(data); }).catch(() => { if (mounted.current) setSimulationError(true); }),
    ]);
    pending.current = false;
    if (mounted.current) { setLoading(false); onBusyChange?.(false); }
  }

  return <section aria-label="Stress testing workspace" className="min-w-0 space-y-4">
    <TerminalPanel title="Stress scenario setup" subtitle="Current portfolio · hypothetical shocks, not orders or a forecast">
      <form aria-label="Stress scenario setup" className="space-y-4" onSubmit={event => { event.preventDefault(); void run(); }}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 basis-64 space-y-2 text-xs">Scenario<TerminalInput as="select" value={selectedId} disabled={loading} onChange={event => setSelectedId(event.target.value)} className="block text-sm">{scenarios.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}<option value="custom">Custom Scenario</option></TerminalInput></label>
          <TerminalButton type="submit" variant="accent" disabled={loading || !canRun} className="normal-case tracking-normal">{loading ? "Running analysis…" : "Run scenario"}</TerminalButton>
        </div>
        <p className="break-words text-sm text-terminal-muted">{isCustom ? "Set the six retained factor shocks below. Interest rates are in basis points; other shocks are percentages." : selected?.description || "Load the scenario library or choose a custom scenario."}</p>
        {isCustom && <fieldset disabled={loading} className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"><legend className="mb-3 text-sm">Custom factor shocks</legend>{FACTOR_SLIDERS.map(slider => <label key={slider.key} className="min-w-0 space-y-3 rounded border border-terminal-border p-3"><span className="flex flex-wrap justify-between gap-2 text-sm"><span>{slider.label}</span><output>{slider.format(slider.fromStored(custom[slider.key]))}</output></span><input aria-label={`${slider.label} shock`} type="range" className="block w-full accent-terminal-accent" min={slider.min} max={slider.max} step={slider.step} value={slider.fromStored(custom[slider.key])} onChange={event => setCustom(old => ({ ...old, [slider.key]: slider.toStored(Number(event.target.value)) }))} /></label>)}</fieldset>}
        {loading && <p role="status" className="text-sm">Running the captured setup. Controls are locked until both requests settle; no automatic retry.</p>}
      </form>
    </TerminalPanel>
    <details className="min-w-0 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Scenario library and assumptions</summary><div className="mt-3"><RiskPanel title="Predefined scenarios" read={library} empty={!scenarios.length}><div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">{scenarios.map(row => <article key={row.id} className="min-w-0 space-y-2 rounded border border-terminal-border p-3"><h3 className="break-words text-sm font-semibold">{row.name}</h3><p className="text-xs text-terminal-muted">Severity: {row.severity}</p><p className="break-words text-sm text-terminal-muted">{row.description}</p><TerminalButton type="button" disabled={loading} onClick={() => setSelectedId(row.id)} className="normal-case tracking-normal">Use {row.name}</TerminalButton></article>)}</div></RiskPanel></div></details>
    {library.failed && <p role="alert" className="text-sm text-terminal-neg">Scenario library unavailable. Open the library to refresh, or configure a custom scenario.</p>}
    {applied && <section aria-label="Captured stress run" className="min-w-0 space-y-3">
      <h2 className="break-words text-base font-semibold">Captured run · {applied.name}</h2>
      <p className="text-xs text-terminal-muted">Results below belong to this captured run. Editing setup does not change them. Reported monetary values have no currency metadata and use the service’s stored-cost valuation.</p>
      <details className="min-w-0 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Captured shocks</summary><div className="mt-3"><RiskTable name="Captured stress shocks" headers={["Service factor", "Stored shock (fraction)"]} rows={Object.entries(applied.shocks).map(([key,value]) => [key, riskNumber(value,4)])} /></div></details>
      {runError && <p role="alert" className="text-sm text-terminal-neg">Could not confirm the scenario result. The request may have completed; refresh run history before starting another run. No automatic retry was made.</p>}
      {result && <TerminalPanel title="Scenario impact" subtitle={result.scenario_name}>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="rounded border border-terminal-border p-3"><p className="text-xs text-terminal-muted">Portfolio impact</p><p className="mt-2 text-2xl tabular-nums">{riskPercent(result.total_impact_pct)}</p></div><div className="rounded border border-terminal-border p-3"><p className="text-xs text-terminal-muted">Reported impact value · currency unspecified</p><p className="mt-2 break-words text-2xl tabular-nums">{money(result.total_impact_value)}</p></div></div>
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="min-w-0"><h3 className="mb-3 text-sm">Impact by holding · ten lowest impacts</h3>{holdingChart.length ? <div className="h-80 min-w-0" data-testid="impact-by-holding-chart" role="img" aria-label="Holding impact chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={holdingChart} layout="vertical" margin={{ left: 0, right: 12 }}><CartesianGrid stroke="#263040" horizontal={false} /><XAxis tick={{ fill: "var(--ot-color-text-muted)" }} domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]} type="number" fontSize={12} unit="%" /><YAxis tick={{ fill: "var(--ot-color-text-muted)" }} dataKey="symbol" type="category" width={100} fontSize={12} /><Tooltip contentStyle={chartTooltip} /><Bar dataKey="impactPct" fill="#E84142" isAnimationActive={false}>{holdingChart.map((row,i) => <Cell key={row.symbol} fill={HOLDING_COLORS[i % HOLDING_COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer></div> : <p className="text-sm text-terminal-muted">No holding impacts returned.</p>}</div>
          <div className="min-w-0"><h3 className="mb-3 text-sm">Reported sector impacts · slices sized by absolute impact value</h3>{sectors.length ? <div className="h-80 min-w-0" role="img" aria-label="Sector absolute impact chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={sectors} dataKey="value" nameKey="sector" innerRadius={55} outerRadius={90} isAnimationActive={false}>{sectors.map((row,i) => <Cell key={row.sector} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}</Pie><Tooltip contentStyle={chartTooltip} /></PieChart></ResponsiveContainer></div> : <p className="text-sm text-terminal-muted">No sector impacts returned.</p>}</div>
        </div>
        <details className="mb-4"><summary className="cursor-pointer text-sm">All holding impacts</summary><div className="mt-3"><RiskTable name="Stress holding impacts" headers={["Symbol", "Reported sector", "Weight", "Current value", "Impact", "Impact value", "New value"]} rows={(result.by_holding || []).map(row => [row.symbol,row.sector,riskPercent(row.weight),money(row.current_value),riskPercent(row.impact_pct),money(row.impact_value),money(row.new_value)])} /></div></details>
        <RiskTable name="Stress sector impacts" headers={["Reported sector", "Weight", "Impact", "Impact value"]} rows={sectors.map(row => [row.sector,riskPercent(row.weight),riskPercent(row.impact_pct),money(row.impact_value)])} />
        <details className="mt-4"><summary className="cursor-pointer text-sm">Worst five holdings</summary><div className="mt-3"><RiskTable name="Worst stress holdings" headers={["Symbol", "Current value", "Impact", "Impact value"]} rows={(result.worst_holdings || []).map(row => [row.symbol,money(row.current_value),riskPercent(row.impact_pct),money(row.impact_value)])} /></div></details>
      </TerminalPanel>}
      <TerminalPanel title="Independent portfolio simulation" subtitle="1,000 Monte Carlo simulations · not conditioned on the selected scenario">
        {simulationError ? <p role="alert" className="text-sm text-terminal-neg">Simulation unavailable. Completed scenario results remain available; no percentile values are assumed.</p> : simulation ? <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{(["p5","p25","p50","p75","p95"] as const).map(key => <div key={key} className="min-w-0 rounded border border-terminal-border p-3"><p className="text-xs text-terminal-muted">{key.toUpperCase()} terminal return</p><p className="mt-2 break-words text-lg tabular-nums">{riskPercent(simulation.percentiles?.[key])}</p></div>)}<div className="rounded border border-terminal-border p-3 text-xs text-terminal-muted">Worst {riskPercent(simulation.worst_case)}<br />Best {riskPercent(simulation.best_case)}</div></div>
          {fan.length ? <><p className="mb-3 text-xs text-terminal-muted">Fan bands use the returned path sample; terminal percentiles above come from the service.</p><div className="h-80 min-w-0" role="img" aria-label="Monte Carlo fan chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={fan}><CartesianGrid stroke="#263040" vertical={false} /><XAxis tick={{ fill: "var(--ot-color-text-muted)" }} dataKey="step" fontSize={12} /><YAxis tick={{ fill: "var(--ot-color-text-muted)" }} fontSize={12} tickFormatter={value => `${Number(value * 100).toFixed(0)}%`} /><Tooltip contentStyle={chartTooltip} formatter={value => riskPercent(value)} /><Area type="monotone" dataKey="band95Base" stackId="fan95" stroke="none" fill="transparent" isAnimationActive={false} /><Area type="monotone" dataKey="band95Range" stackId="fan95" stroke="none" fill="#5B8FF9" fillOpacity={.15} isAnimationActive={false} /><Area type="monotone" dataKey="band75Base" stackId="fan75" stroke="none" fill="transparent" isAnimationActive={false} /><Area type="monotone" dataKey="band75Range" stackId="fan75" stroke="none" fill="#26A65B" fillOpacity={.2} isAnimationActive={false} /><Line type="monotone" dataKey="p50" stroke="#F7D154" dot={false} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div><details><summary className="cursor-pointer text-sm">Exact simulation path bands</summary><div className="mt-3"><RiskTable name="Simulation path bands" headers={["Step", "P5", "P25", "P50", "P75", "P95"]} rows={fan.map(row => [row.step,riskPercent(row.p5),riskPercent(row.p25),riskPercent(row.p50),riskPercent(row.p75),riskPercent(row.p95)])} /></div></details></> : <p className="text-sm text-terminal-muted">No usable simulation paths returned.</p>}
        </> : <p role="status" className="text-sm text-terminal-muted">{loading ? "Simulation running…" : "No simulation result returned."}</p>}
      </TerminalPanel>
    </section>}
    {!applied && <p className="rounded border border-terminal-border p-4 text-sm text-terminal-muted">Choose a scenario and run it to inspect its captured results. Nothing runs automatically.</p>}
    <details className="min-w-0 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Service run history</summary><div className="mt-3"><RiskPanel title="Run history" subtitle="Legacy process-local service list, not a durable personal journal" read={history} empty={!history.data?.length}><RiskTable name="Stress run history" headers={["Date", "Scenario", "Impact"]} rows={(history.data || []).map(row => [row.run_date,row.scenario_name,riskPercent(row.total_impact_pct)])} /></RiskPanel></div></details>
  </section>;
}
