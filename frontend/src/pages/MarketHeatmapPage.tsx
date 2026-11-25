import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hierarchy, treemap, type HierarchyRectangularNode } from "d3-hierarchy";
import { useNavigate } from "react-router-dom";

import {
  fetchMarketHeatmap,
  type HeatmapGroup,
  type HeatmapGroupBy,
  type HeatmapLeaf,
  type HeatmapMarket,
  type HeatmapPeriod,
  type HeatmapSizeBy,
} from "../api/client";
import { DegradedBanner } from "../components/common/DegradedBanner";
import { useSettingsStore } from "../store/settingsStore";

type TreemapNode = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  data: HeatmapLeaf;
};

type GroupNode = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  data: HeatmapGroup;
};

type TreemapLayout = {
  groups: GroupNode[];
  leaves: TreemapNode[];
};

const PERIOD_OPTIONS: HeatmapPeriod[] = ["1d", "1w", "1m", "3m", "ytd", "1y"];
const SIZE_OPTIONS: Array<{ value: HeatmapSizeBy; label: string }> = [
  { value: "market_cap", label: "Market Cap" },
  { value: "volume", label: "Volume" },
  { value: "turnover", label: "Turnover" },
];

function formatCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "NA";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCurrency(value: number | null | undefined, market: HeatmapMarket): string {
  if (value == null || !Number.isFinite(value)) return "NA";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: market === "IN" ? "INR" : "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPct(changePct: number | null | undefined): string {
  if (changePct == null || !Number.isFinite(changePct)) return "NA";
  return `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
}

// Tiles with no live quote (change_pct null) render neutral grey, never an
// invented colour.
function heatColor(changePct: number | null | undefined): string {
  if (changePct == null || !Number.isFinite(changePct)) return "#6b7280";
  if (changePct <= -5) return "#dc2626";
  if (changePct <= -3) return "#ef4444";
  if (changePct <= -1) return "#f97316";
  if (changePct < 1) return "#6b7280";
  if (changePct < 3) return "#22c55e";
  if (changePct < 5) return "#16a34a";
  return "#15803d";
}

function buildTreemap(groups: HeatmapGroup[], width: number, height: number): TreemapLayout {
  if (!groups.length || width <= 0 || height <= 0) {
    return { groups: [], leaves: [] };
  }
  const root = hierarchy<{ children: HeatmapGroup[] | HeatmapLeaf[] } | HeatmapGroup | HeatmapLeaf>({
    children: groups as unknown as HeatmapGroup[] | HeatmapLeaf[],
  } as { children: HeatmapGroup[] })
    .sum((node) => {
      const candidate = node as Partial<HeatmapLeaf> & Partial<HeatmapGroup>;
      // Group values already aggregate their children; counting them again
      // allocates blank parent area alongside the actual tiles.
      return candidate.children ? 0 : Number(candidate.value ?? 0);
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  treemap<{ children: HeatmapGroup[] | HeatmapLeaf[] } | HeatmapGroup | HeatmapLeaf>()
    .size([width, height])
    .paddingOuter(3)
    .paddingTop((node) => (node.depth === 1 ? 18 : 1))
    .paddingInner(2)(root);

  const rectangularRoot =
    root as HierarchyRectangularNode<{ children: HeatmapGroup[] | HeatmapLeaf[] } | HeatmapGroup | HeatmapLeaf>;

  return {
    groups: rectangularRoot
      .descendants()
      .filter((node) => node.depth === 1)
      .map((node) => ({
        x0: node.x0,
        y0: node.y0,
        x1: node.x1,
        y1: node.y1,
        data: node.data as HeatmapGroup,
      })),
    leaves: rectangularRoot.leaves().map((node) => ({
      x0: node.x0,
      y0: node.y0,
      x1: node.x1,
      y1: node.y1,
      data: node.data as HeatmapLeaf,
    })),
  };
}

export function MarketHeatmapPage() {
  const navigate = useNavigate();
  const selectedCountry = useSettingsStore(state => state.selectedCountry);
  const [market, setMarket] = useState<HeatmapMarket>(selectedCountry === "IN" ? "IN" : "US");
  const [period, setPeriod] = useState<HeatmapPeriod>("1d");
  const [group, setGroup] = useState<HeatmapGroupBy>("sector");
  const [sizeBy, setSizeBy] = useState<HeatmapSizeBy>("market_cap");
  const [activeGroupName, setActiveGroupName] = useState("");
  const [inspected, setInspected] = useState("");
  const [view, setView] = useState("map");
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const measure = () => setWidth(Math.max(0, Math.floor(node.clientWidth)));
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const query = useQuery({ queryKey: ["market-heatmap", market, group, period, sizeBy], queryFn: () => fetchMarketHeatmap({ market, group, period, sizeBy }), staleTime: 300_000, retry: false });
  useEffect(() => { setActiveGroupName(""); setInspected(""); }, [market, group, period, sizeBy]);
  const activeGroup = query.data?.groups.find(row => row.name === activeGroupName);
  const groups = useMemo(() => activeGroup ? [{ ...activeGroup, value: activeGroup.children.reduce((sum, row) => sum + Number(row.value || 0), 0) }] : query.data?.groups || [], [activeGroup, query.data?.groups]);
  const items = activeGroup?.children ?? query.data?.data ?? [];
  const layout = useMemo(() => buildTreemap(groups, width, 480), [groups, width]);
  const list = width < 768 || view === "list";
  const item = items.find(row => row.symbol === inspected);
  const open = (symbol: string) => navigate(`/equity/security/${encodeURIComponent(symbol)}`);
  return <main aria-label="Market heatmap" className="min-w-0 space-y-3 p-3 [overflow-wrap:anywhere]">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-lg font-semibold text-terminal-accent">Market Heatmap</h1><p className="text-sm text-terminal-muted">Equity universe sized by market cap, volume or turnover.</p></div><button className="rounded border border-terminal-border px-3 py-2 text-sm" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh heatmap</button></header>
    <section aria-label="Heatmap scope" className="grid min-w-0 grid-cols-2 gap-3 rounded border border-terminal-border p-3 sm:grid-cols-2 xl:grid-cols-4 [&_select]:w-full [&_select]:min-w-0 [&_select]:rounded [&_select]:border [&_select]:border-terminal-border [&_select]:bg-terminal-panel [&_select]:p-2 [&_select]:text-sm">
      <label className="min-w-0 space-y-1 text-xs text-terminal-muted"><span className="block">Market</span><select aria-label="Heatmap market" value={market} onChange={event => setMarket(event.target.value as HeatmapMarket)}><option value="US">United States</option><option value="IN">India</option></select></label>
      <label className="min-w-0 space-y-1 text-xs text-terminal-muted"><span className="block">Period</span><select aria-label="Heatmap period" value={period} onChange={event => setPeriod(event.target.value as HeatmapPeriod)}>{PERIOD_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="min-w-0 space-y-1 text-xs text-terminal-muted"><span className="block">Group by</span><select aria-label="Heatmap grouping" value={group} onChange={event => setGroup(event.target.value as HeatmapGroupBy)}><option value="sector">Sector</option><option value="industry">Industry</option></select></label>
      <label className="min-w-0 space-y-1 text-xs text-terminal-muted"><span className="block">Size by</span><select aria-label="Heatmap size" value={sizeBy} onChange={event => setSizeBy(event.target.value as HeatmapSizeBy)}>{SIZE_OPTIONS.map(value => <option key={value.value} value={value.value}>{value.label}</option>)}</select></label>
    </section>
    <DegradedBanner info={query.data?.degraded} className="!text-xs"/>
    {query.isFetching ? <p role="status" className="text-sm text-terminal-muted">Loading heatmap data…</p> : null}
    {query.isError ? <p role="alert" className="text-sm text-terminal-neg">Failed to load heatmap data. Any previously displayed values are unrefreshed.</p> : null}
    <div className="grid min-w-0 grid-cols-1 items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_300px]">
      <section aria-label="Heatmap results" className="min-w-0 space-y-3 rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
          <label className="block min-w-0 max-w-full space-y-1 text-xs text-terminal-muted"><span className="block">Inspect group</span><select aria-label="Inspect heatmap group" className="w-full min-w-0 max-w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm" value={activeGroup?.name || ""} onChange={event => { setActiveGroupName(event.target.value); setInspected(""); }}><option value="">All groups</option>{query.data?.groups.map(row => <option key={row.name} value={row.name}>{row.name}</option>)}</select></label>
          {width >= 768 ? <div role="group" aria-label="Heatmap presentation" className="flex gap-2">{["map", "list"].map(value => <button key={value} aria-pressed={view === value} className="rounded border border-terminal-border px-3 py-2 text-sm capitalize" onClick={() => setView(value)}>{value}</button>)}</div> : null}
        </div>
        <p className="text-sm">{activeGroup?.name || "All groups"} · {market} · {period} · {SIZE_OPTIONS.find(row => row.value === sizeBy)?.label}</p>
        <p className="text-xs text-terminal-muted">{list ? "Full names and quote metrics. Select a symbol to open its security." : "Focus or hover a tile to inspect it below. Select a tile to open its security; List shows full names and metrics."} Grey means unavailable or a move near zero; inspect the value to distinguish them.</p>
        <div ref={containerRef} className="min-w-0 max-w-full">
          {!items.length ? <p className="py-6 text-sm text-terminal-muted">{query.isFetching ? "Waiting for the current scope…" : query.isError ? "No heatmap values available for this scope." : "No heatmap data available."}</p> : list ? <div data-testid="heatmap-mobile-list" className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">{items.map(row => <article key={row.symbol} className="min-w-0 space-y-2 rounded border border-terminal-border bg-terminal-bg p-3"><button onClick={() => open(row.symbol)} className="text-left text-sm font-semibold text-terminal-accent underline">{row.symbol}</button><p className="text-sm">{row.name}</p><p className="text-xs text-terminal-muted">{row.sector} · {row.industry}</p><dl className="grid min-w-0 grid-cols-2 gap-2 text-sm">{[["Price", formatCurrency(row.price, market)], ["Change", formatPct(row.change_pct)], ["Volume", formatCompact(row.volume)], ["Market cap", formatCompact(row.market_cap)]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-terminal-muted">{label}</dt><dd>{value}</dd></div>)}</dl></article>)}</div> : <svg width={width} height={480} className="block max-w-full" aria-label="Equity heatmap tiles" data-testid="market-heatmap-svg">{layout.leaves.map(node => {
            const row = node.data, w = Math.max(0, node.x1 - node.x0), h = Math.max(0, node.y1 - node.y0);
            return <g key={row.symbol} transform={`translate(${node.x0}, ${node.y0})`} role="link" tabIndex={0} aria-label={`${row.symbol} · ${row.name} · ${formatPct(row.change_pct)}`} onMouseEnter={() => setInspected(row.symbol)} onFocus={() => setInspected(row.symbol)} onClick={() => open(row.symbol)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(row.symbol); } }} className="cursor-pointer outline-terminal-accent"><title>{row.symbol} · {row.name}</title><rect width={w} height={h} rx={2} fill={heatColor(row.change_pct)} data-testid="heatmap-rect"/>{w > Math.max(72, row.symbol.length * 9 + 16) && h > 30 ? <text x={8} y={20} fill="#fff" fontSize={14} fontWeight={700}>{row.symbol}</text> : null}{w > 80 && h > 55 ? <text x={8} y={40} fill="#fff" fontSize={12}>{formatPct(row.change_pct)}</text> : null}</g>;
          })}</svg>}
        </div>
        {!list ? <section aria-label="Heatmap tile inspection" className="min-w-0 rounded border border-terminal-border p-3">{item ? <><h2 className="text-sm font-semibold">{item.symbol} · {item.name}</h2><p className="mt-2 text-xs text-terminal-muted">{item.sector} · {item.industry}</p><p className="mt-2 text-sm">Price {formatCurrency(item.price, market)} · Change {formatPct(item.change_pct)} · Volume {formatCompact(item.volume)} · Market cap {formatCompact(item.market_cap)}</p></> : <p className="text-sm text-terminal-muted">Focus or hover a tile for its full name and values.</p>}</section> : null}
      </section>
      <section aria-label="Heatmap coverage" className="min-w-0 space-y-3 rounded border border-terminal-border p-3"><h2 className="text-sm font-semibold">Universe snapshot</h2><dl className="grid min-w-0 grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-terminal-muted">Constituents</dt><dd>{query.data ? query.data.data.length : "Unavailable"}</dd></div><div><dt className="text-xs text-terminal-muted">Aggregate sizing value</dt><dd>{formatCompact(query.data?.total_value)}</dd></div></dl><p className="text-xs text-terminal-muted">US and India are the existing market choices. Prices retain the selected market’s existing USD/INR convention; no display-currency conversion is performed here. No observation timestamp is supplied by this response.</p><details><summary className="cursor-pointer text-sm">Constituent preview</summary><div className="mt-3 space-y-2">{(query.data?.data || []).slice(0,8).map(row => <button key={row.symbol} onClick={() => open(row.symbol)} className="block w-full rounded border border-terminal-border p-2 text-left text-sm"><span className="block text-terminal-accent">{row.symbol} · {formatPct(row.change_pct)}</span><span className="block">{row.name}</span></button>)}</div></details></section>
    </div>
  </main>;
}
export default MarketHeatmapPage;
