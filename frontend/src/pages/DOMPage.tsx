import { useEffect, useState } from "react";
import { fetchStock } from "../api/client";
import { DOMLadder } from "../components/market/DOMLadder";
import { TimeAndSales } from "../components/market/TimeAndSales";
import { MarketMetrics,marketNumber } from "../components/market/MarketReadout";
import { finite,useAnalyticsRead } from "../components/terminal/AnalyticsRead";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";
import { normalizeTicker } from "../utils/ticker";

export function DOMPage() {
 const selectedMarket = useSettingsStore(state => state.selectedMarket),ticker = useStockStore(state => state.ticker),setTicker = useStockStore(state => state.setTicker);
 const activeTicker = normalizeTicker(ticker || "AAPL"),[inputValue,setInputValue] = useState(activeTicker),[validation,setValidation] = useState("");
 useEffect(() => { setInputValue(activeTicker); setValidation(""); },[activeTicker]);
 const quote = useAnalyticsRead(JSON.stringify([activeTicker,selectedMarket]),() => fetchStock(activeTicker,selectedMarket));
 const lastPrice = quote.data?.current_price,changePct = quote.data?.change_pct;
 const change = finite(lastPrice) && finite(changePct) && changePct !== -100 && lastPrice > 0 ? lastPrice-lastPrice/(1+changePct/100) : null;
 return <main aria-label="Depth of Market workspace" className="min-w-0 space-y-4 p-3 text-terminal-text sm:p-4">
  <section aria-label="DOM instrument scope" className="min-w-0 space-y-3 rounded border border-terminal-border bg-terminal-panel p-3"><div className="flex min-w-0 flex-wrap items-end gap-3"><header className="min-w-0 flex-1 basis-64 space-y-2"><h1 className="text-lg font-semibold">Depth of Market</h1><p className="break-words text-sm text-terminal-muted">Applied symbol: {activeTicker} · selector context: {selectedMarket}</p></header><form className="flex min-w-0 flex-1 basis-80 flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); const next = normalizeTicker(inputValue); if (!next) { setValidation("Enter a symbol before loading."); return; } setValidation(""); setInputValue(next); setTicker(next); }}><label className="min-w-0 flex-1 basis-40 space-y-2 text-xs">DOM symbol<TerminalInput className="block text-sm" value={inputValue} maxLength={80} onChange={event => { setInputValue(event.target.value); setValidation(""); }} /></label><TerminalButton type="submit" variant="accent" className="normal-case tracking-normal">Load symbol</TerminalButton></form></div>{validation && <p role="alert" className="text-sm text-terminal-neg">{validation}</p>}</section>
  <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"><DOMLadder symbol={activeTicker} market={selectedMarket} /><TimeAndSales ticker={activeTicker} /></div>
  <details className="min-w-0 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Quote context · {activeTicker} · {selectedMarket}</summary><div className="mt-3 space-y-3"><TerminalButton type="button" disabled={quote.loading} onClick={quote.reload} className="normal-case tracking-normal">Refresh quote</TerminalButton>{quote.loading ? <p role="status" className="text-sm text-terminal-muted">Loading quote context…</p> : quote.failed ? <p role="alert" className="text-sm text-terminal-neg">Could not load quote context. Refresh quote to retry; no previous quote is shown.</p> : <MarketMetrics items={[["Quoted price",marketNumber(lastPrice)],["Derived price change",marketNumber(change)],["Quoted change percentage",finite(changePct) ? `${changePct.toFixed(2)}%` : "Unavailable"]]} />}<p className="text-xs text-terminal-muted">Quote context is separate from the book reference and tape; their observation times can differ. No currency conversion is applied here.</p></div></details>
  <details className="rounded border border-terminal-border p-3 text-sm"><summary className="cursor-pointer">Coverage and display conventions</summary><div className="mt-3 space-y-2 text-terminal-muted"><p>Empty or degraded responses do not establish live depth or trades. Provider availability depends on the symbol and host configuration. A retrieval indicator shows a request in progress, not a live-market certification.</p><p>The ladder keeps the existing IN/CRYPTO/US request-context mapping. Its price grid rounds around the reported book reference and assumes a 0.01 tick when one is absent; returned provider levels are available separately. Quantity bars are relative display aids, not executed volume at price.</p><p>The tape endpoint uses the symbol independently of the market selector. Trade-side labels and summaries are reported by the service; order flow, native identity, tick precision, currency and provider coverage still need the functionality audit.</p></div></details>
 </main>;
}
