import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchCorrelationClusters, fetchCorrelationMatrix, fetchPortfolio, fetchRollingCorrelation, searchSymbols, type SearchSymbolItem } from "../api/client";
import { AnalyticsPanel, AnalyticsTable, analyticsNumber, finite, useAnalyticsRead } from "../components/terminal/AnalyticsRead";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import type { CorrelationClustersResponse, CorrelationDendrogramNode, CorrelationMatrixResponse, CorrelationRollingResponse } from "../types";

const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"];
const GROUPS = { "US large-cap basket": ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B", "JPM", "V"], "Bank basket": ["JPM", "BAC", "WFC", "C", "GS"], "Technology basket": ["AAPL", "MSFT", "GOOGL", "NVDA", "ORCL"] };
const PERIODS = ["1M", "3M", "6M", "1Y", "3Y"];
const WINDOWS = [20,30,60,90,120];
const CLUSTER_COLORS = ["#5B8FF9", "#26A65B", "#F39C12", "#E84142", "#00B7C3", "#8E5AFF", "#F26B8A", "#8892B0"];
type View = "matrix" | "rolling" | "clusters";

function MergeNode({ node, root = false }: { node: CorrelationDendrogramNode; root?: boolean }) {
  const children = Array.isArray(node?.children) ? node.children : [];
  if (!children.length) return <li className="min-w-0 break-all py-2 text-sm">{node?.name || "Unnamed leaf"} · distance {analyticsNumber(node?.distance,4)}</li>;
  return <li className="min-w-0"><details open={root}><summary className="cursor-pointer break-words py-2 text-sm">Merge · distance {analyticsNumber(node?.distance,4)}</summary><ul className="ml-4 min-w-0 border-l border-terminal-border pl-3">{children.map((child,i) => <MergeNode key={i} node={child} />)}</ul></details></li>;
}

function MatrixAndClusters({ symbols, period, view, count, onPair }: { symbols: string[]; period: string; view: View; count: number; onPair: (a: string,b: string) => void }) {
  const matrix = useAnalyticsRead<CorrelationMatrixResponse>(JSON.stringify([symbols,period]), () => fetchCorrelationMatrix({ symbols, period, frequency: "daily" }));
  const data = matrix.data;
  const returned = Array.isArray(data?.symbols) ? data.symbols : [];
  const pairs = useMemo(() => {
    const values: { a: string; b: string; value: number }[] = [];
    returned.forEach((a,i) => returned.slice(i+1).forEach((b,j) => { const value = data?.matrix?.[i]?.[i+j+1]; if (finite(value)) values.push({ a,b,value }); }));
    return values.sort((a,b) => a.value-b.value).slice(0,5);
  }, [data]);
  const omitted = symbols.filter(symbol => !returned.includes(symbol));
  return view === "matrix" ? <AnalyticsPanel title="Correlation matrix" read={matrix} empty={returned.length < 2} subtitle={`${period} requested · daily Pearson coefficients`}>
    <p className="mb-3 break-words text-xs text-terminal-muted">Returned dates: {data?.period_start || "Unavailable"} to {data?.period_end || "Unavailable"}. {returned.length} returned of {symbols.length} requested symbols.</p>
    {omitted.length > 0 && <p className="mb-3 break-words text-sm text-terminal-muted">Not returned: {omitted.join(", ")}. No replacement values are inferred.</p>}
    <p className="mb-3 text-xs text-terminal-muted">−1 inverse · 0 no measured linear correlation · +1 together. Choose an off-diagonal pair for rolling history.</p>
    <div role="region" aria-label="Correlation heatmap table" tabIndex={0} className="max-h-[36rem] min-w-0 overflow-auto rounded border border-terminal-border focus-visible:outline focus-visible:outline-terminal-accent" data-testid="correlation-matrix-heatmap">
      <table className="w-full border-separate border-spacing-0 text-sm"><thead className="sticky top-0 z-20 bg-terminal-panel"><tr><th scope="col" className="sticky left-0 z-30 bg-terminal-panel p-3 text-left text-xs">Asset / pair</th>{returned.map(symbol => <th scope="col" key={symbol} className="min-w-28 max-w-40 break-all border-b border-terminal-border p-2 text-xs font-medium">{symbol}</th>)}</tr></thead><tbody>{returned.map((a,i) => <tr key={a}><th scope="row" className="sticky left-0 z-10 w-28 min-w-28 max-w-28 break-all border-b border-terminal-border bg-terminal-panel p-3 text-left font-normal">{a}</th>{returned.map((b,j) => {
        const value = data?.matrix?.[i]?.[j], valid = finite(value);
        const style = valid ? { backgroundColor: `rgba(${value < 0 ? "232,65,66" : "91,143,249"},${Math.min(1,Math.abs(value)) * .28})` } : undefined;
        return <td key={b} className="border-b border-l border-terminal-border p-1 text-center tabular-nums" style={style}>{a === b ? <span className="block px-2 py-3">{analyticsNumber(value)}</span> : <button type="button" onClick={() => onPair(a,b)} aria-label={`Inspect ${a} / ${b} rolling correlation`} className={`min-h-11 w-full rounded px-2 py-2 ${valid ? "text-sm" : "text-xs"} hover:outline hover:outline-terminal-accent focus-visible:outline focus-visible:outline-terminal-accent`}>{analyticsNumber(value)}</button>}</td>;
      })}</tr>)}</tbody></table>
    </div>
  </AnalyticsPanel> : <div className="min-w-0 space-y-4">
    <ClusterResult symbols={symbols} period={period} count={count} />
    <AnalyticsPanel title="Lowest signed pair correlations" subtitle={`${period} matrix · ascending coefficients, not ascending absolute values`} read={matrix} empty={!pairs.length}>
      <p className="mb-3 text-xs text-terminal-muted">Strong negative correlation can indicate inverse co-movement, rather than independence. Select a pair to inspect its rolling history.</p>
      <AnalyticsTable name="Lowest correlation pairs" headers={["Pair", "Coefficient"]} rows={pairs.map(pair => [<button type="button" className="min-h-10 break-all text-left text-terminal-accent underline focus-visible:outline focus-visible:outline-terminal-accent" onClick={() => onPair(pair.a,pair.b)}>{pair.a} / {pair.b}</button>,analyticsNumber(pair.value)])} />
    </AnalyticsPanel>
  </div>;
}

function ClusterResult({ symbols,period,count }: { symbols: string[]; period: string; count: number }) {
  const read = useAnalyticsRead<CorrelationClustersResponse>(JSON.stringify([symbols,period,count]), () => fetchCorrelationClusters({ symbols, period, n_clusters: count }));
  const groups = Array.isArray(read.data?.clusters) ? read.data.clusters : [];
  return <AnalyticsPanel title="Hierarchical clusters" read={read} empty={!groups.length} subtitle={`${period} · average linkage from 1 − correlation distance · ${count} groups requested`}>
    <p className="mb-3 text-xs text-terminal-muted">Returned {groups.length} groups; the service can return fewer groups than requested.</p>
    <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3" data-testid="correlation-cluster-cards">{groups.map((group,i) => <article key={group.cluster_id} className="min-w-0 space-y-3 rounded border border-terminal-border bg-terminal-bg p-3" style={{ borderTopColor: CLUSTER_COLORS[i % CLUSTER_COLORS.length], borderTopWidth: 3 }}><h3 className="text-sm font-semibold">Cluster {group.cluster_id}</h3><p className="text-xs text-terminal-muted">Average within-group coefficient: {analyticsNumber(group.avg_intra_correlation)}</p><ul className="space-y-2">{(group.symbols || []).map(symbol => <li key={symbol} className="break-all text-sm">{symbol}</li>)}</ul></article>)}</div>
    <details className="mt-4 min-w-0 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Merge tree</summary><div role="region" aria-label="Correlation merge tree" tabIndex={0} className="mt-3 max-h-96 min-w-0 overflow-auto focus-visible:outline focus-visible:outline-terminal-accent">{read.data?.dendrogram ? <ul className="min-w-0"><MergeNode root node={read.data.dendrogram} /></ul> : <p className="text-sm text-terminal-muted">No merge tree returned.</p>}</div></details>
  </AnalyticsPanel>;
}

function Rolling({ pair,windowSize,period }: { pair: [string,string]; windowSize: number; period: string }) {
  const read = useAnalyticsRead<CorrelationRollingResponse>(JSON.stringify([pair,windowSize,period]), () => fetchRollingCorrelation({ symbol1: pair[0], symbol2: pair[1], window: windowSize, period }));
  const rows = (read.data?.series || []).map(row => ({ ...row, correlation: finite(row.correlation) ? row.correlation : null }));
  const regimes = read.data?.regimes || [];
  return <AnalyticsPanel title="Rolling correlation" subtitle={`${pair[0]} / ${pair[1]} · ${windowSize}-observation window · ${period} requested`} read={read} empty={!rows.length}>
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{([["Current",read.data?.current],["Average",read.data?.avg],["Minimum",read.data?.min],["Maximum",read.data?.max]] as const).map(([label,value]) => <div key={label} className="min-w-0 rounded border border-terminal-border p-3"><p className="text-xs text-terminal-muted">{label}</p><p className="mt-2 break-words text-xl tabular-nums">{analyticsNumber(value)}</p></div>)}</div>
    <p className="mb-3 text-xs text-terminal-muted">Returned observations: {rows[0]?.date || "Unavailable"} to {rows[rows.length-1]?.date || "Unavailable"}. Gaps remain gaps.</p>
    <div className="h-80 min-w-0" role="img" aria-label={`Rolling correlation chart for ${pair[0]} and ${pair[1]}`} data-testid="correlation-rolling-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows}><CartesianGrid stroke="#263040" strokeDasharray="3 3" />{regimes.map((regime,i) => <ReferenceArea key={i} x1={regime.start} x2={regime.end} fill={regime.label === "high" ? "#26A65B" : regime.label === "medium" ? "#F1C40F" : "#E84142"} fillOpacity={.12} strokeOpacity={0} />)}<ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" /><ReferenceLine y={.5} stroke="#5B8FF9" strokeDasharray="4 4" /><ReferenceLine y={-.5} stroke="#E84142" strokeDasharray="4 4" /><XAxis dataKey="date" minTickGap={40} tick={{ fill: "var(--ot-color-text-muted)", fontSize: 12 }} /><YAxis domain={[-1,1]} tick={{ fill: "var(--ot-color-text-muted)", fontSize: 12 }} /><Tooltip contentStyle={{ backgroundColor: "#0d1117", border: "1px solid #273142", fontSize: 12 }} formatter={value => [analyticsNumber(value),"Correlation"]} /><Line type="monotone" dataKey="correlation" stroke="#5B8FF9" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
    <details className="mt-3"><summary className="cursor-pointer text-sm">Exact rolling values</summary><div className="mt-3"><AnalyticsTable name="Rolling correlation values" headers={["Date", "Coefficient"]} rows={rows.map(row => [row.date, analyticsNumber(row.correlation)])} /></div></details>
    <details className="mt-3"><summary className="cursor-pointer text-sm">Correlation regimes</summary><div className="mt-3"><AnalyticsTable name="Correlation regimes" headers={["Regime", "Start", "End", "Average coefficient"]} rows={regimes.map(row => [row.label,row.start,row.end,analyticsNumber(row.avg_correlation)])} /></div></details>
  </AnalyticsPanel>;
}

export function CorrelationDashboardPage() {
  const [view, setView] = useState<View>("matrix");
  const resultRef = useRef<HTMLElement>(null), focusResult = useRef(false);
  const scopeRef = useRef<HTMLElement>(null);
  const nextScopeFocus = useRef<{ kind: "search" } | { kind: "remove"; index: number } | null>(null);
  useEffect(() => { if (focusResult.current) { resultRef.current?.focus(); focusResult.current = false; } }, [view]);
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);
  useEffect(() => {
    const target = nextScopeFocus.current;
    if (!target) return;
    nextScopeFocus.current = null;
    const buttons = scopeRef.current?.querySelectorAll<HTMLButtonElement>("[data-symbol-remove]");
    const input = scopeRef.current?.querySelector<HTMLInputElement>('input[name="correlation-symbol"]');
    if (target.kind === "search" && input && !input.disabled) input.focus();
    else if (buttons?.length) buttons[Math.min(target.kind === "remove" ? target.index : 0, buttons.length-1)].focus();
    else input?.focus();
  }, [symbols]);
  const [query, setQuery] = useState("");
  const [searchMarket, setSearchMarket] = useState("");
  const [search, setSearch] = useState<{ scope: string; loading: boolean; failed: boolean; items: SearchSymbolItem[] }>({ scope: "", loading: false, failed: false, items: [] });
  const [notice, setNotice] = useState("");
  const [period, setPeriod] = useState("1Y");
  const [rollingPeriod, setRollingPeriod] = useState("3Y");
  const [windowSize, setWindow] = useState(60);
  const [count, setCount] = useState(4);
  const [selectedPair, setPair] = useState<[string,string]>([DEFAULT_SYMBOLS[0],DEFAULT_SYMBOLS[1]]);
  const portfolio = useAnalyticsRead("current-portfolio", fetchPortfolio);
  const portfolioSymbols = Array.from(new Set((portfolio.data?.items || []).map(item => item.ticker?.trim().toUpperCase()).filter(Boolean)));
  const pair: [string,string] = symbols.includes(selectedPair[0]) && symbols.includes(selectedPair[1]) && selectedPair[0] !== selectedPair[1] ? selectedPair : [symbols[0] || "",symbols[1] || ""];
  const searchScope = JSON.stringify([query.trim(),searchMarket]);
  const currentSearch = search.scope === searchScope ? search : { loading: true, failed: false, items: [] };
  useEffect(() => {
    let active = true;
    if (!query.trim() || symbols.length >= 20) { setSearch({ scope: searchScope, loading: false, failed: false, items: [] }); return; }
    setSearch({ scope: searchScope, loading: true, failed: false, items: [] });
    const timer = setTimeout(() => { void searchSymbols(query.trim(),searchMarket || undefined).then(items => { if (active) setSearch({ scope: searchScope, loading: false, failed: false, items: items.slice(0,8) }); }).catch(() => { if (active) setSearch({ scope: searchScope, loading: false, failed: true, items: [] }); }); },250);
    return () => { active = false; clearTimeout(timer); };
  }, [searchScope,symbols.length]);
  function add(incoming: string[]) {
    const next = [...symbols]; let clipped = false;
    for (const raw of incoming) { const symbol = raw.trim().toUpperCase(); if (!symbol || next.includes(symbol)) continue; if (next.length >= 20) { clipped = true; continue; } next.push(symbol); }
    nextScopeFocus.current = { kind: "search" };
    setSymbols(next); setQuery(""); setNotice(clipped ? "Scope is limited to 20 symbols; some names were not added." : next.length === symbols.length ? "Those symbols are already in this scope." : `Added ${next.length-symbols.length} symbol(s).`);
  }
  function inspect(a: string,b: string) { focusResult.current = true; setPair([a,b]); setView("rolling"); }
  return <main aria-label="Correlation workspace" className="min-w-0 space-y-4 p-3 text-terminal-text sm:p-4">
    <header className="space-y-2"><h1 className="text-lg font-semibold">Correlation analysis</h1><p className="text-sm text-terminal-muted">Compare linear co-movement, rolling stability and hierarchical groups.</p></header>
    <nav aria-label="Correlation views" className="flex flex-wrap gap-2">{(["matrix","rolling","clusters"] as const).map(key => <TerminalButton type="button" key={key} aria-pressed={view === key} variant={view === key ? "accent" : "default"} onClick={() => setView(key)} className="normal-case tracking-normal">{key === "matrix" ? "Matrix" : key === "rolling" ? "Rolling pairs" : "Clusters"}</TerminalButton>)}</nav>
    <details className="min-w-0 rounded border border-terminal-border bg-terminal-panel p-3"><summary className="cursor-pointer break-words text-sm">Symbols · {symbols.length}/20 selected · Manage scope</summary>
    <section ref={scopeRef} aria-label="Correlation symbol scope" className="mt-4 min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">Symbols</h2><span className="text-xs text-terminal-muted">{symbols.length}/20 selected</span></div>
      <ul aria-label="Selected correlation symbols" className="mb-4 flex flex-wrap gap-2">{symbols.map(symbol => <li key={symbol} className="inline-flex max-w-full items-start gap-2 rounded border border-terminal-border px-2 py-1 text-sm"><span className="min-w-0 break-all py-1">{symbol}</span><button type="button" data-symbol-remove aria-label={`Remove ${symbol}`} onClick={() => { nextScopeFocus.current = { kind: "remove", index: symbols.indexOf(symbol) }; setSymbols(old => old.filter(item => item !== symbol)); setNotice(""); }} className="min-h-8 min-w-8 shrink-0 rounded text-terminal-muted hover:text-terminal-neg focus-visible:outline focus-visible:outline-terminal-accent">×</button></li>)}</ul>
      <form aria-label="Add correlation symbol" className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (query.trim() && !/[\s,]/.test(query.trim())) add([query]); else setNotice("Enter one native symbol or choose a search result."); }}>
        <label className="min-w-0 flex-1 basis-48 space-y-2 text-xs">Find or enter symbol<TerminalInput className="block text-sm" name="correlation-symbol" data-testid="correlation-symbol-input" value={query} onChange={event => setQuery(event.target.value)} disabled={symbols.length >= 20} maxLength={80} placeholder={symbols.length >= 20 ? "20-symbol limit reached" : "AAPL, SAP.DE or BTC-USD"} /></label>
        <label className="min-w-0 flex-1 basis-40 space-y-2 text-xs">Search context<TerminalInput as="select" className="block text-sm" value={searchMarket} onChange={event => setSearchMarket(event.target.value)}><option value="">All markets</option><option value="NASDAQ">US (NASDAQ context)</option><option value="NYSE">US (NYSE context)</option><option value="EU">EU</option><option value="Crypto">Crypto</option><option value="NSE">India (NSE context)</option></TerminalInput></label>
        <TerminalButton type="submit" disabled={!query.trim() || symbols.length >= 20} className="normal-case tracking-normal">Add symbol</TerminalButton>
      </form>
      <p className="mt-2 text-xs text-terminal-muted">Search context ranks existing matches; it does not limit results to one market.</p>
      {query.trim() && symbols.length < 20 && <div role="region" aria-label="Symbol search results" className="mt-3 min-w-0 space-y-2">{currentSearch.loading ? <p role="status" className="text-sm text-terminal-muted">Searching…</p> : currentSearch.failed ? <p role="status" className="text-sm text-terminal-muted">Search unavailable. Edit the query to retry, or add a native symbol directly.</p> : currentSearch.items.length ? <ul className="max-h-64 space-y-1 overflow-auto">{currentSearch.items.map(item => <li key={`${item.ticker}:${item.exchange}`}><button type="button" onClick={() => add([item.ticker])} className="w-full space-y-1 rounded border border-terminal-border p-3 text-left hover:border-terminal-accent focus-visible:outline focus-visible:outline-terminal-accent"><span className="block break-all text-sm text-terminal-accent">{item.ticker}</span><span className="block break-words text-sm">{item.name}</span><span className="block break-words text-xs text-terminal-muted">{item.exchange || "Exchange unspecified"}</span></button></li>)}</ul> : <p role="status" className="text-sm text-terminal-muted">No suggestions returned. A native symbol can still be added directly.</p>}</div>}
      <div className="mt-4 flex flex-wrap items-center gap-2">{Object.entries(GROUPS).map(([name,group]) => <TerminalButton type="button" key={name} onClick={() => add(group)} disabled={symbols.length >= 20} className="normal-case tracking-normal">Add {name}</TerminalButton>)}<TerminalButton type="button" onClick={() => add(portfolioSymbols)} disabled={portfolio.loading || portfolio.failed || !portfolioSymbols.length || symbols.length >= 20} className="normal-case tracking-normal">Add current portfolio</TerminalButton>{portfolio.failed && <TerminalButton type="button" onClick={portfolio.reload} className="normal-case tracking-normal">Retry portfolio symbols</TerminalButton>}</div>
      <p role="status" className="mt-3 break-words text-xs text-terminal-muted">{notice || "Presets append unique symbols; they do not replace the selected scope."} {portfolio.loading ? "Loading current portfolio symbols…" : portfolio.failed ? "Portfolio symbols unavailable." : !portfolioSymbols.length ? "No current portfolio symbols returned." : `${portfolioSymbols.length} current portfolio symbols available.`}</p>
    </section></details>

    <section ref={resultRef} tabIndex={-1} aria-label="Active correlation view" className="min-w-0 space-y-4 focus-visible:outline focus-visible:outline-terminal-accent">
      {view === "rolling" ? <div className="grid min-w-0 grid-cols-1 gap-3 rounded border border-terminal-border p-3 sm:grid-cols-2 xl:grid-cols-4">{([0,1] as const).map(index => <label key={index} className="min-w-0 space-y-2 text-xs">{index === 0 ? "First rolling symbol" : "Second rolling symbol"}<TerminalInput as="select" className="block text-sm" disabled={symbols.length < 2} value={pair[index]} onChange={event => setPair(index === 0 ? [event.target.value,pair[1]] : [pair[0],event.target.value])}>{symbols.map(symbol => <option value={symbol} key={symbol} disabled={symbol === pair[index === 0 ? 1 : 0]}>{symbol}</option>)}</TerminalInput></label>)}<label className="space-y-2 text-xs">Rolling window<TerminalInput as="select" className="block text-sm" value={windowSize} onChange={event => setWindow(Number(event.target.value))}>{WINDOWS.map(value => <option key={value} value={value}>{value} observations</option>)}</TerminalInput></label><label className="space-y-2 text-xs">Rolling history period<TerminalInput as="select" className="block text-sm" value={rollingPeriod} onChange={event => setRollingPeriod(event.target.value)}><option>1Y</option><option>3Y</option></TerminalInput></label></div> : <div className="flex flex-wrap items-end gap-4"><label className="min-w-0 flex-1 basis-48 space-y-2 text-xs">Matrix and cluster period<TerminalInput as="select" className="block text-sm" value={period} onChange={event => setPeriod(event.target.value)}>{PERIODS.map(item => <option key={item}>{item}</option>)}</TerminalInput></label>{view === "clusters" && <label className="min-w-0 flex-1 basis-48 space-y-3 text-xs">Requested groups: {count}<input aria-label="Requested cluster count" type="range" min={2} max={8} value={count} onChange={event => setCount(Number(event.target.value))} className="block min-h-10 w-full accent-terminal-accent" /></label>}</div>}
      {symbols.length < 2 ? <p role="status" className="rounded border border-terminal-border p-4 text-sm">Add at least two distinct symbols to run correlation analysis. No previous results are shown.</p> : view === "rolling" ? <Rolling pair={pair} windowSize={windowSize} period={rollingPeriod} /> : <MatrixAndClusters symbols={symbols} period={period} view={view} count={count} onPair={inspect} />}
    </section>
    <details className="rounded border border-terminal-border p-3 text-sm"><summary className="cursor-pointer">Coverage and interpretation</summary><div className="mt-3 space-y-2 text-sm text-terminal-muted"><p>These existing endpoints compare daily price-return histories on their overlapping dates. Requested symbols can be omitted by the service; inspect returned symbols and dates. No currency conversion, adjusted-return basis or source freshness is established here.</p><p>Rolling windows count observations rather than calendar days. Coloured regimes and hierarchical clusters retain the service’s rules. Correlation is not causation or a guarantee of diversification; a negative coefficient can describe a strong inverse relationship.</p><p>Missing frontend cells remain unavailable. The backend can itself fill undefined correlations with zero; coverage, calendar alignment, native symbol identity and those sentinels require the v5 functionality audit. Preset baskets are static convenience lists, not verified current index rankings.</p></div></details>
  </main>;
}
