import { useRef, useState } from "react";
import { updatePortfolioHoldingCurrency, updatePortfolioTransactionCurrencies } from "../../api/client";
import { asCurrencyCode } from "../../lib/currency";
import { TerminalModal } from "../terminal/TerminalModal";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalButton } from "../terminal/TerminalButton";
import { PORTFOLIO_CURRENCIES } from "./portfolioPresentation";

export type PortfolioRepairTarget = { portfolioId: string; portfolioName: string; id: string; symbol: string } & (
  { kind: "holding" } | { kind: "transaction"; currency?: string | null; fees: number; fees_currency?: string | null }
);
export function PortfolioCurrencyRepair({ target, onClose, onSaved }: { target: PortfolioRepairTarget; onClose: () => void; onSaved: () => void }) {
  const [currency, setCurrency] = useState("");
  const [feeCurrency, setFeeCurrency] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const needsAmount = target.kind === "holding" || !asCurrencyCode(target.currency);
  const needsFees = target.kind === "transaction" && target.fees > 0 && !asCurrencyCode(target.fees_currency);
  return <TerminalModal open title="Repair legacy currency" subtitle={`${target.portfolioName} · ${target.symbol}`} onClose={onClose} busy={busy}>
    <form className="space-y-3" onSubmit={async event => {
      event.preventDefault(); if (saving.current) return;
      saving.current = true; setBusy(true); setError("");
      try {
        if (target.kind === "holding") await updatePortfolioHoldingCurrency(target.portfolioId, target.id, currency);
        else await updatePortfolioTransactionCurrencies(target.portfolioId, target.id, { ...(needsAmount ? { currency } : {}), ...(needsFees ? { fees_currency: feeCurrency } : {}) });
        onSaved(); onClose();
      } catch { setError("Could not confirm the currency correction. Your choices are kept."); }
      finally { saving.current = false; setBusy(false); }
    }}>
      <p className="text-xs text-terminal-muted">Confirm the denomination in the original record. Amounts, quantities and dates are unchanged.</p>
      {error && <p role="alert" className="text-sm text-terminal-neg">{error}</p>}
      {needsAmount && <label className="block text-xs text-terminal-muted">{target.kind === "holding" ? "Cost currency" : "Amount currency"}<TerminalInput as="select" required value={currency} onChange={e => setCurrency(e.target.value)} disabled={busy}><option value="">Choose original currency</option>{PORTFOLIO_CURRENCIES.map(x => <option key={x}>{x}</option>)}</TerminalInput></label>}
      {needsFees && <label className="block text-xs text-terminal-muted">Fee currency<TerminalInput as="select" required value={feeCurrency} onChange={e => setFeeCurrency(e.target.value)} disabled={busy}><option value="">Choose original currency</option>{PORTFOLIO_CURRENCIES.map(x => <option key={x}>{x}</option>)}</TerminalInput></label>}
      <div className="flex gap-2"><TerminalButton type="submit" variant="accent" disabled={busy}>Save currency</TerminalButton><TerminalButton type="button" disabled={busy} onClick={onClose}>Cancel</TerminalButton></div>
    </form>
  </TerminalModal>;
}
