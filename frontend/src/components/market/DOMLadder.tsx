import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDepth, type DepthSnapshotResponse } from "../../api/client";
import { AnalyticsTable, finite } from "../terminal/AnalyticsRead";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { CoverageNotice, MarketMetrics, marketNumber, observationTime } from "./MarketReadout";
type Props = { symbol: string; market: string; className?: string; onSnapshot?: (snapshot: DepthSnapshotResponse | null) => void };
type LadderRow = { price: number; bidQty: number; askQty: number; bidOrders: number; askOrders: number; bidCumulative: number; askCumulative: number; bidFlash: "up" | "down" | null; askFlash: "up" | "down" | null; volumeAtPrice: number };
const REFRESH_OPTIONS = [{ label: "1 second",value: 1000 },{ label: "2 seconds",value: 2000 },{ label: "5 seconds",value: 5000 }] as const;
const DEPTH_OPTIONS = [10,20,40] as const;
function normalizeMarket(value: string): string {
  const market = String(value || "").trim().toUpperCase();
  if (market === "NSE" || market === "BSE" || market === "IN") return "IN";
  if (market === "CRYPTO" || market === "BINANCE") return "CRYPTO";
  return "US";
}

function decimalsFromTick(tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize >= 1) return 0;
  const raw = String(tickSize);
  const decimalPart = raw.includes(".") ? raw.split(".")[1] || "" : "";
  return Math.min(4, decimalPart.replace(/0+$/, "").length || 2);
}

function roundToTick(price: number, tickSize: number, decimals: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(tickSize) || tickSize <= 0) return Number(price.toFixed(Math.max(0, decimals)));
  return Number((Math.round(price / tickSize) * tickSize).toFixed(Math.max(0, decimals)));
}

function formatPrice(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function formatSigned(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function buildRows(snapshot: DepthSnapshotResponse, levels: number, previous: DepthSnapshotResponse | null): LadderRow[] {
  const tickSize = snapshot.tick_size || 0.01;
  const decimals = decimalsFromTick(tickSize);
  const anchor = roundToTick(snapshot.last_price || snapshot.mid_price, tickSize, decimals);

  const bidMap = new Map(snapshot.bids.map((level) => [level.price, level]));
  const askMap = new Map(snapshot.asks.map((level) => [level.price, level]));
  const prevBidMap = new Map((previous?.bids ?? []).map((level) => [level.price, level.quantity ?? level.size ?? 0]));
  const prevAskMap = new Map((previous?.asks ?? []).map((level) => [level.price, level.quantity ?? level.size ?? 0]));

  const rows: LadderRow[] = [];
  for (let offset = levels; offset >= -levels; offset -= 1) {
    const price = Number((anchor + offset * tickSize).toFixed(decimals));
    const bid = bidMap.get(price);
    const ask = askMap.get(price);
    const bidQty = bid?.quantity ?? bid?.size ?? 0;
    const askQty = ask?.quantity ?? ask?.size ?? 0;
    const prevBidQty = prevBidMap.get(price) ?? bidQty;
    const prevAskQty = prevAskMap.get(price) ?? askQty;
    const distanceWeight = Math.max(0.15, 1 - Math.min(1, Math.abs(offset) / Math.max(1, levels)));
    const volumeAtPrice = Math.round((bidQty + askQty || snapshot.last_qty) * (0.35 + distanceWeight * 0.65));

    rows.push({
      price,
      bidQty,
      askQty,
      bidOrders: bid?.orders ?? 0,
      askOrders: ask?.orders ?? 0,
      bidCumulative: bid?.cumulative_qty ?? 0,
      askCumulative: ask?.cumulative_qty ?? 0,
      bidFlash: bidQty > prevBidQty ? "up" : bidQty < prevBidQty ? "down" : null,
      askFlash: askQty > prevAskQty ? "up" : askQty < prevAskQty ? "down" : null,
      volumeAtPrice,
    });
  }
  return rows;
}

export function DOMLadder({ symbol,market,className = "",onSnapshot }: Props) {
 const normalizedSymbol = String(symbol || "").trim().toUpperCase() || "AAPL",normalizedMarket = normalizeMarket(market);
 const [autoCenter,setAutoCenter] = useState(true),[showCumulative,setShowCumulative] = useState(false),[levels,setLevels] = useState<number>(20),[refreshMs,setRefreshMs] = useState<number>(2000);
 const scope = JSON.stringify([normalizedSymbol,normalizedMarket,levels]);
 const [comparison,setComparison] = useState<{ scope: string; value: DepthSnapshotResponse | null }>({ scope: "",value: null });
 const previous = useRef<{ scope: string; value: DepthSnapshotResponse } | null>(null),scrollRef = useRef<HTMLDivElement>(null),lastPriceRowRef = useRef<HTMLDivElement>(null),inspecting = useRef(false);
 const depthQuery = useQuery({ queryKey: ["dom-depth",normalizedMarket,normalizedSymbol,levels],queryFn: () => fetchDepth(normalizedSymbol,normalizedMarket,levels),refetchInterval: refreshMs,staleTime: Math.max(500,refreshMs-100),retry: false });
 const snapshot = !depthQuery.isError ? depthQuery.data ?? null : null;
 useEffect(() => { if (!snapshot) return; const last = previous.current; setComparison({ scope,value: last?.scope === scope ? last.value : null }); previous.current = { scope,value: snapshot }; }, [snapshot,scope]);
 useEffect(() => { onSnapshot?.(snapshot); }, [snapshot,onSnapshot]);
 const hasBook = Boolean(snapshot && ((snapshot.bids?.length || 0)+(snapshot.asks?.length || 0) > 0));
 const anchorValue = snapshot?.last_price || snapshot?.mid_price;
 const canProject = hasBook && finite(anchorValue) && anchorValue > 0;
 const tickSize = snapshot?.tick_size || .01,decimals = decimalsFromTick(tickSize),anchorPrice = canProject ? roundToTick(anchorValue!,tickSize,decimals) : null;
 const rows = useMemo(() => snapshot && canProject ? buildRows(snapshot,levels,comparison.scope === scope ? comparison.value : null) : [], [snapshot,canProject,levels,comparison,scope]);
 const maxDisplayedQty = useMemo(() => rows.reduce((max,row) => Math.max(max,showCumulative ? row.bidCumulative : row.bidQty,showCumulative ? row.askCumulative : row.askQty,row.volumeAtPrice),0),[rows,showCumulative]);
 const bestBid = snapshot?.bids?.[0]?.price,bestAsk = snapshot?.asks?.[0]?.price;
 const total = hasBook && finite(snapshot?.total_bid_qty) && finite(snapshot?.total_ask_qty) ? snapshot.total_bid_qty+snapshot.total_ask_qty : null;
 const bidShare = total && total > 0 ? snapshot!.total_bid_qty/total*100 : null;
 const spreadBps = hasBook && finite(snapshot?.spread) && finite(snapshot?.last_price) && snapshot.last_price > 0 ? snapshot.spread/snapshot.last_price*10000 : null;
 useEffect(() => { if (!autoCenter || inspecting.current) return; const area = scrollRef.current,row = lastPriceRowRef.current; if (!area || !row) return; area.scrollTo({ top: area.scrollTop+row.getBoundingClientRect().top-area.getBoundingClientRect().top-(area.clientHeight-row.clientHeight)/2,behavior: "auto" }); },[autoCenter,snapshot,levels]);
 return <section aria-label="Depth workspace" aria-busy={depthQuery.isLoading} className={`min-w-0 ${className}`}><TerminalPanel title="DOM Ladder" subtitle={`${normalizedSymbol} · request context ${normalizedMarket}`} className="min-w-0" bodyClassName="min-w-0 space-y-3">
  <div className="flex min-w-0 flex-wrap items-end gap-3"><TerminalButton type="button" variant={autoCenter ? "accent" : "default"} aria-pressed={autoCenter} onClick={() => setAutoCenter(value => !value)} className="normal-case tracking-normal">Auto-center</TerminalButton><TerminalButton type="button" variant={showCumulative ? "accent" : "default"} aria-pressed={showCumulative} onClick={() => setShowCumulative(value => !value)} className="normal-case tracking-normal">Cumulative</TerminalButton><label className="min-w-0 flex-1 basis-28 space-y-2 text-xs">Depth levels<TerminalInput as="select" className="block text-sm" value={levels} onChange={event => setLevels(Number(event.target.value))}>{DEPTH_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}</TerminalInput></label><label className="min-w-0 flex-1 basis-36 space-y-2 text-xs">Depth refresh<TerminalInput as="select" className="block text-sm" value={refreshMs} onChange={event => setRefreshMs(Number(event.target.value))}>{REFRESH_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</TerminalInput></label><TerminalButton type="button" disabled={depthQuery.isFetching} onClick={() => void depthQuery.refetch()} className="normal-case tracking-normal">Refresh depth</TerminalButton></div>
  <p role="status" className="min-h-4 text-xs text-terminal-muted">{depthQuery.isFetching ? "Depth request in progress…" : depthQuery.isError ? "Depth request failed." : "Depth request complete."}</p>
  {depthQuery.isError ? <p role="alert" className="text-sm text-terminal-neg">Could not retrieve depth. Refresh depth to retry; no previous book is shown.</p> : snapshot ? <><p className="break-words text-xs text-terminal-muted">Reported symbol: {snapshot.symbol || "Unavailable"} · {snapshot.provider_key || "Unavailable"} · snapshot {observationTime(snapshot.as_of)}.</p><CoverageNotice name="Depth" info={snapshot.degraded} />{!hasBook && <p role="status" className="text-sm text-terminal-muted">No depth available for this symbol. No price ladder is shown.</p>}</> : null}
  {hasBook && snapshot && <><p className="break-words text-sm tabular-nums">Book reference: {marketNumber(snapshot.last_price)} · Spread: {marketNumber(snapshot.spread)}</p><details className="min-w-0"><summary className="cursor-pointer text-sm">Snapshot metrics</summary><div className="mt-3 space-y-3"><MarketMetrics items={[["Book reference",marketNumber(snapshot.last_price)],["Spread",marketNumber(snapshot.spread)],["Spread basis points",finite(spreadBps) ? `${spreadBps.toFixed(1)} bps` : "Unavailable"],["Imbalance",finite(snapshot.imbalance) ? `${formatSigned(snapshot.imbalance*100)}%` : "Unavailable"]]} />
   {finite(bidShare) ? <div className="space-y-2"><p className="break-words text-xs text-terminal-muted">Reported bid / ask quantities: {marketNumber(snapshot.total_bid_qty)} / {marketNumber(snapshot.total_ask_qty)}</p><div aria-hidden="true" className="flex h-2 overflow-hidden rounded border border-terminal-border"><div className="bg-blue-500/60" style={{ width: `${Math.max(0,Math.min(100,bidShare))}%` }} /><div className="bg-red-500/60" style={{ width: `${Math.max(0,Math.min(100,100-bidShare))}%` }} /></div></div> : <p className="text-xs text-terminal-muted">Bid / ask shares unavailable.</p>}
   </div></details><p className="text-xs text-terminal-muted">{snapshot.tick_size > 0 ? `Display grid uses tick ${marketNumber(snapshot.tick_size)}.` : "Tick size not supplied: the display grid assumes 0.01."} Exact provider levels are below.</p>
   {canProject ? <div ref={scrollRef} role="region" aria-label="Depth ladder values" tabIndex={0} data-testid="dom-scroll-region" className="relative h-[28rem] min-w-0 overflow-auto rounded border border-terminal-border focus-visible:outline focus-visible:outline-terminal-accent" onMouseEnter={() => { inspecting.current = true; }} onMouseLeave={event => { inspecting.current = event.currentTarget.contains(document.activeElement); }} onFocus={() => { inspecting.current = true; }} onBlur={event => { inspecting.current = event.currentTarget.matches(":hover"); }}><div role="table" aria-label="Depth price grid" className="min-w-[480px]"><div role="row" className="sticky top-0 z-20 grid grid-cols-[minmax(120px,1fr)_144px_minmax(120px,1fr)] gap-2 border-b border-terminal-border bg-terminal-panel px-3 py-3 text-xs text-terminal-muted"><span role="columnheader" className="text-right">{showCumulative ? "Cumulative bid" : "Bid quantity"}</span><span role="columnheader" className="text-center">Price grid</span><span role="columnheader">{showCumulative ? "Cumulative ask" : "Ask quantity"}</span></div>
    {rows.map(row => { const bid = showCumulative ? row.bidCumulative : row.bidQty,ask = showCumulative ? row.askCumulative : row.askQty,isReference = anchorPrice !== null && Math.abs(row.price-anchorPrice) < tickSize/2; return <div key={row.price} role="row" ref={isReference ? lastPriceRowRef : null} data-testid="dom-row" data-price={row.price} className={`grid min-h-10 grid-cols-[minmax(120px,1fr)_144px_minmax(120px,1fr)] gap-2 border-b border-terminal-border/40 px-3 py-2 text-sm tabular-nums ${isReference ? "bg-terminal-accent/15" : ""}`}><div role="cell" data-testid="dom-bid-cell" className="relative min-w-0 overflow-hidden text-right"><div aria-hidden="true" className={`absolute inset-y-0 right-0 ${row.price === bestBid ? "bg-blue-500/50" : "bg-blue-500/25"} ${row.bidFlash === "up" ? "ring-1 ring-emerald-400/60" : row.bidFlash === "down" ? "ring-1 ring-red-400/60" : ""}`} style={{ width: `${maxDisplayedQty > 0 ? Math.max(0,Math.min(100,bid/maxDisplayedQty*100)) : 0}%` }} /><span className="relative z-10" data-testid="dom-bid-qty">{formatCompact(bid)}</span></div><div role="rowheader" data-testid="dom-price-cell" className="text-center">{formatPrice(row.price,decimals)}</div><div role="cell" data-testid="dom-ask-cell" className="relative min-w-0 overflow-hidden"><div aria-hidden="true" className={`absolute inset-y-0 left-0 ${row.price === bestAsk ? "bg-red-500/50" : "bg-red-500/25"} ${row.askFlash === "up" ? "ring-1 ring-emerald-400/60" : row.askFlash === "down" ? "ring-1 ring-red-400/60" : ""}`} style={{ width: `${maxDisplayedQty > 0 ? Math.max(0,Math.min(100,ask/maxDisplayedQty*100)) : 0}%` }} /><span className="relative z-10" data-testid="dom-ask-qty">{formatCompact(ask)}</span></div></div>; })}</div></div> : <p role="status" className="text-sm text-terminal-muted">A usable reference price was not supplied. Inspect returned levels below.</p>}
   <details className="min-w-0"><summary className="cursor-pointer text-sm">Returned bid / ask levels</summary><div className="mt-3"><AnalyticsTable name="Returned depth levels" headers={["Side","Price","Quantity","Orders","Cumulative quantity"]} rows={[...snapshot.bids.map(row => ["Bid",row]),...snapshot.asks.map(row => ["Ask",row])] .map(([side,value]) => { const row = value as DepthSnapshotResponse["bids"][number]; return [side as string,marketNumber(row.price),marketNumber(row.quantity ?? row.size),marketNumber(row.orders,0),marketNumber(row.cumulative_qty)]; })} /></div></details>
  </>}
 </TerminalPanel></section>;
}
