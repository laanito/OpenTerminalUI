import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchPortfolios, fetchPortfolioReport, type MultiPortfolio, type ConsolidatedPortfolioReport as PortfolioReport, type PortfolioReportMetric } from "../../api/client";
import { useSettingsStore } from "../../store/settingsStore";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalDataState, TerminalScopeBar } from "../terminal/TerminalPage";
import { PortfolioManager } from "./PortfolioManager";
import { PortfolioCreateDialog } from "./PortfolioCreateDialog";
import { PortfolioSettingsDialog } from "./PortfolioSettingsDialog";
import { PortfolioCurrencyRepair, type PortfolioRepairTarget } from "./PortfolioCurrencyRepair";
import { PortfolioAllocation } from "./PortfolioAllocation";
import { PortfolioMovements } from "./PortfolioMovements";
import { DenseTable } from "../terminal/DenseTable";
import { NotesPanel } from "../notes/NotesPanel";
import { asCurrencyCode } from "../../lib/currency";
import { portfolioMoney, portfolioQuantity } from "./portfolioPresentation";
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
  const [catalog, setCatalog] = useState<MultiPortfolio[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [settings, setSettings] = useState<MultiPortfolio | null>(null);
  const [repair, setRepair] = useState<PortfolioRepairTarget | null>(null);
  const [notesSymbol, setNotesSymbol] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const version = useRef(0);
  const selector = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    let active = true;
    setCatalogLoading(true); setCatalogError("");
    fetchPortfolios().then(value => { if (active) setCatalog(value); }).catch(() => { if (active) { setCatalog([]); setCatalogError("The portfolio list could not be loaded. Retry to select or edit an account."); } }).finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [revision]);
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
      const member = catalog.find(p => p.id === id);
      if (member?.currency && REPORTING_CURRENCIES.includes(member.currency)) next.set("reporting_currency", member.currency);
      else if (id === "all" && !params.has("reporting_currency") && REPORTING_CURRENCIES.includes(displayCurrency)) next.set("reporting_currency", displayCurrency);
      return next;
    });
    if (selector.current) { selector.current.open = false; selector.current.querySelector("summary")?.focus(); }
    setNotesSymbol(null); setStatus("");
  };
  const members = report?.portfolios || [];
  const selectedPortfolio = catalog.find(p => p.id === scope);
  const scopeName = scope === "all" ? "All owned portfolios" : selectedPortfolio?.name || members.find(p => p.portfolio_id === scope)?.name || "Selected portfolio";
  const money = (value: number | null | undefined, unit = currency) => portfolioMoney(value, unit);
  const metric = (value: PortfolioReportMetric) => <><span>{money(value.value)}</span>{value.value == null && <span className="mt-1 block text-[11px] text-terminal-muted">Known subtotal {money(value.known_value)} · {value.complete_items}/{value.total_items} {value.unit}s covered</span>}</>;
  const refresh = () => setRevision(value => value + 1);
  const openOperation = (type: "buy" | "opening") => setIntent({ type, portfolioId: scope === "all" ? "" : scope, currency: scope === "all" ? currency : members.find(p => p.portfolio_id === scope)?.portfolio_currency });
  return <div className="min-w-0 space-y-4">
    <TerminalScopeBar label="Portfolio scope" scope={scopeName} actions={<>
      <details ref={selector} className="relative" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary className="cursor-pointer rounded border border-terminal-border px-3 py-1.5 text-xs text-terminal-text">Choose portfolio scope</summary>
        <div className="absolute right-0 z-30 mt-2 max-h-72 w-64 max-w-[75vw] overflow-y-auto rounded border border-terminal-border bg-terminal-panel p-2 shadow-xl">
          <button type="button" aria-pressed={scope === "all"} className="block w-full rounded p-2 text-left text-xs text-terminal-text hover:bg-terminal-accent/10" onClick={() => setScope("all")}>All owned portfolios</button>
          {catalog.map(p => <button disabled={catalogLoading} key={p.id} type="button" aria-pressed={scope === p.id} className="block w-full break-words rounded p-2 text-left text-xs text-terminal-text hover:bg-terminal-accent/10" onClick={() => setScope(p.id)}>{p.name}</button>)}
          {catalogLoading && <p className="p-2 text-xs text-terminal-muted">Updating portfolios…</p>}
        </div>
      </details>
      <label className="flex flex-wrap items-center gap-2 text-xs text-terminal-muted">Reporting currency<TerminalInput as="select" className="!w-24" aria-label="Reporting currency" value={currency} onChange={event => setParams(previous => { const next = new URLSearchParams(previous); next.set("reporting_currency", event.target.value); return next; })}><option value="">Choose currency</option>{REPORTING_CURRENCIES.map(c => <option key={c}>{c}</option>)}</TerminalInput></label>
      <TerminalButton size="sm" onClick={() => setCreateOpen(true)}>New portfolio</TerminalButton>
      <TerminalButton size="sm" disabled={!selectedPortfolio || catalogLoading} title={scope === "all" ? "Choose one portfolio to edit its settings" : undefined} onClick={() => { if (selectedPortfolio) setSettings(selectedPortfolio); }}>Portfolio settings</TerminalButton>
      <TerminalButton size="sm" disabled={loading || catalogLoading} onClick={refresh}>Refresh report</TerminalButton>
    </>} />
    {catalogError && <TerminalDataState kind="error" title="Portfolio list unavailable" action={<TerminalButton onClick={refresh}>Retry portfolio list</TerminalButton>}>{catalogError}</TerminalDataState>}
    {status && <p role="status" className="text-xs text-terminal-pos">{status}</p>}
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
              {!report.positions.length && <TerminalDataState kind="empty" title={members.length ? "No open positions" : "No portfolios yet"}>{members.length ? "Record a buy, or add an existing position without moving cash." : "Use New portfolio in the scope bar to create your first account."}</TerminalDataState>}
              <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"><div className="min-w-0 space-y-2">
              {report.positions.map(position => <details key={`${position.symbol}:${position.exchange}:${position.quote_unit}:${position.lots[0]?.holding_id}`} className="min-w-0 rounded border border-terminal-border bg-terminal-panel p-3">
                <summary className="cursor-pointer text-sm text-terminal-text">
                  <span className="font-semibold">{position.symbol}</span> · {position.shares.toLocaleString("en-US", { maximumFractionDigits: 9 })} units
                  <span className="ml-2 text-xs text-terminal-muted">{position.exchange || "Exchange unknown"} · quote {position.quote_unit || "unit unknown"} · {position.portfolio_ids.length} account{position.portfolio_ids.length === 1 ? "" : "s"}</span>
                  <span className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3"><span>Value {metric(position.metrics.market_value)}</span><span>Cost {metric(position.metrics.cost_basis)}</span><span>Unrealized {metric(position.metrics.unrealized_pnl)}</span></span>
                </summary>
                {position.identity_reason && <p className="mt-2 text-xs text-terminal-warn">{position.identity_reason}</p>}
                <section aria-label={`${position.symbol} lots`} tabIndex={0} className="mt-3 min-w-0 space-y-2">
                  <p className="text-xs text-terminal-muted">Original lots · values and P&amp;L in {report.reporting_currency}; unit costs retain their recorded currencies.</p>
                  <DenseTable id={`portfolio-lots-${position.symbol}-${position.lots[0]?.holding_id}`} rows={position.lots} rowKey={lot => lot.holding_id} rowHeight={44} height={Math.min(320, position.lots.length * 44 + 100)} columns={[
                    { key: "portfolio", title: "Portfolio", width: 140, frozen: true, sortable: true, getValue: lot => lot.portfolio_name },
                    { key: "actions", title: "Lot actions", width: 150, getValue: () => "", render: lot => <span className="inline-flex gap-1">
                      <TerminalButton size="sm" aria-label={`Sell ${lot.symbol} in ${lot.portfolio_name}`} onClick={() => setIntent({ portfolioId: lot.portfolio_id, type: "sell", symbol: lot.symbol, shares: lot.shares, price: lot.current_price ?? undefined, currency: lot.quote_unit || undefined, lotId: lot.lot_id })}>Sell</TerminalButton>
                      {!asCurrencyCode(lot.cost_basis_currency) && <TerminalButton size="sm" aria-label={`Set cost currency for ${lot.symbol} in ${lot.portfolio_name}`} onClick={() => setRepair({ kind: "holding", portfolioId: lot.portfolio_id, portfolioName: lot.portfolio_name, id: lot.holding_id, symbol: lot.symbol })}>Currency</TerminalButton>}
                    </span> },
                    { key: "shares", title: "Quantity", width: 100, sortable: true, getValue: lot => lot.shares, render: lot => portfolioQuantity(lot.shares) },
                    { key: "cost", title: "Unit cost (native)", width: 160, sortable: true, getValue: lot => lot.cost_basis_per_share, render: lot => portfolioMoney(lot.cost_basis_per_share, lot.cost_basis_currency) },
                    { key: "costCurrency", title: "Cost currency", width: 110, getValue: lot => lot.cost_basis_currency || "Unknown" },
                    { key: "recorded", title: "Recorded date", width: 110, sortable: true, getValue: lot => lot.purchase_date || "Unknown" },
                    { key: "acquired", hidden: true, title: "Acquisition date", width: 130, getValue: lot => lot.opening?.acquisition_date || lot.purchase_date || "Unknown" },
                    { key: "lot", title: "Lot", width: 150, getValue: lot => lot.lot_id || lot.holding_id },
                    { key: "value", title: `Value (${report.reporting_currency})`, width: 150, sortable: true, getValue: lot => lot.accounting.market_value_base, render: lot => money(lot.accounting.market_value_base) },
                    { key: "basis", title: `Cost (${report.reporting_currency})`, width: 150, sortable: true, getValue: lot => lot.accounting.cost_basis_base, render: lot => money(lot.accounting.cost_basis_base) },
                    { key: "pnl", title: `P&L (${report.reporting_currency})`, width: 150, sortable: true, getValue: lot => lot.accounting.unrealized_pnl_base, render: lot => money(lot.accounting.unrealized_pnl_base) },
                    { key: "method", hidden: true, title: "Cost method", width: 170, getValue: lot => lot.accounting.cost_basis_method === "ledger_replay" ? "Portfolio ledger average" : "Holding record" },
                    { key: "provenance", hidden: true, title: "Opening provenance", width: 170, getValue: lot => lot.opening?.provenance || "" },
                    { key: "notes", hidden: true, title: "Recorded position research", width: 220, getValue: lot => lot.notes || "" },
                  ]} />
                  <TerminalButton size="sm" onClick={() => setNotesSymbol(notesSymbol === position.symbol ? null : position.symbol)}>Position research · {position.symbol}</TerminalButton>
                  {notesSymbol === position.symbol && <NotesPanel symbol={position.symbol} context="holding" />}
                </section>
              </details>)}
              </div><PortfolioAllocation report={report} /></div>
            </section>
            <PortfolioMovements report={report} onRepair={setRepair} />
            <details className="rounded border border-terminal-border p-3 text-xs text-terminal-muted"><summary className="cursor-pointer">Valuation method and coverage</summary><p className="mt-2">Checked {new Date(report.as_of).toLocaleString()}; a retrieval check, not simultaneous live quotes.</p>{report.assumptions.map(text => <p key={text} className="mt-2">{text}</p>)}{report.portfolios.map(p => <details key={p.portfolio_id} className="mt-3"><summary>{p.name} · base {p.portfolio_currency} · {p.accounting.status}</summary>{p.accounting.issues.map((issue, i) => <p key={i}>{issue.message}</p>)}{p.accounting.degraded_reasons.map(reason => <p key={reason}>{reason}</p>)}</details>)}</details>
          </> : null}
    {report && (scope === "all" ? <TerminalDataState kind="unavailable" title="Single-portfolio analysis">Select one portfolio in the scope bar for risk, AI, benchmark, historical and event analysis.</TerminalDataState>
      : selectedPortfolio && !catalogLoading ? <PortfolioManager key={selectedPortfolio.id} portfolio={selectedPortfolio} />
        : <TerminalDataState kind={catalogLoading ? "loading" : "unavailable"} title="Portfolio analysis scope">{catalogLoading ? "Reading account details." : "Retry the portfolio list to load this account’s analysis."}</TerminalDataState>)}
    {createOpen && <PortfolioCreateDialog onClose={() => setCreateOpen(false)} onCreated={name => { setStatus(`Created ${name}. Viewing scope is unchanged.`); refresh(); }} />}
    {settings && <PortfolioSettingsDialog portfolio={settings} onClose={() => setSettings(null)} onChanged={refresh} onDeleted={() => { if (scope === settings.id) setScope("all"); refresh(); }} />}
    {repair && <PortfolioCurrencyRepair target={repair} onClose={() => setRepair(null)} onSaved={refresh} />}
    {intent && <PortfolioOperationDialog intent={intent} portfolios={catalog.length ? catalog : members.map(p => ({ id: p.portfolio_id, name: p.name, currency: p.portfolio_currency }))} onClose={() => setIntent(null)} onSaved={refresh} />}
  </div>;
}
