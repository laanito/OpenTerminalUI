import { useEffect, useRef, useState } from "react";
import { addPortfolioHolding, deletePortfolioById, fetchPortfolioHoldings, updatePortfolioById, type MultiPortfolio, type MultiPortfolioHolding } from "../../api/client";
import { TerminalModal } from "../terminal/TerminalModal";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { ExportButton } from "../common/ExportButton";
import { PORTFOLIO_BENCHMARKS, PORTFOLIO_CURRENCIES } from "./portfolioPresentation";
import { CSV_SYMBOL_COLUMNS, CSV_SHARES_COLUMNS, CSV_COST_COLUMNS, CSV_DATE_COLUMNS, CSV_CURRENCY_COLUMNS } from "../../utils/portfolioMigration";

export function PortfolioSettingsDialog({ portfolio, onClose, onChanged, onDeleted }: { portfolio: MultiPortfolio; onClose: () => void; onChanged: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(portfolio.name);
  const [description, setDescription] = useState(portfolio.description || "");
  const benchmarks = Array.from(new Set([...(portfolio.benchmark_symbol ? [portfolio.benchmark_symbol] : []), ...PORTFOLIO_BENCHMARKS]));
  const [benchmark, setBenchmark] = useState(portfolio.benchmark_symbol || PORTFOLIO_BENCHMARKS[0]);
  const [currency, setCurrency] = useState(PORTFOLIO_CURRENCIES.includes(portfolio.currency || "") ? portfolio.currency! : "");
  const [importCurrency, setImportCurrency] = useState(currency);
  const [holdings, setHoldings] = useState<MultiPortfolioHolding[] | null>(null);
  const [exportError, setExportError] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const saving = useRef(false);
  useEffect(() => {
    let active = true; setHoldings(null); setExportError(false);
    fetchPortfolioHoldings(portfolio.id).then(rows => { if (active) setHoldings(rows); }).catch(() => { if (active) setExportError(true); });
    return () => { active = false; };
  }, [portfolio.id, reload]);
  const importCsv = async (file: File | null) => {
    if (!file || saving.current) return;
    saving.current = true; setBusy(true); setError(""); setStatus("");
    let imported = 0;
    try {
      const lines = (await file.text()).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (lines.length < 2) throw new Error("CSV must include a header and at least one row.");
      const headers = lines[0].split(",").map(value => value.trim().toLowerCase());
      const column = (names: string[]) => headers.findIndex(value => names.includes(value));
      const symbolIndex = column(CSV_SYMBOL_COLUMNS), sharesIndex = column(CSV_SHARES_COLUMNS), costIndex = column(CSV_COST_COLUMNS), dateIndex = column(CSV_DATE_COLUMNS), currencyIndex = column(CSV_CURRENCY_COLUMNS);
      if ([symbolIndex, sharesIndex, costIndex].some(index => index < 0)) throw new Error("CSV needs symbol, shares and cost columns.");
      for (const line of lines.slice(1)) {
        const fields = line.split(",").map(value => value.trim());
        const symbol = String(fields[symbolIndex] || "").toUpperCase(), shares = Number(fields[sharesIndex]), cost = Number(fields[costIndex]);
        if (!symbol || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(cost) || cost <= 0) continue;
        const nativeCurrency = currencyIndex >= 0 && fields[currencyIndex] ? fields[currencyIndex].toUpperCase() : importCurrency;
        if (!nativeCurrency) throw new Error("Choose the original cost currency for rows without a currency column.");
        await addPortfolioHolding(portfolio.id, { symbol, shares, cost_basis_per_share: cost, currency: nativeCurrency, purchase_date: dateIndex >= 0 && fields[dateIndex] ? fields[dateIndex] : new Date().toISOString().slice(0, 10) });
        imported++;
      }
      setStatus(`Imported ${imported} buy transaction${imported === 1 ? "" : "s"}.`);
    } catch (failure) { setError(`${failure instanceof Error ? failure.message : "Import failed."}${imported ? ` ${imported} rows were already recorded; do not reimport those rows.` : ""}`); }
    finally { if (imported) { setReload(value => value + 1); onChanged(); } saving.current = false; setBusy(false); }
  };
  return <TerminalModal open title={`Portfolio settings · ${portfolio.name}`} onClose={onClose} busy={busy} size="lg">
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-terminal-neg">{error}</p>}
      {status && <p role="status" className="text-sm text-terminal-pos">{status}</p>}
      <form className="space-y-3" onSubmit={async event => {
        event.preventDefault(); if (saving.current) return;
        if (!name.trim()) { setError("Enter a portfolio name."); return; }
        saving.current = true; setBusy(true); setError("");
        try { await updatePortfolioById(portfolio.id, { name: name.trim(), description: description.trim(), benchmark_symbol: benchmark, currency }); onChanged(); onClose(); }
        catch { setError("Could not confirm portfolio settings. Your fields are kept."); }
        finally { saving.current = false; setBusy(false); }
      }}>
        <label className="block text-xs text-terminal-muted">Portfolio name<TerminalInput required value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label>
        <label className="block text-xs text-terminal-muted">Portfolio thesis<TerminalInput as="textarea" rows={3} value={description} onChange={e => setDescription(e.target.value)} disabled={busy} /></label>
        <p className="text-xs text-terminal-muted">Mandate and constraints, indexed by the Second Brain. Operation rationale and position research stay separate.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="block text-xs text-terminal-muted">Benchmark<TerminalInput as="select" value={benchmark} onChange={e => setBenchmark(e.target.value)} disabled={busy}>{benchmarks.map(value => <option key={value}>{value}</option>)}</TerminalInput></label><label className="block text-xs text-terminal-muted">Accounting base currency<TerminalInput as="select" required value={currency} onChange={e => setCurrency(e.target.value)} disabled={busy}><option value="">Choose currency</option>{PORTFOLIO_CURRENCIES.map(value => <option key={value}>{value}</option>)}</TerminalInput></label></div>
        <TerminalButton type="submit" variant="accent" disabled={busy}>Save portfolio settings</TerminalButton>
      </form>
      <section aria-label="Portfolio import and export" className="space-y-2 border-t border-terminal-border pt-3">
        <h3 className="text-sm text-terminal-text">Import and export · {portfolio.name}</h3>
        {exportError ? <p className="text-xs text-terminal-warn">Holdings could not be read for export. <button type="button" onClick={() => setReload(value => value + 1)}>Retry export data</button></p> : <ExportButton source="portfolio" data={holdings || []} disabled={!holdings?.length || busy} />}
        <p className="text-xs text-terminal-muted">CSV import records purchases and debits cash. Use Add existing position for non-cash entries. Rows without a date use today.</p>
        <label className="block text-xs text-terminal-muted">Original cost currency if CSV omits currency<TerminalInput as="select" value={importCurrency} onChange={e => setImportCurrency(e.target.value)} disabled={busy}><option value="">Choose currency</option>{PORTFOLIO_CURRENCIES.map(value => <option key={value}>{value}</option>)}</TerminalInput></label>
        <label className="block text-xs text-terminal-muted">Import CSV (records buys)<input className="mt-1 block max-w-full" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { const file = e.target.files?.[0] || null; e.target.value = ""; void importCsv(file); }} /></label>
      </section>
      <details className="border-t border-terminal-border pt-3 text-xs text-terminal-muted"><summary className="cursor-pointer">Delete portfolio</summary><p className="mt-2">Permanently removes {portfolio.name} and its recorded portfolio data.</p><label className="my-2 flex items-center gap-2"><input type="checkbox" checked={deleteConfirmed} disabled={busy} onChange={e => setDeleteConfirmed(e.target.checked)} />Confirm deletion of {portfolio.name}</label><TerminalButton variant="danger" disabled={!deleteConfirmed || busy} onClick={async () => {
        if (saving.current) return; saving.current = true; setBusy(true); setError("");
        try { await deletePortfolioById(portfolio.id); onDeleted(); onClose(); }
        catch { setError("Portfolio deletion was not confirmed. Refresh the list before retrying."); }
        finally { saving.current = false; setBusy(false); }
      }}>Delete {portfolio.name}</TerminalButton></details>
    </div>
  </TerminalModal>;
}
