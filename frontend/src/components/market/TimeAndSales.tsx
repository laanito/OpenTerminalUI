import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTapeRecent,fetchTapeSummary,type TapeTrade } from "../../api/client";
import { useStockStore } from "../../store/stockStore";
import { finite } from "../terminal/AnalyticsRead";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { CoverageNotice,MarketMetrics,marketNumber } from "./MarketReadout";
type TradeFilter = "all" | "buy" | "sell" | "large";
interface TimeAndSalesProps { ticker?: string; limit?: number; className?: string }
interface EnrichedTapeTrade extends TapeTrade { id: string; isLarge: boolean }
const ROW_HEIGHT = 40,OVERSCAN = 8,STORAGE_LIMIT = 2000;
function formatTradeTime(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "--:--:--";
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function buildTradeId(trade: TapeTrade): string {
  return `${trade.timestamp}:${trade.price}:${trade.quantity}:${trade.side}`;
}

function computeLargeTradeFlags(trades: TapeTrade[]): EnrichedTapeTrade[] {
  if (!trades.length) return [];
  const avgTradeSize = trades.reduce((sum, trade) => sum + trade.quantity, 0) / trades.length;
  return trades.map((trade) => ({
    ...trade,
    id: buildTradeId(trade),
    isLarge: trade.quantity > avgTradeSize * 2,
  }));
}

export function TimeAndSales({ ticker,limit = 500,className = "" }: TimeAndSalesProps) {
 const storeTicker = useStockStore(state => state.ticker),activeTicker = (ticker || storeTicker || "AAPL").trim().toUpperCase(),scope = JSON.stringify([activeTicker,limit]);
 const [tradeFilter,setTradeFilter] = useState<TradeFilter>("all"),[minSize,setMinSize] = useState("0"),[follow,setFollow] = useState(true),[inspecting,setInspecting] = useState(false);
 const [buffer,setBuffer] = useState<{ scope: string; trades: TapeTrade[] }>({ scope: "",trades: [] }),[scroll,setScroll] = useState({ key: "",top: 0 });
 const scrollRef = useRef<HTMLDivElement>(null);
 const recentQuery = useQuery({ queryKey: ["tape","recent",activeTicker,limit],queryFn: () => fetchTapeRecent(activeTicker,limit),refetchInterval: 5000,staleTime: 4000,retry: false });
 const summaryQuery = useQuery({ queryKey: ["tape","summary",activeTicker,limit],queryFn: () => fetchTapeSummary(activeTicker,limit),refetchInterval: 5000,staleTime: 4000,retry: false });
 useEffect(() => { if (!recentQuery.data) return; const incoming = Array.isArray(recentQuery.data.trades) ? recentQuery.data.trades : []; setBuffer(current => { if (!incoming.length) return { scope,trades: [] }; const old = current.scope === scope ? current.trades : [],seen = new Set(old.map(buildTradeId)),additions = incoming.filter(trade => !seen.has(buildTradeId(trade))),merged = [...additions,...old]; merged.sort((left,right) => right.timestamp.localeCompare(left.timestamp)); return { scope,trades: merged.slice(0,STORAGE_LIMIT) }; }); },[recentQuery.data,scope]);
 const trades = buffer.scope === scope && !recentQuery.isError ? buffer.trades : [];
 const enrichedTrades = useMemo(() => computeLargeTradeFlags(trades),[trades]);
 const minimumSize = minSize.trim() ? Number(minSize) : 0,validSize = finite(minimumSize) && Number.isInteger(minimumSize) && minimumSize >= 0;
 const filteredTrades = useMemo(() => validSize ? enrichedTrades.filter(trade => trade.quantity >= minimumSize && (tradeFilter === "all" || (tradeFilter === "large" ? trade.isLarge : trade.side === tradeFilter))) : [],[enrichedTrades,minimumSize,validSize,tradeFilter]);
 const filterKey = JSON.stringify([scope,tradeFilter,minimumSize]),scrollTop = scroll.key === filterKey ? scroll.top : 0;
 useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; setScroll({ key: filterKey,top: 0 }); },[filterKey]);
 useEffect(() => { if (!follow || inspecting) return; if (scrollRef.current) scrollRef.current.scrollTop = 0; setScroll({ key: filterKey,top: 0 }); },[buffer,follow,inspecting,filterKey]);
 const visibleCount = 18,startIndex = Math.max(0,Math.min(Math.max(0,filteredTrades.length-1),Math.floor(scrollTop/ROW_HEIGHT)-OVERSCAN)),endIndex = Math.min(filteredTrades.length,startIndex+visibleCount+OVERSCAN*2),visibleTrades = filteredTrades.slice(startIndex,endIndex);
 const summary = !summaryQuery.isError ? summaryQuery.data : undefined;
 const usableSummary = Boolean(summary && !(summary.degraded && summary.total_volume === 0));
 const sellPct = usableSummary && finite(summary?.total_volume) && finite(summary?.sell_volume) ? summary.total_volume > 0 ? Math.max(0,Math.min(100,summary.sell_volume/summary.total_volume*100)) : 0 : null;
 const summaryPercent = (value: unknown) => usableSummary && finite(value) ? `${value.toFixed(1)}%` : "Unavailable";
 const fetching = recentQuery.isFetching || summaryQuery.isFetching;
 return <section aria-label="Time and sales workspace" aria-busy={recentQuery.isLoading} className={`min-w-0 ${className}`}><TerminalPanel title="Time & Sales" subtitle={`${activeTicker} · symbol-scoped tape`} className="min-w-0" bodyClassName="min-w-0 space-y-3">
  <div className="flex min-w-0 flex-wrap items-end gap-3"><label className="min-w-0 flex-1 basis-40 space-y-2 text-xs">Trade filter<TerminalInput as="select" className="block text-sm" value={tradeFilter} onChange={event => setTradeFilter(event.target.value as TradeFilter)}><option value="all">All trades</option><option value="buy">Buys only</option><option value="sell">Sells only</option><option value="large">Large only</option></TerminalInput></label><label className="min-w-0 flex-1 basis-40 space-y-2 text-xs">Minimum size (whole units)<TerminalInput type="number" min={0} step={1} className="block text-sm" value={minSize} onChange={event => setMinSize(event.target.value)} /></label><TerminalButton type="button" variant={follow ? "accent" : "default"} aria-pressed={follow} onClick={() => setFollow(value => !value)} className="normal-case tracking-normal">Auto-follow</TerminalButton><TerminalButton type="button" disabled={fetching} onClick={() => { void recentQuery.refetch(); void summaryQuery.refetch(); }} className="normal-case tracking-normal">Refresh tape</TerminalButton></div>
  <p className="min-h-8 text-xs text-terminal-muted">{follow && !inspecting ? "Auto-follow on · checks every 5s." : "Auto-follow paused · checks continue every 5s."}</p>
  <CoverageNotice name="Tape" info={recentQuery.isError ? undefined : recentQuery.data?.degraded} />
  <p role="status" className="min-h-4 text-xs text-terminal-muted">{fetching ? "Tape request in progress…" : recentQuery.isError ? "Tape request failed." : "Tape request complete."}</p>
  {recentQuery.isError ? <p role="alert" className="text-sm text-terminal-neg">Could not retrieve trades. Refresh tape to retry; no previous trades are shown.</p> : recentQuery.isLoading ? <p role="status" className="text-sm text-terminal-muted">Loading tape…</p> : !validSize ? <p role="alert" className="text-sm text-terminal-neg">Minimum size must be a non-negative whole number. Your draft is kept.</p> : !trades.length ? <p role="status" className="text-sm text-terminal-muted">{recentQuery.data?.degraded ? "No tape available for this symbol." : "No trades returned for this symbol."}</p> : !filteredTrades.length ? <p role="status" className="text-sm text-terminal-muted">No trades match the current filter.</p> : <>
   <p className="text-xs text-terminal-muted">{filteredTrades.length} matching trades · {trades.length} in this page’s local buffer (maximum {STORAGE_LIMIT}).</p>
   <div ref={scrollRef} role="region" aria-label="Time and sales trades" tabIndex={0} className="h-[28rem] min-w-0 overflow-auto rounded border border-terminal-border focus-visible:outline focus-visible:outline-terminal-accent" onMouseEnter={() => setInspecting(true)} onMouseLeave={event => setInspecting(event.currentTarget.contains(document.activeElement))} onFocus={() => setInspecting(true)} onBlur={event => setInspecting(event.currentTarget.matches(":hover"))} onScroll={event => setScroll({ key: filterKey,top: event.currentTarget.scrollTop })}>
    <table aria-label="Time and sales values" aria-rowcount={filteredTrades.length+1} className="w-full min-w-[600px] text-left text-sm tabular-nums"><thead className="sticky top-0 z-10 bg-terminal-panel text-xs text-terminal-muted"><tr aria-rowindex={1}><th scope="col" className="p-3 font-medium">Time (local)</th><th scope="col" className="p-3 font-medium">Side</th><th scope="col" className="p-3 text-right font-medium">Price</th><th scope="col" className="p-3 text-right font-medium">Size</th><th scope="col" className="p-3 text-right font-medium">Value</th></tr></thead><tbody>
     {startIndex > 0 && <tr aria-hidden="true" style={{ height: startIndex*ROW_HEIGHT }}><td colSpan={5} /></tr>}
     {visibleTrades.map((trade,index) => <tr key={trade.id} aria-rowindex={startIndex+index+2} data-side={trade.side} style={{ height: ROW_HEIGHT }} className={`border-b border-terminal-border/40 ${trade.isLarge ? "bg-terminal-accent/10" : ""}`}><th scope="row" className="whitespace-nowrap px-3 font-normal"><time dateTime={trade.timestamp} title={trade.timestamp}>{formatTradeTime(trade.timestamp)}</time></th><td className="whitespace-nowrap px-3"><span className={trade.side === "buy" ? "text-terminal-pos" : trade.side === "sell" ? "text-terminal-neg" : "text-terminal-muted"}>{trade.side}</span>{trade.isLarge ? " · large" : ""}</td><td className="whitespace-nowrap px-3 text-right">{marketNumber(trade.price)}</td><td className="whitespace-nowrap px-3 text-right">{marketNumber(trade.quantity)}</td><td className="whitespace-nowrap px-3 text-right">{marketNumber(trade.value,2)}</td></tr>)}
     {endIndex < filteredTrades.length && <tr aria-hidden="true" style={{ height: (filteredTrades.length-endIndex)*ROW_HEIGHT }}><td colSpan={5} /></tr>}
    </tbody></table>
   </div>
  </>}
  <details className="min-w-0"><summary className="cursor-pointer text-sm">Tape summary · independent window read</summary><div className="mt-3 space-y-3"><CoverageNotice name="Tape summary" info={summary?.degraded} />{summaryQuery.isLoading ? <p role="status" className="text-sm text-terminal-muted">Loading tape summary…</p> : summaryQuery.isError ? <p role="alert" className="text-sm text-terminal-neg">Could not retrieve tape summary. Refresh tape to retry; no previous summary values are shown.</p> : <MarketMetrics items={[["Total volume",usableSummary ? marketNumber(summary?.total_volume) : "Unavailable"],["Buy volume",usableSummary ? marketNumber(summary?.buy_volume) : "Unavailable"],["Buy volume percentage",summaryPercent(summary?.buy_pct)],["Sell volume percentage",summaryPercent(sellPct)],["Large trades",usableSummary ? marketNumber(summary?.large_trade_count,0) : "Unavailable"],["Trades per minute",usableSummary ? marketNumber(summary?.trades_per_min,2) : "Unavailable"]]} />}<p className="text-xs text-terminal-muted">The summary is a separate request from the buffered rows. “Large” in this page means above twice the buffered average size; summary counts use the service’s window. Times use your browser’s local timezone; hover reveals full timestamps. Values have no currency metadata here.</p></div></details>
 </TerminalPanel></section>;
}
