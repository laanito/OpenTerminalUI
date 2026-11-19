import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchPortfolioReport, type ConsolidatedPortfolioReport as PortfolioReport, type PortfolioReportMetric } from "../../api/client";
import { useSettingsStore } from "../../store/settingsStore";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalDataState, TerminalScopeBar } from "../terminal/TerminalPage";
import { PortfolioManager } from "./PortfolioManager";
import { PortfolioOperationDialog, REPORTING_CURRENCIES, type OperationIntent } from "./PortfolioOperationDialog";

export function PortfolioWorkspace() {
  const [params, setParams] = useSearchParams();
  const displayCurrency = useSettingsStore(state => state.displayCurrency);
  const scope = params.get("portfolio") || "all";
  const currency = params.get("reporting_currency") ?? (REPORTING_CURRENCIES.includes(displayCurrency) ? displayCurrency : "");
  const [payload, setReport] = useState<PortfolioReport | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const requestKey = `${scope}:${currency}`;
  const report = loadedKey === requestKey ? payload : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [intent, setIntent] = useState<OperationIntent | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const version = useRef(0);
  const selector = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const current = ++version.current;
    setReport(null); setError(""); setLoading(false);
    if (!REPORTING_CURRENCIES.includes(currency)) return;
    setLoading(true);
    fetchPortfolioReport(currency, scope === "all" ? undefined : scope).then(value => {
      if (version.current === current) { setLoadedKey(requestKey); setReport(value); }
    }).catch(() => {
      if (version.current === current) setError("The selected portfolio report could not be loaded. No previous figures are shown.");
    }).finally(() => { if (version.current === current) setLoading(false); });
    return () => { version.current++; };
  }, [scope, currency, revision]);
  const setScope = (id: string) => {
    setParams(previous => {
      const next = new URLSearchParams(previous); next.set("portfolio", id);
      const member = report?.portfolios.find(p => p.portfolio_id === id);
      if (member && REPORTING_CURRENCIES.includes(member.portfolio_currency)) next.set("reporting_currency", member.portfolio_currency);
      else if (id === "all" && !params.has("reporting_currency") && REPORTING_CURRENCIES.includes(displayCurrency)) next.set("reporting_currency", displayCurrency);
      return next;
    });
    if (selector.current) selector.current.open = false;
    setToolsOpen(false);
  };
  const members = report?.portfolios || [];
  const scopeName = scope === "all" ? "All owned portfolios" : members.find(p => p.portfolio_id === scope)?.name || "Selected portfolio";
  const money = (value: number | null | undefined, unit = currency) => value == null || !Number.isFinite(value) ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: unit, maximumFractionDigits: 2 }).format(value);
  const metric = (value: PortfolioReportMetric) => <><span>{money(value.value)}</span>{value.value == null && <span className="mt-1 block text-[11px] text-terminal-muted">Known subtotal {money(value.known_value)} · {value.complete_items}/{value.total_items} {value.unit}s covered</span>}</>;
  const refresh = () => setRevision(value => value + 1);
  const openOperation = (type: "buy" | "opening") => setIntent({ type, portfolioId: scope === "all" ? "" : scope, currency: scope === "all" ? currency : members.find(p => p.portfolio_id === scope)?.portfolio_currency });
  return <div className="min-w-0 space-y-4">
    <TerminalScopeBar label="Portfolio scope" scope={scopeName} actions={<>
      <details ref={selector} className="relative" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary className="cursor-pointer rounded border border-terminal-border px-3 py-1.5 text-xs text-terminal-text">Choose portfolio scope</summary>
        <div className="absolute right-0 z-30 mt-2 max-h-72 w-64 max-w-[75vw] overflow-y-auto rounded border border-terminal-border bg-terminal-panel p-2 shadow-xl">
          <button type="button" aria-pressed={scope === "all"} className="block w-full rounded p-2 text-left text-xs text-terminal-text hover:bg-terminal-accent/10" onClick={() => setScope("all")}>All owned portfolios</button>
          {members.map(p => <button key={p.portfolio_id} type="button" aria-pressed={scope === p.portfolio_id} className="block w-full break-words rounded p-2 text-left text-xs text-terminal-text hover:bg-terminal-accent/10" onClick={() => setScope(p.portfolio_id)}>{p.name}</button>)}
          {scope !== "all" && <p className="px-2 text-[11px] text-terminal-muted">Return to all portfolios to choose another account.</p>}
        </div>
      </details>
      <label className="flex flex-wrap items-center gap-2 text-xs text-terminal-muted">Reporting currency<TerminalInput as="select" className="!w-24" aria-label="Reporting currency" value={currency} onChange={event => setParams(previous => { const next = new URLSearchParams(previous); next.set("reporting_currency", event.target.value); return next; })}><option value="">Choose currency</option>{REPORTING_CURRENCIES.map(c => <option key={c}>{c}</option>)}</TerminalInput></label>
      <TerminalButton size="sm" disabled={loading} onClick={refresh}>Refresh report</TerminalButton>
    </>} />
    <div className="flex min-w-0 flex-wrap gap-2">
      <TerminalButton variant="accent" disabled={!members.length || loading} onClick={() => openOperation("buy")}>Record operation</TerminalButton>
      <TerminalButton disabled={!members.length || loading} onClick={() => openOperation("opening")}>Add existing position</TerminalButton>
    </div>
    {!currency || !REPORTING_CURRENCIES.includes(currency) ? <TerminalDataState kind="unavailable" title="Choose a reporting currency">Select a supported currency to value this scope.</TerminalDataState>
      : loading ? <TerminalDataState kind="loading" title="Loading portfolio report">Checking selected accounts and their valuation evidence.</TerminalDataState>
        : error ? <TerminalDataState kind="error" title="Portfolio report unavailable" action={<TerminalButton onClick={refresh}>Retry report</TerminalButton>}>{error}</TerminalDataState>
          : report ? <>
            {report.status !== "complete" && <TerminalDataState kind="partial" title={report.status === "degraded" ? "Portfolio report uses degraded evidence" : "Portfolio report is incomplete"}>Affected totals remain unavailable. Known components and accounting evidence are shown separately.</TerminalDataState>}
            <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Portfolio report totals">
              {([["Net value", "net_liquidation_value"], ["Holdings value", "market_value"], ["Cash", "cash_balance"], ["Unrealized P&L", "unrealized_pnl"]] as const).map(([title, key]) => <section key={key} aria-label={title} className="min-w-0 break-words rounded border border-terminal-border bg-terminal-panel p-2"><h2 className="text-xs text-terminal-muted">{title}</h2><div className="mt-2 text-sm text-terminal-text">{metric(report.metrics[key])}</div></section>)}
            </div>
            <section aria-label="Consolidated holdings" className="min-w-0 space-y-2">
              <h2 className="text-sm font-semibold text-terminal-text">Consolidated holdings</h2>
              <p className="text-xs text-terminal-muted">Positions across {members.length} owned portfolio{members.length === 1 ? "" : "s"}. Expand an instrument to inspect original lots or sell from a specific account.</p>
              {!report.positions.length && <TerminalDataState kind="empty" title={members.length ? "No open positions" : "No portfolios yet"}>{members.length ? "Record a buy, or add an existing position without moving cash." : "Open portfolio management to create your first portfolio."}</TerminalDataState>}
              {report.positions.map(position => <details key={`${position.symbol}:${position.exchange}:${position.quote_unit}:${position.lots[0]?.holding_id}`} className="min-w-0 rounded border border-terminal-border bg-terminal-panel p-3">
                <summary className="cursor-pointer text-sm text-terminal-text">
                  <span className="font-semibold">{position.symbol}</span> · {position.shares.toLocaleString("en-US", { maximumFractionDigits: 9 })} units
                  <span className="ml-2 text-xs text-terminal-muted">{position.exchange || "Exchange unknown"} · quote {position.quote_unit || "unit unknown"} · {position.portfolio_ids.length} account{position.portfolio_ids.length === 1 ? "" : "s"}</span>
                  <span className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3"><span>Value {metric(position.metrics.market_value)}</span><span>Cost {metric(position.metrics.cost_basis)}</span><span>Unrealized {metric(position.metrics.unrealized_pnl)}</span></span>
                </summary>
                {position.identity_reason && <p className="mt-2 text-xs text-terminal-warn">{position.identity_reason}</p>}
                <div className="mt-3 space-y-3">
                  {position.lots.map(lot => <section key={lot.holding_id} aria-label={`${lot.symbol} lot in ${lot.portfolio_name}`} className="min-w-0 space-y-2 border-t border-terminal-border pt-2 text-xs text-terminal-muted">
                    <h3 className="break-words font-semibold text-terminal-text">{lot.portfolio_name} · {lot.shares} units</h3>
                    <p className="break-words">Recorded cost {lot.cost_basis_currency ? money(lot.cost_basis_per_share, lot.cost_basis_currency) : lot.cost_basis_per_share} per unit{!lot.cost_basis_currency ? " · currency unknown; amount not valued" : ""} · recorded date {lot.purchase_date || "unknown"}</p>
                    <p className="break-words">Lot {lot.lot_id || lot.holding_id} · reporting cost {money(lot.accounting.cost_basis_base)} · method {lot.accounting.cost_basis_method === "ledger_replay" ? "portfolio ledger average" : "holding record"}</p>
                    {lot.opening && <p className="break-words">Non-cash opening · documented acquisition {lot.opening.acquisition_date} · {lot.opening.provenance}</p>}
                    {lot.notes && <p className="break-words">Position research: {lot.notes}</p>}
                    <TerminalButton size="sm" onClick={() => setIntent({ portfolioId: lot.portfolio_id, type: "sell", symbol: lot.symbol, shares: lot.shares, price: lot.current_price ?? undefined, currency: lot.quote_unit || undefined, lotId: lot.lot_id })}>Sell {lot.symbol} in {lot.portfolio_name}</TerminalButton>
                  </section>)}
                </div>
              </details>)}
            </section>
            <details className="rounded border border-terminal-border p-3 text-xs text-terminal-muted"><summary className="cursor-pointer">Valuation method and coverage</summary><p className="mt-2">Checked {new Date(report.as_of).toLocaleString()}; a retrieval check, not simultaneous live quotes.</p>{report.assumptions.map(text => <p key={text} className="mt-2">{text}</p>)}{report.portfolios.map(p => <details key={p.portfolio_id} className="mt-3"><summary>{p.name} · base {p.portfolio_currency} · {p.accounting.status}</summary>{p.accounting.issues.map((issue, i) => <p key={i}>{issue.message}</p>)}{p.accounting.degraded_reasons.map(reason => <p key={reason}>{reason}</p>)}</details>)}</details>
          </> : null}
    <details open={toolsOpen} onToggle={event => setToolsOpen(event.currentTarget.open)} className="min-w-0 rounded border border-terminal-border p-3">
      <summary className="cursor-pointer text-sm text-terminal-text">Manage portfolios, activity, research and analytics</summary>
      {toolsOpen && <div className="mt-4 min-w-0"><p className="mb-3 text-xs text-terminal-muted">Choose a specific portfolio here for its activity, thesis, imports, currency repair and analytics. Consolidated reporting above remains the selected reading scope.</p><PortfolioManager initialPortfolioId={scope === "all" ? undefined : scope} onMutation={refresh} /></div>}
    </details>
    {intent && <PortfolioOperationDialog intent={intent} portfolios={members.map(p => ({ id: p.portfolio_id, name: p.name, currency: p.portfolio_currency }))} onClose={() => setIntent(null)} onSaved={refresh} />}
  </div>;
}
