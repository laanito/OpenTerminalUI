import { useRef, useState } from "react";
import { createPortfolio } from "../../api/client";
import { TerminalModal } from "../terminal/TerminalModal";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalButton } from "../terminal/TerminalButton";
import { PORTFOLIO_BENCHMARKS, PORTFOLIO_CURRENCIES } from "./portfolioPresentation";

export function PortfolioCreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [benchmark, setBenchmark] = useState(PORTFOLIO_BENCHMARKS[0]);
  const [currency, setCurrency] = useState("USD");
  const [cash, setCash] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  return <TerminalModal open title="Create portfolio" onClose={onClose} busy={busy}>
    <form className="space-y-3" onSubmit={async event => {
      event.preventDefault();
      if (saving.current) return;
      if (!name.trim()) { setError("Enter a portfolio name."); return; }
      saving.current = true; setBusy(true); setError("");
      try {
        const result = await createPortfolio({ name: name.trim(), description: description.trim(), benchmark_symbol: benchmark, currency, starting_cash: Number(cash) });
        onCreated(result.name); onClose();
      } catch { setError("Portfolio creation was not confirmed. Your fields are kept; check the portfolio list before submitting again."); }
      finally { saving.current = false; setBusy(false); }
    }}>
      {error && <p role="alert" className="text-sm text-terminal-neg">{error}</p>}
      <label className="block text-xs text-terminal-muted">Portfolio name<TerminalInput required value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label>
      <label className="block text-xs text-terminal-muted">Portfolio thesis<TerminalInput as="textarea" rows={3} value={description} onChange={e => setDescription(e.target.value)} disabled={busy} /></label>
      <label className="block text-xs text-terminal-muted">Benchmark<TerminalInput as="select" value={benchmark} onChange={e => setBenchmark(e.target.value)} disabled={busy}>{PORTFOLIO_BENCHMARKS.map(x => <option key={x}>{x}</option>)}</TerminalInput></label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs text-terminal-muted">Base currency<TerminalInput as="select" value={currency} onChange={e => setCurrency(e.target.value)} disabled={busy}>{PORTFOLIO_CURRENCIES.map(x => <option key={x}>{x}</option>)}</TerminalInput></label>
        <label className="block text-xs text-terminal-muted">Starting cash<TerminalInput type="number" min="0" step="any" required value={cash} onChange={e => setCash(e.target.value)} disabled={busy} /></label>
      </div>
      <p className="text-xs text-terminal-muted">Creating a portfolio keeps the current viewing scope.</p>
      <div className="flex flex-wrap gap-2"><TerminalButton type="submit" variant="accent" disabled={busy}>{busy ? "Creating…" : "Create portfolio"}</TerminalButton><TerminalButton type="button" disabled={busy} onClick={onClose}>Cancel</TerminalButton></div>
    </form>
  </TerminalModal>;
}
