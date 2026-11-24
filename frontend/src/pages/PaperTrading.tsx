import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPaperPortfolio, fetchPaperOrders, fetchPaperPerformance, fetchPaperPortfolios, fetchPaperPositions, fetchPaperTrades, placePaperOrder } from "../api/client";
import { HotKeyPanel } from "../components/trading/HotKeyPanel";
import { TerminalButton, TerminalInput, TerminalModal, TerminalTabs } from "../components/terminal";
import { readPaperScope, writePaperScope } from "../lib/paperScope";
import type { PaperOrder, PaperPortfolio } from "../types";

const panelClass = "min-w-0 space-y-3 rounded border border-terminal-border bg-terminal-panel p-3";
const amount = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "Unavailable" : value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">{label}</span>{children}</label>; }
function ReadState({ pending, error, label }: { pending: boolean; error: boolean; label: string }) { return <>{pending ? <p role="status" className="text-sm text-terminal-muted">Loading {label}…</p> : null}{error ? <p role="alert" className="text-sm text-terminal-neg">Could not refresh {label}. Any previous values below have not been refreshed.</p> : null}</>; }

export function PaperTradingPage() {
  const client = useQueryClient();
  const [scopeId, setScopeId] = useState(readPaperScope);
  const [tab, setTab] = useState("positions");
  const [dialog, setDialog] = useState<"create" | "order" | null>(null);
  const [name, setName] = useState("Paper Portfolio"); const [capital, setCapital] = useState(100000);
  const [symbol, setSymbol] = useState("AAPL"); const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit" | "sl">("market");
  const [quantity, setQuantity] = useState(1); const [limitPrice, setLimitPrice] = useState(0); const [slPrice, setSlPrice] = useState(0);
  const [busy, setBusy] = useState(false); const inFlight = useRef(false);
  const [hotkeyBusy, setHotkeyBusy] = useState(false); const [hotkeysMounted, setHotkeysMounted] = useState(false);
  const [draftError, setDraftError] = useState(""); const [notice, setNotice] = useState("");
  const noticeRef = useRef<HTMLParagraphElement>(null); const formId = useId(); const tabsId = useId();
  const portfolios = useQuery({ queryKey: ["paper", "portfolios"], queryFn: fetchPaperPortfolios, retry: false });
  const account = portfolios.data?.find(row => row.id === scopeId);
  const enabled = Boolean(account);
  const positions = useQuery({ queryKey: ["paper", "positions", scopeId], queryFn: () => fetchPaperPositions(scopeId), enabled, retry: false });
  const orders = useQuery({ queryKey: ["paper", "orders", scopeId], queryFn: () => fetchPaperOrders(scopeId), enabled, retry: false });
  const trades = useQuery({ queryKey: ["paper", "trades", scopeId], queryFn: () => fetchPaperTrades(scopeId), enabled, retry: false });
  const performance = useQuery({ queryKey: ["paper", "performance", scopeId], queryFn: () => fetchPaperPerformance(scopeId), enabled, retry: false });
  const locked = busy || hotkeyBusy;
  useEffect(() => {
    if (locked || !portfolios.data) return;
    if (portfolios.data.some(row => row.id === scopeId)) return;
    const next = portfolios.data[0]?.id || ""; setScopeId(next); writePaperScope(next);
  }, [portfolios.data, scopeId, locked]);
  useEffect(() => { if (notice && !dialog) noticeRef.current?.focus(); }, [notice, dialog]);
  const refreshDetails = (id: string) => { for (const kind of ["positions", "orders", "trades", "performance"]) void client.invalidateQueries({ queryKey: ["paper", kind, id] }); };
  async function save() {
    if (inFlight.current || hotkeyBusy) return;
    const action = dialog, id = scopeId;
    if (!action || action === "order" && !account) return;
    if (action === "create" && !name.trim()) { setDraftError("Enter a portfolio name."); return; }
    inFlight.current = true; setBusy(true); setDraftError(""); setNotice("");
    try {
      if (action === "create") {
        const result = await createPaperPortfolio({ name: name.trim(), initial_capital: capital });
        await client.cancelQueries({ queryKey: ["paper", "portfolios"] });
        client.setQueryData<PaperPortfolio[]>(["paper", "portfolios"], previous => [...(previous || []).filter(row => row.id !== result.id), result]);
        setScopeId(result.id); writePaperScope(result.id);
        setNotice("Paper portfolio created.");
      } else {
        const result = await placePaperOrder({ portfolio_id: id, symbol: symbol.trim().toUpperCase(), side, order_type: orderType, quantity, limit_price: orderType === "limit" ? limitPrice : undefined, sl_price: orderType === "sl" ? slPrice : undefined });
        await Promise.all(["orders", "positions", "trades", "performance"].map(kind => client.cancelQueries({ queryKey: ["paper", kind, id] })));
        await client.cancelQueries({ queryKey: ["paper", "portfolios"] });
        client.setQueryData<PaperOrder[]>(["paper", "orders", id], previous => [result, ...(previous || []).filter(row => row.id !== result.id)]);
        refreshDetails(id); setTab("orders");
        setNotice(`Paper order received · ${result.status}.`);
      }
      setDialog(null);
      // Reads cannot turn a confirmed write into a failed/replayed submission.
      void client.invalidateQueries({ queryKey: ["paper", "portfolios"] });
    } catch { setDraftError(action === "order" ? "Could not confirm this order. Your draft is kept. Close this dialog and refresh Orders before retrying manually." : "Could not confirm creation. Your draft is kept. Close this dialog and refresh the account list before retrying manually."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function open(next: "create" | "order") { setDraftError(""); setNotice(""); setDialog(next); }
  function close() { setDialog(null); if (draftError) { setNotice("Draft kept. Refresh the relevant list before retrying manually."); if (dialog === "order") setTab("orders"); } }
  const summary = performance.data;
  const tabs = [{ id: "positions", label: "Positions" }, { id: "orders", label: "Orders" }, { id: "trades", label: "Trades" }];
  return <main aria-label="Paper trading" className="min-w-0 space-y-3 p-3 [overflow-wrap:anywhere] [&_input]:min-w-0 [&_input]:!text-sm [&_select]:min-w-0 [&_select]:!text-sm md:p-4">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-lg font-semibold">Paper trading</h1><p className="text-sm text-terminal-muted">Review a simulated account and place paper orders.</p></div><div className="flex flex-wrap gap-2"><TerminalButton disabled={locked} onClick={() => open("create")}>New paper portfolio</TerminalButton><TerminalButton variant="accent" disabled={!account || locked} onClick={() => open("order")}>Place paper order</TerminalButton></div></header>
    <section aria-label="Paper account scope" className={panelClass}>
      <div className="flex min-w-0 flex-wrap items-end gap-3"><div className="min-w-0 flex-1 basis-64"><Field label="Paper portfolio"><TerminalInput aria-label="Paper portfolio" as="select" value={account?.id || ""} disabled={locked || Boolean(dialog)} onChange={event => { setScopeId(event.target.value); writePaperScope(event.target.value); setNotice(""); }}><option value="" disabled>Select a paper portfolio</option>{portfolios.data?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</TerminalInput></Field></div><TerminalButton size="sm" disabled={locked || portfolios.isFetching} onClick={() => void portfolios.refetch()}>Refresh accounts</TerminalButton></div>
      {account ? <p className="text-sm font-semibold">{account.name}</p> : null}
      <ReadState pending={portfolios.isFetching} error={portfolios.isError} label="paper accounts" />
      {portfolios.data?.length === 0 && !portfolios.isError && !portfolios.isFetching ? <p className="text-sm text-terminal-muted">No paper portfolios yet. Create one to begin.</p> : null}
    </section>
    {notice ? <p role="status" tabIndex={-1} ref={noticeRef} className="text-sm text-terminal-muted">{notice}</p> : null}
    {account ? <>
      <section aria-label="Paper account overview" className={panelClass}><h2 className="text-sm font-semibold">Account overview</h2><p className="text-xs text-terminal-muted">Balances use the paper account’s raw units; prices use instrument quote units. This view performs no currency conversion.</p><ReadState pending={performance.isFetching} error={performance.isError} label="performance" /><dl className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Cash (account units)", amount(account.current_cash)], ["Equity (account units)", amount(summary?.equity)], ["P&L (account units)", amount(summary?.pnl)], ["Return", summary?.cumulative_return == null ? "Unavailable" : `${amount(summary.cumulative_return * 100)}%`]].map(([label, value]) => <div key={label} className="min-w-0 rounded border border-terminal-border bg-terminal-bg p-3"><dt className="text-xs text-terminal-muted">{label}</dt><dd className="mt-1 break-words font-mono text-sm">{value}</dd></div>)}</dl><details><summary className="cursor-pointer text-sm">Performance details</summary><dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-3">{[["Initial capital", amount(account.initial_capital)], ["Sharpe ratio", amount(summary?.sharpe_ratio)], ["Maximum drawdown", summary?.max_drawdown == null ? "Unavailable" : `${amount(summary.max_drawdown * 100)}%`]].map(([label, value]) => <div key={label}><dt className="text-xs text-terminal-muted">{label}</dt><dd className="text-sm">{value}</dd></div>)}</dl></details></section>
      <section aria-label="Paper activity" className={panelClass}><div className="flex flex-wrap items-center justify-between gap-2"><TerminalTabs items={tabs} value={tab} onChange={setTab} ariaLabel="Paper activity sections" panelId={tabsId} /><TerminalButton size="sm" disabled={locked || [positions, orders, trades, performance].some(query => query.isFetching)} onClick={() => refreshDetails(scopeId)}>Refresh activity</TerminalButton></div>
        <div id={tabsId} role="tabpanel" aria-label={tabs.find(item => item.id === tab)?.label} className="min-w-0 space-y-3">
          {tab === "positions" ? <><ReadState pending={positions.isFetching} error={positions.isError} label="positions" />{positions.data?.length === 0 && !positions.isError && !positions.isFetching ? <p className="text-sm text-terminal-muted">No positions in this paper account.</p> : null}<div className="grid min-w-0 gap-3 lg:grid-cols-2">{positions.data?.map(row => <article key={row.id} aria-label={`${row.symbol} paper position`} className="min-w-0 space-y-2 rounded border border-terminal-border bg-terminal-bg p-3"><h2 className="text-sm font-semibold">{row.symbol}</h2><dl className="grid min-w-0 grid-cols-2 gap-3 text-sm">{[["Quantity (asset units)", row.quantity.toLocaleString("en-US", { maximumFractionDigits: 20 })], ["Average entry (quote units)", amount(row.avg_entry_price)], ["Mark (quote units)", amount(row.mark_price)], ["Unrealized P&L (quote units)", amount(row.unrealized_pnl)]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-terminal-muted">{label}</dt><dd className="break-words font-mono">{value}</dd></div>)}</dl></article>)}</div></> : null}
          {tab === "orders" ? <><ReadState pending={orders.isFetching} error={orders.isError} label="orders" /><p className="text-xs text-terminal-muted">Most recent eight orders.</p>{orders.data?.length === 0 && !orders.isError && !orders.isFetching ? <p className="text-sm text-terminal-muted">No orders in this paper account.</p> : null}{orders.data?.slice(0, 8).map(row => <article key={row.id} aria-label={`${row.symbol} paper order`} className="min-w-0 space-y-1 rounded border border-terminal-border bg-terminal-bg p-3"><h2 className="text-sm font-semibold">{row.symbol} · {row.side} · {row.order_type}</h2><p className="text-sm">Quantity: {row.quantity} asset units · Status: {row.status}</p><p className="text-xs text-terminal-muted">Fill price: {amount(row.fill_price)} quote units</p></article>)}</> : null}
          {tab === "trades" ? <><ReadState pending={trades.isFetching} error={trades.isError} label="trades" /><p className="text-xs text-terminal-muted">Most recent twenty trades.</p>{trades.data?.length === 0 && !trades.isError && !trades.isFetching ? <p className="text-sm text-terminal-muted">No trades in this paper account.</p> : null}{trades.data?.slice(0, 20).map(row => <article key={row.id} aria-label={`${row.symbol} paper trade`} className="min-w-0 space-y-1 rounded border border-terminal-border bg-terminal-bg p-3"><h2 className="text-sm font-semibold">{row.symbol} · {row.side}</h2><p className="text-sm">{row.quantity} asset units @ {amount(row.price)} quote units</p><p className="text-xs text-terminal-muted"><time dateTime={row.timestamp}>{new Date(row.timestamp).toLocaleString()}</time> · Realized P&L: {amount(row.pnl_realized)} account units</p></article>)}</> : null}
        </div>
      </section>
      <details className={panelClass} onToggle={event => { if (event.currentTarget.open) setHotkeysMounted(true); }}><summary className="cursor-pointer text-sm">Hotkey trading</summary><p className="text-xs text-terminal-muted">Uses this paper account and the global ticker shown in the widget. Trading shortcuts act only while the widget is focused, outside text fields.</p>{hotkeysMounted ? <HotKeyPanel embedded portfolioId={scopeId} onPendingChange={setHotkeyBusy} disabled={busy || Boolean(dialog)} /> : null}</details>
    </> : null}
    <TerminalModal open={Boolean(dialog)} onClose={close} title={dialog === "create" ? "New paper portfolio" : "Place paper order"} subtitle={dialog === "order" ? account?.name : "Create a separate simulated account."} busy={busy} size="lg" footer={<div className="flex flex-wrap justify-end gap-2"><TerminalButton disabled={busy} onClick={close}>Close</TerminalButton><TerminalButton variant="accent" loading={busy} disabled={hotkeyBusy} type="submit" form={formId}>{dialog === "create" ? "Create paper portfolio" : "Submit paper order"}</TerminalButton></div>}>
      <form id={formId} aria-label={dialog === "create" ? "Create paper portfolio" : "Paper order"} onSubmit={event => { event.preventDefault(); void save(); }} className="min-w-0 space-y-3 [&_input]:!text-sm [&_select]:!text-sm">
        {draftError ? <p role="alert" className="text-sm text-terminal-neg">{draftError}</p> : null}
        <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2">{dialog === "create" ? <><Field label="Portfolio name"><TerminalInput required value={name} onChange={event => setName(event.target.value)} /></Field><Field label="Initial capital (account units)"><TerminalInput required type="number" min={0} step="any" value={capital} onChange={event => setCapital(Number(event.target.value))} /></Field></> : <>
          <Field label="Symbol"><TerminalInput required value={symbol} onChange={event => setSymbol(event.target.value.toUpperCase())} /></Field><Field label="Side"><TerminalInput aria-label="Side" as="select" value={side} onChange={event => setSide(event.target.value as "buy" | "sell")}><option value="buy">Buy</option><option value="sell">Sell</option></TerminalInput></Field>
          <Field label="Order type"><TerminalInput aria-label="Order type" as="select" value={orderType} onChange={event => setOrderType(event.target.value as "market" | "limit" | "sl")}><option value="market">Market</option><option value="limit">Limit</option><option value="sl">Stop loss</option></TerminalInput></Field><Field label="Quantity (asset units)"><TerminalInput required type="number" min={1} step="any" value={quantity} onChange={event => setQuantity(Math.max(1, Number(event.target.value)))} /></Field>
          {orderType === "limit" ? <Field label="Limit price (quote units)"><TerminalInput required type="number" min={0} step="any" value={limitPrice} onChange={event => setLimitPrice(Number(event.target.value))} /></Field> : null}
          {orderType === "sl" ? <Field label="Stop price (quote units)"><TerminalInput required type="number" min={0} step="any" value={slPrice} onChange={event => setSlPrice(Number(event.target.value))} /></Field> : null}
        </>}</fieldset>
      </form>
    </TerminalModal>
  </main>;
}
