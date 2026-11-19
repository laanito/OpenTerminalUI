import { useEffect, useRef, useState, type ReactNode } from "react";
import { isAxiosError } from "axios";
import { fetchPortfolioOpeningEvidence, repairPortfolioOpeningEvidence, type PortfolioOpeningEvidence, type PortfolioOpeningRepair } from "../../api/client";
import { TerminalModal } from "../terminal/TerminalModal";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { newOperationId, REPORTING_CURRENCIES } from "./PortfolioOperationDialog";

export type OpeningEvidenceTarget = { portfolioId: string; transactionId: string };
export function PortfolioOpeningEvidenceDialog({ target, onClose, onSaved }: { target: OpeningEvidenceTarget; onClose: () => void; onSaved: () => void }) {
  const [evidence, setEvidence] = useState<PortfolioOpeningEvidence | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("");
  const [acquired, setAcquired] = useState("");
  const [source, setSource] = useState("");
  const [contribution, setContribution] = useState("");
  const [contributionCurrency, setContributionCurrency] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const inFlight = useRef(false);
  const request = useRef<PortfolioOpeningRepair | null>(null);
  const [load, setLoad] = useState(0);
  useEffect(() => {
    let active = true;
    setEvidence(null); setError("");
    fetchPortfolioOpeningEvidence(target.portfolioId, target.transactionId).then(value => {
      if (!active) return;
      setEvidence(value); setUnknown(value.opening.basis_status === "unknown");
      setPrice(value.price == null ? "" : String(value.price)); setCurrency(value.currency || "");
      setAcquired(value.opening.acquisition_date || ""); setSource(value.opening.provenance);
      setContribution(value.opening.contribution_value == null ? "" : String(value.opening.contribution_value));
      setContributionCurrency(value.opening.contribution_currency || "");
      setReason(""); setReview(false); setAttempted(false); request.current = null;
    }).catch(() => { if (active) setError("Opening evidence could not be read. Retry loading it."); });
    return () => { active = false; };
  }, [target.portfolioId, target.transactionId, load]);
  const finish = () => { onSaved(); onClose(); };
  const save = async () => {
    if (inFlight.current || !evidence) return;
    inFlight.current = true; setBusy(true); setError("");
    request.current ??= { repair_id: newOperationId(), expected_revision: evidence.evidence_revision,
      price: unknown ? null : Number(price), currency: unknown ? null : currency,
      opening: { basis_status: unknown ? "unknown" : "known", acquisition_date: acquired || null, provenance: source,
        contribution_value: contribution === "" ? null : Number(contribution), contribution_currency: contribution === "" ? null : contributionCurrency }, reason };
    setAttempted(true);
    try { await repairPortfolioOpeningEvidence(target.portfolioId, target.transactionId, request.current); finish(); }
    catch (error) {
      if (isAxiosError(error) && [404, 409, 422].includes(error.response?.status || 0)) {
        setAttempted(false); setReview(false); request.current = null;
        setError(typeof error.response?.data?.detail === "string" ? error.response.data.detail : "Check the evidence fields before submitting again.");
      } else setError("Repair not confirmed. Check the result or retry the same repair.");
    } finally { inFlight.current = false; setBusy(false); }
  };
  const check = async () => {
    if (inFlight.current || !request.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await fetchPortfolioOpeningEvidence(target.portfolioId, target.transactionId);
      if (result.applied_repairs.some(row => row.repair_id === request.current?.repair_id)) finish();
      else { setAttempted(false); setReview(false); request.current = null; setError("This repair is not recorded. Reload current evidence before editing, or review these details again."); }
    } catch { setError("The result check failed. Keep this repair and check again or retry it."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const label = (name: string, input: ReactNode) => <label className="block min-w-0 space-y-1 text-xs text-terminal-muted"><span>{name}</span>{input}</label>;
  const currencies = (value: string) => Array.from(new Set([...REPORTING_CURRENCIES, ...(value ? [value] : [])])).map(code => <option key={code}>{code}</option>);
  return <TerminalModal open onClose={onClose} busy={busy || attempted} title="Opening evidence" size="lg" subtitle="Correct acquisition evidence or entry valuation without another movement. Quantity, observation date and cash stay fixed."
    footer={<div className="flex flex-wrap gap-2">
      {!attempted && <TerminalButton disabled={busy} onClick={onClose}>Cancel</TerminalButton>}
      <TerminalButton disabled={busy || attempted} onClick={() => setLoad(value => value + 1)}>Reload evidence</TerminalButton>
      {review && !attempted && <TerminalButton onClick={() => setReview(false)}>Edit evidence</TerminalButton>}
      {attempted && <TerminalButton disabled={busy} onClick={() => void check()}>Check repair result</TerminalButton>}
      {review && <TerminalButton variant="accent" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : attempted ? "Retry same repair" : "Confirm evidence repair"}</TerminalButton>}
    </div>}>
    {error && <p role="alert" className="mb-3 text-sm text-terminal-neg">{error}</p>}
    {!evidence ? <p className="text-sm text-terminal-muted">{error ? "Evidence unavailable." : "Loading opening evidence…"}</p> : <div className="space-y-3 text-sm text-terminal-text">
      <p>{evidence.symbol} · {evidence.shares} units · observed {evidence.observed_date} · revision {evidence.evidence_revision}</p>
      {review ? <section aria-label="Evidence repair review" className="space-y-2">
        <p>{unknown ? "Cost basis unknown; cost/P&L unavailable" : `Documented cost: ${price} ${currency} per unit`}</p>
        <p>Acquired: {acquired || "Unknown"} · Source: {source}</p>
        <p>Contribution at entry: {contribution === "" ? "Unknown; affected historical returns remain unavailable" : `${contribution} ${contributionCurrency}`}</p>
        <p>Reason: {reason}</p>
      </section> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); setError(""); setReview(true); }}>
        <label className="flex items-center gap-2"><input type="checkbox" checked={unknown} onChange={e => setUnknown(e.target.checked)} />Cost basis unknown</label>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {!unknown && <>{label("Documented cost per unit", <TerminalInput required type="number" min="0" step="any" value={price} onChange={e => setPrice(e.target.value)} />)}
            {label("Cost currency", <TerminalInput as="select" required value={currency} onChange={e => setCurrency(e.target.value)}><option value="">Choose currency</option>{currencies(currency)}</TerminalInput>)}</>}
          {label("Documented acquisition date", <TerminalInput type="date" required={!unknown} max={evidence.observed_date} value={acquired} onChange={e => setAcquired(e.target.value)} />)}
          {label("Acquisition source / provenance", <TerminalInput required value={source} onChange={e => setSource(e.target.value)} />)}
          {label("Total contribution value at entry (optional)", <TerminalInput type="number" min="0" step="any" value={contribution} onChange={e => setContribution(e.target.value)} />)}
          {label("Contribution currency", <TerminalInput as="select" required={contribution !== ""} value={contributionCurrency} onChange={e => setContributionCurrency(e.target.value)}><option value="">Choose currency</option>{currencies(contributionCurrency)}</TerminalInput>)}
        </div>
        {label("Repair reason", <TerminalInput required as="textarea" rows={2} value={reason} onChange={e => setReason(e.target.value)} />)}
        <TerminalButton type="submit" variant="accent">Review evidence repair</TerminalButton>
      </form>}
      {!!evidence.evidence_history.length && <details><summary className="cursor-pointer">Earlier evidence ({evidence.evidence_history.length})</summary><ul className="mt-2 space-y-2 text-xs text-terminal-muted">{evidence.evidence_history.map(entry => <li key={entry.revision}>Revision {entry.revision} · {entry.price == null ? "Unknown basis" : `${entry.price} ${entry.currency} per unit`} · acquired {entry.opening.acquisition_date || "Unknown"} · {entry.opening.provenance}. Entry value: {entry.opening.contribution_value == null ? "Unknown" : `${entry.opening.contribution_value} ${entry.opening.contribution_currency}`}. Replaced {entry.repaired_at}: {entry.reason}</li>)}</ul></details>}
    </div>}
  </TerminalModal>;
}
