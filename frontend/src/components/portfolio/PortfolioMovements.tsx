import { useEffect, useRef, useState } from "react";
import { fetchPortfolioTransactions, type ConsolidatedPortfolioReport, type MultiPortfolioTransaction } from "../../api/client";
import { asCurrencyCode } from "../../lib/currency";
import { DenseTable } from "../terminal/DenseTable";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalDataState } from "../terminal/TerminalPage";
import { portfolioMoney, portfolioQuantity } from "./portfolioPresentation";
import type { PortfolioRepairTarget } from "./PortfolioCurrencyRepair";

import type { OpeningEvidenceTarget } from "./PortfolioOpeningEvidenceDialog";

type Movement = MultiPortfolioTransaction & { portfolioId: string; portfolioName: string; cashDelta: number | null };
export function PortfolioMovements({ report, onRepair, onOpeningRepair }: { report: ConsolidatedPortfolioReport; onRepair: (target: PortfolioRepairTarget) => void; onOpeningRepair?: (target: OpeningEvidenceTarget) => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ report: ConsolidatedPortfolioReport; rows: Movement[] } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const version = useRef(0);
  const rows = data?.report === report ? data.rows : null;
  useEffect(() => {
    const current = ++version.current;
    setData(null); setError("");
    if (!open) return;
    Promise.all(report.portfolios.map(async member => {
      const items = await fetchPortfolioTransactions(member.portfolio_id);
      const accounting = new Map(member.accounting.transactions.map(row => [row.id, row]));
      return items.map(row => ({ ...row, portfolioId: member.portfolio_id, portfolioName: member.name, cashDelta: accounting.get(row.id)?.cash_delta_base ?? null }));
    })).then(groups => {
      if (version.current !== current) return;
      setData({ report, rows: groups.flat().sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)) });
    }).catch(() => { if (version.current === current) setError("The selected accounts’ movements could not be read. No previous or partial list is shown."); });
    return () => { version.current++; };
  }, [report, open, retry]);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="min-w-0 rounded border border-terminal-border p-3">
    <summary className="cursor-pointer text-sm text-terminal-text">All movements</summary>
    {open && <div className="mt-3 min-w-0 space-y-2">
      <p className="text-xs text-terminal-muted">Selected portfolio scope · native amounts and fee currencies · Cash Δ in {report.reporting_currency}. Opening entries move no cash.</p>
      {error ? <TerminalDataState kind="error" title="Movements unavailable" action={<TerminalButton onClick={() => setRetry(value => value + 1)}>Retry movements</TerminalButton>}>{error}</TerminalDataState>
        : rows === null ? <TerminalDataState kind="loading" title="Loading movements">Reading the selected accounts.</TerminalDataState>
          : !rows.length ? <TerminalDataState kind="empty" title="No recorded movements">There are no recorded movements in this scope.</TerminalDataState>
            : <section aria-label="All movements table" tabIndex={0} className="min-w-0"><DenseTable id="portfolio-all-movements" ariaLabel="Selected portfolio movements" rows={rows} rowKey={row => `${row.portfolioId}:${row.id}`} rowHeight={40} height={320} columns={[
              { key: "date", title: "Date", frozen: true, width: 110, sortable: true, getValue: row => row.date },
              { key: "portfolio", title: "Portfolio", width: 130, sortable: true, getValue: row => row.portfolioName },
              { key: "type", title: "Type", width: 100, sortable: true, getValue: row => row.type === "opening" ? "Opening (no cash)" : row.type },
              { key: "symbol", title: "Symbol", width: 100, sortable: true, getValue: row => row.symbol === "CASH" ? "—" : row.symbol },
              { key: "shares", title: "Quantity", width: 110, sortable: true, getValue: row => ["buy", "sell", "opening"].includes(row.type) ? row.shares : null, render: row => ["buy", "sell", "opening"].includes(row.type) ? portfolioQuantity(row.shares) : "—" },
              { key: "price", title: "Unit price / amount", width: 160, sortable: true, getValue: row => row.price, render: row => portfolioMoney(row.price, row.currency) },
              { key: "currency", title: "Native currency", width: 110, getValue: row => row.currency || "Unknown" },
              { key: "fees", title: "Fees", width: 140, getValue: row => row.fees, render: row => row.fees ? portfolioMoney(row.fees, row.fees_currency) : "—" },
              { key: "feeCurrency", title: "Fee currency", width: 110, getValue: row => row.fees_currency || "Unknown" },
              { key: "cash", title: `Cash Δ (${report.reporting_currency})`, width: 150, sortable: true, getValue: row => row.cashDelta, render: row => portfolioMoney(row.cashDelta, report.reporting_currency) },
              { key: "notes", title: "Operation rationale", width: 220, getValue: row => row.notes || "" },
              { key: "repair", title: "Evidence / currency", width: 170, getValue: () => "", render: row => row.type === "opening" ? <TerminalButton size="sm" onClick={() => onOpeningRepair?.({ portfolioId: row.portfolioId, transactionId: row.id })}>Opening evidence</TerminalButton> : !asCurrencyCode(row.currency) || (row.fees > 0 && !asCurrencyCode(row.fees_currency)) ? <TerminalButton size="sm" onClick={() => onRepair({ kind: "transaction", portfolioId: row.portfolioId, portfolioName: row.portfolioName, id: row.id, symbol: row.symbol, currency: row.currency, fees: row.fees, fees_currency: row.fees_currency })}>Set currency</TerminalButton> : null },
            ]} /></section>}
    </div>}
  </details>;
}
