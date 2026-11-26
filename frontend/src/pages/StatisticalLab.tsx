import { useEffect, useRef, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { AnalyticsTable, analyticsNumber as number, finite, useAnalyticsRead } from "../components/terminal/AnalyticsRead";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { fetchStatlabMethods, postForecast, postCointegration, postStationarity, postRegression, postAutocorrelation, postCausality, postRegimes, type ForecastResult, type CointResult, type StationarityResult, type RegressionResult, type AutocorrResult, type CausalityResult, type RegimeResult } from "../api/statlab";

type Tool = "forecast" | "coint" | "stationarity" | "decomposition" | "regression" | "autocorr" | "causality" | "regimes";
type Draft = Record<string,string | boolean>;
type Field = { key: string; label: string; type?: "number" | "checkbox" | "method"; min?: number; max?: number };
const TOOLS: Record<Tool,{ label: string; description: string; defaults: Draft; fields: Field[] }> = {
  forecast: { label: "Forecast", description: "Historical prices, model projection and returned interval bounds.", defaults: { ticker: "AAPL", method: "", horizon: "30" }, fields: [{ key: "ticker", label: "Forecast symbol" },{ key: "method", label: "Forecast method", type: "method" },{ key: "horizon", label: "Forecast horizon (steps)", type: "number", min: 1, max: 120 }] },
  coint: { label: "Pairs and cointegration", description: "Reported cointegration tests, hedge ratio and spread z-score.", defaults: { ticker_a: "AAPL", ticker_b: "MSFT" }, fields: [{ key: "ticker_a", label: "First pair symbol" },{ key: "ticker_b", label: "Second pair symbol" }] },
  stationarity: { label: "Stationarity", description: "ADF, KPSS and returns tests, with the service’s Hurst interpretation.", defaults: { ticker: "AAPL" }, fields: [{ key: "ticker", label: "Stationarity symbol" }] },
  decomposition: { label: "Decomposition", description: "This analysis is not available here yet.", defaults: {}, fields: [] },
  regression: { label: "Factor / CAPM", description: "Asset/benchmark regression, rolling beta and reported fit statistics.", defaults: { ticker: "AAPL", benchmark: "^GSPC", rolling_window: "63" }, fields: [{ key: "ticker", label: "Regression asset" },{ key: "benchmark", label: "Regression benchmark" },{ key: "rolling_window", label: "Rolling window (observations)", type: "number", min: 20, max: 252 }] },
  autocorr: { label: "Autocorrelation", description: "ACF, PACF and Ljung–Box diagnostics for prices or returns.", defaults: { ticker: "AAPL", nlags: "30", use_returns: true }, fields: [{ key: "ticker", label: "Autocorrelation symbol" },{ key: "nlags", label: "Autocorrelation lags", type: "number", min: 5, max: 60 },{ key: "use_returns", label: "Use returns", type: "checkbox" }] },
  causality: { label: "Granger predictability", description: "Lagged predictive relationships in both directions; this does not establish real-world causation.", defaults: { ticker_a: "AAPL", ticker_b: "MSFT", max_lag: "5" }, fields: [{ key: "ticker_a", label: "First Granger symbol" },{ key: "ticker_b", label: "Second Granger symbol" },{ key: "max_lag", label: "Maximum Granger lag", type: "number", min: 1, max: 15 }] },
  regimes: { label: "Volatility regimes", description: "Reported high/low volatility states and high-volatility probabilities.", defaults: { ticker: "AAPL" }, fields: [{ key: "ticker", label: "Regime symbol" }] },
};
type Run = { status: "pending" | "done" | "failed"; captured: Draft; data?: unknown };
const text = (value: unknown) => typeof value === "string" && value.trim() ? value : "Unavailable";
const pct = (value: unknown, digits = 2) => finite(value) ? `${(value*100).toFixed(digits)}%` : "Unavailable";
const yesNo = (value: unknown, yes: string, no: string) => value === true ? yes : value === false ? no : "Unavailable";
const axis = { fill: "var(--ot-color-text-muted)", fontSize: 12 };
const tooltip = { backgroundColor: "#0d1117", border: "1px solid #263040", fontSize: 12 };
const array = <T,>(value: T[] | undefined | null): T[] => Array.isArray(value) ? value : [];

async function calculate(tool: Tool, value: Draft): Promise<unknown> {
  const symbol = (key: string) => String(value[key]);
  switch (tool) {
    case "forecast": return postForecast({ ticker: symbol("ticker"), method: symbol("method"), horizon: Number(value.horizon) });
    case "coint": return postCointegration({ ticker_a: symbol("ticker_a"), ticker_b: symbol("ticker_b") });
    case "stationarity": return postStationarity({ ticker: symbol("ticker") });
    case "regression": return postRegression({ ticker: symbol("ticker"), benchmark: symbol("benchmark"), rolling_window: Number(value.rolling_window) });
    case "autocorr": return postAutocorrelation({ ticker: symbol("ticker"), nlags: Number(value.nlags), use_returns: Boolean(value.use_returns) });
    case "causality": return postCausality({ ticker_a: symbol("ticker_a"), ticker_b: symbol("ticker_b"), max_lag: Number(value.max_lag) });
    case "regimes": return postRegimes({ ticker: symbol("ticker") });
    default: throw new Error("Analysis unavailable");
  }
}
function Metrics({ items }: { items: [string,ReactNode][] }) {
  return <dl className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3">{items.map(([label,value]) => <div key={label} className="min-w-0 rounded border border-terminal-border bg-terminal-panel p-3"><dt className="text-xs text-terminal-muted">{label}</dt><dd className="mt-2 break-words text-lg tabular-nums">{value}</dd></div>)}</dl>;
}
function Plot({ name, populated, children }: { name: string; populated: boolean; children: ReactNode }) {
  return populated ? <div role="img" aria-label={name} className="h-80 min-w-0 w-full">{children}</div> : <p role="status" className="py-4 text-sm text-terminal-muted">No numeric observations returned for this chart.</p>;
}
function Interpretation({ value }: { value: unknown }) {
  return <section aria-label="Service interpretation" className="min-w-0 rounded border border-terminal-border p-3"><h3 className="mb-2 text-sm font-semibold">Service interpretation</h3><p className="whitespace-pre-wrap break-words text-sm text-terminal-muted">{text(value)}</p></section>;
}
function Exact({ name, headers, rows }: { name: string; headers: string[]; rows: ReactNode[][] }) {
  return <details className="min-w-0"><summary className="cursor-pointer py-2 text-sm">{name}</summary><AnalyticsTable name={name} headers={headers} rows={rows} /></details>;
}

function Forecast({ data }: { data: ForecastResult }) {
  const history = array(data.history), forecast = array(data.forecast);
  const rows = [...history.map(row => ({ ...row, mean: null, band: null })),...forecast.map(row => ({ date: row.date, value: null, mean: finite(row.mean) ? row.mean : null, band: finite(row.lower) && finite(row.upper) ? [row.lower,row.upper] : null }))];
  return <div className="space-y-4"><Metrics items={[["Service symbol",text(data.ticker)],["Service method",text(data.method)],["Model order",text(data.model?.order)],["AIC",number(data.model?.aic)],["In-sample RMSE",number(data.metrics?.rmse_in_sample,4)]]} />
    <TerminalPanel title="History and forecast" className="min-w-0"><Plot name="History and forecast chart" populated={history.some(row => finite(row.value)) || forecast.some(row => finite(row.mean))}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows}><CartesianGrid stroke="#263040" vertical={false} /><XAxis dataKey="date" tick={axis} minTickGap={32} /><YAxis tick={axis} domain={["auto","auto"]} /><Tooltip contentStyle={tooltip} /><Legend wrapperStyle={{ fontSize: 12 }} /><Area type="monotone" dataKey="band" stroke="none" fill="#3B82F6" fillOpacity={.15} name="Returned interval" isAnimationActive={false} /><Line type="monotone" dataKey="value" stroke="#10B981" dot={false} name="History" isAnimationActive={false} /><Line type="monotone" dataKey="mean" stroke="#3B82F6" strokeDasharray="5 5" dot={false} name="Forecast" isAnimationActive={false} /></ComposedChart></ResponsiveContainer></Plot>
    <Exact name="Exact forecast values" headers={["Date","Mean","Lower bound","Upper bound"]} rows={forecast.map(row => [row.date,number(row.mean,4),number(row.lower,4),number(row.upper,4)])} /><Exact name="Exact historical values" headers={["Date","Reported value"]} rows={history.map(row => [row.date,number(row.value,4)])} /></TerminalPanel></div>;
}
function Cointegration({ data }: { data: CointResult }) {
  const rows = array(data.series);
  return <div className="space-y-4"><Metrics items={[["Cointegration p-value",number(data.coint_pvalue,4)],["Service test result",yesNo(data.is_cointegrated,"Cointegrated","Not cointegrated")],["Hedge ratio",number(data.hedge_ratio,4)],["Half-life (reported steps)",number(data.half_life,1)],["Correlation",number(data.correlation)],["Current z-score",number(data.current_z)],["Model signal",text(data.signal)]]} />
    <TerminalPanel title={`Spread z-score · ${text(data.ticker_a)} / ${text(data.ticker_b)}`} className="min-w-0"><Plot name="Cointegration spread z-score chart" populated={rows.some(row => finite(row.zscore))}><ResponsiveContainer width="100%" height="100%"><LineChart data={rows}><CartesianGrid stroke="#263040" vertical={false} /><XAxis dataKey="date" tick={axis} minTickGap={32} /><YAxis tick={axis} /><Tooltip contentStyle={tooltip} /><ReferenceLine y={0} stroke="#94a3b8" /><ReferenceLine y={2} stroke="#EF4444" strokeDasharray="3 3" /><ReferenceLine y={-2} stroke="#10B981" strokeDasharray="3 3" /><Line type="monotone" dataKey="zscore" stroke="#3B82F6" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></Plot><Exact name="Exact spread values" headers={["Date","Spread","Z-score"]} rows={rows.map(row => [row.date,number(row.spread,4),number(row.zscore,4)])} /></TerminalPanel></div>;
}
function Stationarity({ data }: { data: StationarityResult }) {
  const tests = [["ADF · prices",data.adf],["KPSS · prices",data.kpss],["ADF · returns",data.returns_adf]] as const;
  return <div className="space-y-4"><Metrics items={[["Service symbol",text(data.ticker)],["Hurst exponent",number(data.hurst,3)],["Retained Hurst heuristic",finite(data.hurst) ? data.hurst < .45 ? "Mean-reverting" : data.hurst > .55 ? "Trending" : "Random walk" : "Unavailable"]]} /><AnalyticsTable name="Stationarity test results" headers={["Test","Statistic","P-value","Service conclusion"]} rows={tests.map(([name,row]) => [name,number(row?.stat,3),number(row?.pvalue,4),yesNo(row?.is_stationary,"Stationary","Non-stationary")])} /><Interpretation value={data.interpretation} /></div>;
}
function Regression({ data }: { data: RegressionResult }) {
  const rolling = array(data.rolling_beta), scatter = array(data.scatter), fit = array(data.fit_line);
  return <div className="space-y-4"><Metrics items={[["Service asset",text(data.asset || data.ticker)],["Service benchmark",text(data.benchmark || data.benchmark_ticker)],["Beta",number(data.beta,3)],["Annual alpha",pct(data.alpha_annual)],["R-squared",number(data.r_squared,3)],["Correlation",number(data.correlation,3)],["Tracking error",pct(data.tracking_error)],["Information ratio",number(data.information_ratio)],["Observations",number(data.n_obs,0)]]} />
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2"><TerminalPanel title={`Rolling beta · ${number(data.rolling_window,0)} observations`} className="min-w-0"><Plot name="Rolling beta chart" populated={rolling.some(row => finite(row.beta))}><ResponsiveContainer width="100%" height="100%"><LineChart data={rolling}><CartesianGrid stroke="#263040" /><XAxis dataKey="date" tick={axis} minTickGap={32} /><YAxis tick={axis} domain={["auto","auto"]} /><Tooltip contentStyle={tooltip} /><ReferenceLine y={1} stroke="#94a3b8" strokeDasharray="3 3" /><Line type="monotone" dataKey="beta" stroke="#3B82F6" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></Plot></TerminalPanel>
    <TerminalPanel title="Asset returns versus benchmark" className="min-w-0"><Plot name="Regression returns and fitted line chart" populated={scatter.some(row => finite(row.x) && finite(row.y))}><ResponsiveContainer width="100%" height="100%"><ScatterChart><CartesianGrid stroke="#263040" /><XAxis dataKey="x" type="number" name="Benchmark return" tick={axis} tickFormatter={value => pct(value,1)} /><YAxis dataKey="y" type="number" name="Asset return" tick={axis} tickFormatter={value => pct(value,1)} /><Tooltip contentStyle={tooltip} /><Legend wrapperStyle={{ fontSize: 12 }} /><Scatter name="Returns" data={scatter} fill="#3B82F6" isAnimationActive={false} /><Scatter name="Returned fitted line" data={fit} fill="#F59E0B" line={{ stroke: "#F59E0B" }} shape={() => <g />} isAnimationActive={false} /></ScatterChart></ResponsiveContainer></Plot></TerminalPanel></div>
    <AnalyticsTable name="Regression estimates" headers={["Estimate","Value","T-statistic","P-value"]} rows={[["Daily alpha",number(data.alpha_daily,6),number(data.alpha_tstat,3),number(data.alpha_pvalue,4)],["Annual alpha",pct(data.alpha_annual),"—","—"],["Beta",number(data.beta,3),number(data.beta_tstat,3),number(data.beta_pvalue,4)]]} />
    <Exact name="Exact rolling beta values" headers={["Date","Beta"]} rows={rolling.map(row => [row.date,number(row.beta,4)])} /><Exact name="Exact return scatter values" headers={["Benchmark return","Asset return"]} rows={scatter.map(row => [number(row.x,6),number(row.y,6)])} /><Exact name="Exact fitted line values" headers={["Benchmark return","Fitted asset return"]} rows={fit.map(row => [number(row.x,6),number(row.y,6)])} /><Interpretation value={data.interpretation} /></div>;
}
function Autocorrelation({ data }: { data: AutocorrResult }) {
  return <div className="space-y-4"><Metrics items={[["Service symbol",text(data.ticker)],["Service series",yesNo(data.use_returns,"Returns","Prices")],["Observations",number(data.n_obs,0)],["Returned confidence band",number(data.conf_band,4)]]} />
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">{([["ACF",array(data.acf)],["PACF",array(data.pacf)]] as const).map(([name,rows]) => <TerminalPanel key={name} title={name} className="min-w-0"><Plot name={`${name} chart`} populated={rows.some(row => finite(row.value))}><ResponsiveContainer width="100%" height="100%"><BarChart data={rows}><CartesianGrid stroke="#263040" vertical={false} /><XAxis dataKey="lag" tick={axis} /><YAxis tick={axis} domain={[-1,1]} /><Tooltip contentStyle={tooltip} /><ReferenceLine y={0} stroke="#94a3b8" />{finite(data.conf_band) && <ReferenceLine y={data.conf_band} stroke="#EF4444" strokeDasharray="3 3" />}{finite(data.conf_band) && <ReferenceLine y={-data.conf_band} stroke="#EF4444" strokeDasharray="3 3" />}<Bar dataKey="value" isAnimationActive={false}>{rows.map((row,i) => <Cell key={i} fill={row.significant ? "#3B82F6" : "#6B7280"} />)}</Bar></BarChart></ResponsiveContainer></Plot><Exact name={`Exact ${name} values`} headers={["Lag","Value","Service significance"]} rows={rows.map(row => [row.lag,number(row.value,4),yesNo(row.significant,"Significant","Not significant")])} /></TerminalPanel>)}</div>
    <AnalyticsTable name="Ljung-Box results" headers={["Lag","Statistic","P-value","Service conclusion"]} rows={array(data.ljung_box).map(row => [row.lag,number(row.stat,4),number(row.pvalue,4),yesNo(row.has_autocorr,"Autocorrelation detected","Not detected")])} /><Interpretation value={data.interpretation} /></div>;
}
function Causality({ data }: { data: CausalityResult }) {
  const directions = [[`${text(data.name_a || data.ticker_a)} → ${text(data.name_b || data.ticker_b)}`,data.a_to_b],[`${text(data.name_b || data.ticker_b)} → ${text(data.name_a || data.ticker_a)}`,data.b_to_a]] as const;
  return <div className="space-y-4"><Metrics items={[["Service lead",text(data.lead)],["Observations",number(data.n_obs,0)],["Maximum lag",number(data.max_lag,0)]]} /><AnalyticsTable name="Granger directional results" headers={["Direction","Best lag","Minimum p-value","Service significance"]} rows={directions.map(([name,row]) => [name,number(row?.best_lag,0),number(row?.min_pvalue,4),yesNo(row?.significant,"Granger significance detected","Not detected")])} />
    <TerminalPanel title="Directional p-values by lag" className="min-w-0"><Plot name="Granger p-values chart" populated={directions.some(([,row]) => array(row?.curve).some(point => finite(point.pvalue)))}><ResponsiveContainer width="100%" height="100%"><LineChart><CartesianGrid stroke="#263040" /><XAxis dataKey="lag" type="number" tick={axis} domain={[1,data.max_lag || 1]} allowDuplicatedCategory={false} /><YAxis domain={[0,1]} tick={axis} /><Tooltip contentStyle={tooltip} /><Legend wrapperStyle={{ fontSize: 12 }} /><ReferenceLine y={.05} stroke="#EF4444" strokeDasharray="3 3" />{directions.map(([name,row],i) => <Line key={i} type="monotone" dataKey="pvalue" data={array(row?.curve)} name={i === 0 ? "First → second" : "Second → first"} stroke={i === 0 ? "#3B82F6" : "#F59E0B"} dot={false} isAnimationActive={false} />)}</LineChart></ResponsiveContainer></Plot>
    <Exact name="Exact Granger lag values" headers={["Direction","Lag","P-value"]} rows={directions.flatMap(([name,row]) => array(row?.curve).map(point => [name,point.lag,number(point.pvalue,4)]))} /></TerminalPanel><Interpretation value={data.interpretation} /></div>;
}
function Regimes({ data }: { data: RegimeResult }) {
  const rows = array(data.series);
  return <div className="space-y-4"><Metrics items={[["Service symbol",text(data.ticker)],["Current state",text(data.current_regime)],["High-volatility probability",pct(data.current_high_vol_prob,0)],["Observations",number(data.n_obs,0)],["Regime count",number(data.k_regimes,0)]]} />
    <AnalyticsTable name="Regime parameters" headers={["Returned regime","Annual volatility (%)","Share","Mean (reported)","Volatility (reported)"]} rows={[data.low_vol_regime,data.high_vol_regime].map(row => [text(row?.label),number(row?.ann_vol_pct,1),pct(row?.share,0),number(row?.mean,6),number(row?.vol,6)])} />
    <TerminalPanel title="High-volatility regime probability" className="min-w-0"><Plot name="High-volatility probability chart" populated={rows.some(row => finite(row.high_vol_prob))}><ResponsiveContainer width="100%" height="100%"><AreaChart data={rows}><CartesianGrid stroke="#263040" vertical={false} /><XAxis dataKey="date" tick={axis} minTickGap={32} /><YAxis domain={[0,1]} tick={axis} tickFormatter={value => pct(value,0)} /><Tooltip contentStyle={tooltip} formatter={value => pct(value,1)} /><ReferenceLine y={.5} stroke="#94a3b8" strokeDasharray="3 3" /><Area type="monotone" dataKey="high_vol_prob" stroke="#F59E0B" fill="#F59E0B" fillOpacity={.15} isAnimationActive={false} /></AreaChart></ResponsiveContainer></Plot><Exact name="Exact regime probabilities" headers={["Date","High-volatility probability"]} rows={rows.map(row => [row.date,pct(row.high_vol_prob,2)])} /></TerminalPanel><Interpretation value={data.interpretation} /></div>;
}
function Results({ tool, data }: { tool: Tool; data: unknown }) {
  if (!data || typeof data !== "object" || !Object.keys(data).length) return <p role="status" className="text-sm text-terminal-muted">No analysis values returned.</p>;
  switch (tool) {
    case "forecast": return <Forecast data={data as ForecastResult} />;
    case "coint": return <Cointegration data={data as CointResult} />;
    case "stationarity": return <Stationarity data={data as StationarityResult} />;
    case "regression": return <Regression data={data as RegressionResult} />;
    case "autocorr": return <Autocorrelation data={data as AutocorrResult} />;
    case "causality": return <Causality data={data as CausalityResult} />;
    case "regimes": return <Regimes data={data as RegimeResult} />;
    default: return null;
  }
}

export function StatisticalLab() {
  const [tool,setTool] = useState<Tool>("forecast");
  const [drafts,setDrafts] = useState<Record<Tool,Draft>>(() => Object.fromEntries(Object.entries(TOOLS).map(([key,value]) => [key,{ ...value.defaults }])) as Record<Tool,Draft>);
  const [runs,setRuns] = useState<Partial<Record<Tool,Run>>>({});
  const [validation,setValidation] = useState<Partial<Record<Tool,string>>>({});
  const methods = useAnalyticsRead("statlab-methods",fetchStatlabMethods);
  const options = array(methods.data?.forecast_methods);
  const pending = useRef(new Set<Tool>()), mounted = useRef(true), active = useRef(tool), focusResult = useRef<Tool | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  active.current = tool;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (options.length) setDrafts(old => options.some(item => item.id === old.forecast.method) ? old : { ...old, forecast: { ...old.forecast,method: options[0].id } }); }, [methods.data]);
  useEffect(() => { if (focusResult.current === tool) { focusResult.current = null; resultRef.current?.focus(); resultRef.current?.scrollIntoView?.({ block: "start", behavior: "auto" }); } }, [runs,tool]);
  const config = TOOLS[tool], draft = drafts[tool], run = runs[tool];
  const running = run?.status === "pending";
  const methodReady = !methods.loading && !methods.failed && options.some(item => item.id === draft.method);
  function edit(key: string,value: string | boolean) { setDrafts(old => ({ ...old, [tool]: { ...old[tool], [key]: value } })); setValidation(old => ({ ...old,[tool]: "" })); }
  async function submit() {
    if (pending.current.has(tool) || tool === "decomposition") return;
    const captured = { ...draft };
    for (const field of config.fields) {
      if (field.type === "number") {
        const value = Number(captured[field.key]);
        if (!String(captured[field.key]).trim() || !Number.isInteger(value) || value < field.min! || value > field.max!) { setValidation(old => ({ ...old,[tool]: `${field.label} must be a whole number from ${field.min} to ${field.max}.` })); return; }
        captured[field.key] = String(value);
      } else if (!field.type) {
        const value = String(captured[field.key]).trim().toUpperCase();
        if (!value) { setValidation(old => ({ ...old,[tool]: `${field.label} is required.` })); return; }
        captured[field.key] = value;
      }
    }
    if (tool === "forecast" && !methodReady) { setValidation(old => ({ ...old,[tool]: "Load and select an available forecast method." })); return; }
    if ((tool === "coint" || tool === "causality") && captured.ticker_a === captured.ticker_b) { setValidation(old => ({ ...old,[tool]: "Choose two distinct symbols." })); return; }
    const requested = tool;
    setDrafts(old => ({ ...old,[requested]: captured }));
    pending.current.add(requested); setValidation(old => ({ ...old,[requested]: "" }));
    setRuns(old => ({ ...old,[requested]: { status: "pending",captured } }));
    try {
      const data = await calculate(requested,captured);
      if (mounted.current) { if (active.current === requested) focusResult.current = requested; setRuns(old => ({ ...old,[requested]: { status: "done",captured,data } })); }
    } catch {
      if (mounted.current) { if (active.current === requested) focusResult.current = requested; setRuns(old => ({ ...old,[requested]: { status: "failed",captured } })); }
    } finally { pending.current.delete(requested); }
  }
  return <main aria-label="Statistical Lab workspace" className="min-w-0 space-y-4 p-3 text-terminal-text sm:p-4">
    <header className="space-y-2"><h1 className="text-lg font-semibold">Statistical Lab</h1><p className="text-sm text-terminal-muted">Run a focused statistical analysis, then inspect its captured inputs and exact results.</p></header>
    <label className="block max-w-xl space-y-2 text-xs">Analysis<TerminalInput as="select" className="block text-sm" value={tool} onChange={event => { const next = event.target.value as Tool; active.current = next; focusResult.current = null; setTool(next); }}>{Object.entries(TOOLS).map(([key,value]) => <option value={key} key={key}>{value.label}</option>)}</TerminalInput></label>
    <p className="text-sm text-terminal-muted">{config.description}</p>
    {tool === "decomposition" ? <section aria-label="Decomposition availability" className="rounded border border-terminal-border p-4 text-sm"><h2 className="mb-2 text-base font-semibold">Decomposition unavailable in this workspace</h2><p className="text-terminal-muted">Decomposition is not available here yet. Choose another analysis to continue.</p></section> : <>
      <TerminalPanel title={`${config.label} inputs`} className="min-w-0"><form aria-label="Statistical analysis inputs" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <fieldset disabled={running} className="flex min-w-0 flex-wrap items-end gap-3">{config.fields.map(field => field.type === "checkbox" ? <label key={field.key} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(draft[field.key])} onChange={event => edit(field.key,event.target.checked)} />{field.label}</label> : <label key={field.key} className="min-w-0 flex-1 basis-48 space-y-2 text-xs">{field.label}{field.type === "method" ? <TerminalInput as="select" className="block text-sm" value={String(draft[field.key])} disabled={methods.loading || methods.failed || !options.length} onChange={event => edit(field.key,event.target.value)}>{!options.length && <option value="">No methods available</option>}{options.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</TerminalInput> : <TerminalInput type={field.type === "number" ? "number" : "text"} className="block text-sm" value={String(draft[field.key])} onChange={event => edit(field.key,event.target.value)} required min={field.min} max={field.max} step={field.type === "number" ? 1 : undefined} maxLength={field.type ? undefined : 80} />}</label>)}<TerminalButton type="submit" variant="accent" disabled={running || (tool === "forecast" && !methodReady)} className="normal-case tracking-normal">{running ? "Running analysis…" : "Run analysis"}</TerminalButton></fieldset>
        {tool === "forecast" && <div className="mt-3 space-y-2">{methods.loading ? <p role="status" className="text-sm text-terminal-muted">Loading forecast methods…</p> : methods.failed ? <p role="alert" className="text-sm text-terminal-neg">Could not load forecast methods. Refresh methods to retry; your inputs are kept.</p> : !options.length ? <p role="status" className="text-sm text-terminal-muted">No forecast methods returned.</p> : <p className="text-xs text-terminal-muted">{options.find(item => item.id === draft.method)?.label} · horizon counts model steps; date/calendar semantics depend on the service.</p>}<TerminalButton type="button" onClick={methods.reload} disabled={running || methods.loading} className="normal-case tracking-normal">Refresh methods</TerminalButton></div>}
        {validation[tool] && <p role="alert" className="mt-3 text-sm text-terminal-neg">{validation[tool]}</p>}
      </form></TerminalPanel>
      <section ref={resultRef} tabIndex={-1} aria-label="Statistical analysis result" aria-busy={running} className="min-w-0 space-y-4 focus-visible:outline focus-visible:outline-terminal-accent">
        {run ? <><h2 className="text-base font-semibold">{config.label} · captured run</h2><dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-3 rounded border border-terminal-border p-3">{config.fields.map(field => <div key={field.key} className="min-w-0 max-w-full"><dt className="text-xs text-terminal-muted">{field.label}</dt><dd className="mt-1 break-all text-sm">{field.type === "checkbox" ? run.captured[field.key] ? "Yes" : "No" : String(run.captured[field.key])}</dd></div>)}</dl>
          {JSON.stringify(draft) !== JSON.stringify(run.captured) && <p className="text-xs text-terminal-muted">Inputs have changed. Results below still belong to the captured run.</p>}
          {running ? <p role="status" className="text-sm text-terminal-muted">Running the captured analysis. No previous result is shown; there is no automatic retry.</p> : run.status === "failed" ? <p role="alert" className="rounded border border-terminal-neg p-4 text-sm text-terminal-neg">Could not complete this analysis. No previous result is shown. Your inputs are kept; retry manually when ready.</p> : <Results tool={tool} data={run.data} />}
        </> : <p className="rounded border border-terminal-border p-4 text-sm text-terminal-muted">Set the inputs and run this analysis. Nothing runs automatically.</p>}
      </section>
    </>}
    <details className="rounded border border-terminal-border p-3 text-sm"><summary className="cursor-pointer">Model scope and interpretation</summary><div className="mt-3 space-y-2 text-sm text-terminal-muted"><p>These are the existing statistical models and service defaults. A forecast or model signal is not a verified trading outcome; an in-sample fit does not establish predictive accuracy. Granger significance describes lagged predictability, not real-world causation.</p><p>Price/model units are returned by the service without currency metadata; display-currency conversion is not applied. Forecast dates, observation calendars, adjusted-return basis, listing identity, alignment and model calibration have not been independently verified here.</p><p>These results are temporary and are not saved when you leave this page.</p></div></details>
  </main>;
}
