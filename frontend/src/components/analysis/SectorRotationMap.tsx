import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { fetchSectorRotation } from "../../api/client";
import { DegradedBanner } from "../common/DegradedBanner";

type Props = { defaultBenchmark?: string; width?: number | string; height?: number | string };
function quadrant(x: number, y: number) {
  if (x >= 100 && y >= 100) return { label: "Leading", color: "#22c55e" };
  if (x >= 100 && y < 100) return { label: "Weakening", color: "#eab308" };
  if (x < 100 && y < 100) return { label: "Lagging", color: "#ef4444" };
  return { label: "Improving", color: "#3b82f6" };
}
export function SectorRotationMap({ defaultBenchmark = "SPY", width = "100%", height = 400 }: Props) {
  const navigate = useNavigate(), markerId = useId().replace(/:/g, "");
  const [benchmark, setBenchmark] = useState(defaultBenchmark);
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const query = useQuery({ queryKey: ["sector-rotation", benchmark], queryFn: () => fetchSectorRotation(benchmark), refetchInterval: 3600_000, retry: false });
  const data = query.data;
  const processedData = useMemo(() => (data?.sectors || []).map(sector => {
    const index = historyIndex === null ? sector.trail.length - 1 : Math.min(Math.max(0, historyIndex), sector.trail.length - 1);
    return { ...sector, current: sector.trail[index], displayTrail: sector.trail.slice(0, index + 1) };
  }), [data, historyIndex]);
  const maxHistory = useMemo(() => Math.max(0, ...(data?.sectors || []).map(sector => sector.trail.length - 1)), [data]);
  useEffect(() => {
    if (!isPlaying || maxHistory <= 0) return;
    let step = historyIndex === null || historyIndex >= maxHistory ? 0 : historyIndex;
    setHistoryIndex(step);
    const timer = window.setInterval(() => {
      step += 1; setHistoryIndex(step);
      if (step >= maxHistory) { window.clearInterval(timer); setIsPlaying(false); }
    }, 500);
    return () => window.clearInterval(timer);
    // Playback captures the starting slider position; manual slider changes pause it.
  }, [isPlaying, maxHistory]);
  const open = (symbol: string) => navigate(`/equity/stocks?ticker=${encodeURIComponent(symbol)}`);
  const hasPoints = processedData.some(sector => sector.current);
  return <section aria-label="Sector rotation" className="min-h-0 min-w-0 space-y-3 overflow-auto bg-terminal-bg p-3 [overflow-wrap:anywhere]" style={{ width, maxWidth: "100%", height: height === "100%" ? "100%" : undefined }}>
    <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
      <label className="block min-w-0 space-y-1 text-xs text-terminal-muted"><span className="block">Rotation benchmark</span><select aria-label="Rotation benchmark" className="max-w-full rounded border border-terminal-border bg-terminal-panel p-2 text-sm text-terminal-text" value={benchmark} onChange={event => { setBenchmark(event.target.value); setHistoryIndex(null); setIsPlaying(false); setHoveredSymbol(null); }}><option value="SPY">SPY · US equities</option><option value="QQQ">QQQ · US technology</option><option value="^NSEI">NIFTY 50 · India</option></select></label>
      <button disabled={query.isFetching} onClick={() => void query.refetch()} aria-label="Refresh rotation" className="rounded border border-terminal-border px-3 py-2 text-sm">Refresh</button>
    </header>
    <p className="text-xs text-terminal-muted">Benchmark: {data?.benchmark || benchmark} · Response timestamp: {data?.timestamp || "Unavailable"}.</p>
    <DegradedBanner info={data?.degraded} className="!text-xs"/>
    {query.isFetching ? <p role="status" className="text-sm text-terminal-muted">Loading relative rotation…</p> : null}
    {query.isError ? <p role="alert" className="text-sm text-terminal-neg">Failed to load sector rotation data. Any displayed points are unrefreshed.</p> : null}
    <div className="flex min-w-0 flex-wrap items-end gap-3 rounded border border-terminal-border p-3">
      <button aria-label={isPlaying ? "Pause rotation playback" : "Play rotation playback"} disabled={!hasPoints || maxHistory === 0} onClick={() => setIsPlaying(value => !value)} className="rounded border border-terminal-border px-3 py-2 text-sm text-terminal-accent">{isPlaying ? "Pause" : "Play"}</button>
      <label className="min-w-0 flex-1 basis-40 space-y-1 text-xs text-terminal-muted"><span className="block">Historical point</span><input aria-label="Rotation historical point" type="range" min={0} max={maxHistory} disabled={!hasPoints} value={historyIndex ?? maxHistory} onChange={event => { setHistoryIndex(Number(event.target.value)); setIsPlaying(false); }} className="w-full accent-terminal-accent"/></label>
      <p className="text-xs">{processedData[0]?.current?.date || "Date unavailable"}</p>
    </div>
    {!hasPoints ? <p className="py-6 text-sm text-terminal-muted">{query.isFetching ? "Waiting for rotation points…" : query.isError ? "No rotation observations available for this benchmark." : "No dated rotation trails returned."}</p> : <>
      <div className={`grid min-w-0 grid-cols-1 items-start gap-3 ${height === "100%" ? "" : "lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]"}`}>
      <div role="img" aria-label={`Relative rotation trails against ${benchmark}; dated values and sector links follow`} className="relative min-w-0 rounded border border-terminal-border bg-[#0a0a0a]" style={{ aspectRatio: "1", width: "100%", maxWidth: typeof height === "number" ? height : 400 }}>
        <svg aria-hidden="true" width="100%" height="100%" viewBox="80 80 40 40" preserveAspectRatio="xMidYMid meet" className="absolute inset-0">
          <defs><marker id={markerId} markerWidth="3" markerHeight="3" refX="2.5" refY="1.5" orient="auto"><polygon points="0 0, 3 1.5, 0 3" fill="#94a3b8"/></marker></defs>
          <rect x="100" y="80" width="20" height="20" fill="#22c55e" opacity=".07"/><rect x="100" y="100" width="20" height="20" fill="#eab308" opacity=".07"/><rect x="80" y="100" width="20" height="20" fill="#ef4444" opacity=".07"/><rect x="80" y="80" width="20" height="20" fill="#3b82f6" opacity=".07"/>
          <line x1="80" y1="100" x2="120" y2="100" stroke="#64748b" strokeWidth=".15"/><line x1="100" y1="80" x2="100" y2="120" stroke="#64748b" strokeWidth=".15"/>
          {processedData.map(sector => {
            if (!sector.current) return null;
            const selected = hoveredSymbol === sector.symbol, color = quadrant(sector.current.x, sector.current.y).color;
            return <g key={sector.symbol} opacity={hoveredSymbol && !selected ? .2 : 1} onMouseEnter={() => setHoveredSymbol(sector.symbol)} onMouseLeave={() => setHoveredSymbol(null)} onClick={() => open(sector.symbol)} className="cursor-pointer"><title>{sector.symbol}</title>{sector.displayTrail.length > 1 ? <polyline points={sector.displayTrail.map(point => `${point.x},${100 - (point.y - 100)}`).join(" ")} fill="none" stroke={color} strokeWidth={selected ? .4 : .2} markerEnd={`url(#${markerId})`}/> : null}<circle cx={sector.current.x} cy={100 - (sector.current.y - 100)} r={selected ? .8 : .5} fill={color}/></g>;
          })}
        </svg>
      </div>
      <div className="min-w-0 space-y-3">
      <details className="space-y-3 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Reading the rotation plot</summary>      <div className="grid min-w-0 grid-cols-2 gap-2 text-xs sm:grid-cols-4">{[quadrant(101,101), quadrant(101,99), quadrant(99,99), quadrant(99,101)].map(value => <span key={value.label} className="rounded border border-terminal-border p-2" style={{ color: value.color }}>{value.label}</span>)}</div>
      <p className="text-xs text-terminal-muted">Playback shows dated points in this response, not live ticks. The plot window is 80–120; out-of-window values remain readable below. RS-Momentum increases upward; RS-Ratio increases to the right. Both axes centre on 100. Focus or hover a sector below to highlight its trail; its button opens the existing stock route.</p>
</details>
      <div aria-label="Rotation sector values" className="grid min-w-0 gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}>{processedData.map(sector => <article key={sector.symbol} className={`min-w-0 space-y-2 rounded border p-3 ${hoveredSymbol === sector.symbol ? "border-terminal-accent" : "border-terminal-border"}`} onMouseEnter={() => setHoveredSymbol(sector.symbol)} onMouseLeave={() => setHoveredSymbol(null)}><button onFocus={() => setHoveredSymbol(sector.symbol)} onBlur={() => setHoveredSymbol(null)} onClick={() => open(sector.symbol)} className="text-left text-sm font-semibold text-terminal-accent underline">{sector.symbol}</button>{sector.current ? <><p className="text-xs" style={{ color: quadrant(sector.current.x, sector.current.y).color }}>{quadrant(sector.current.x, sector.current.y).label} · {sector.current.date}</p><p className="text-sm">RS-Ratio {sector.current.x.toFixed(2)} · RS-Momentum {sector.current.y.toFixed(2)}</p></> : <p className="text-sm text-terminal-muted">Dated trail unavailable.</p>}</article>)}</div>
      </div></div>
    </>}
  </section>;
}
