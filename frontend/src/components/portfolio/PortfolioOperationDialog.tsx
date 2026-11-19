import { useRef, useState, type ReactNode } from "react";
import { isAxiosError } from "axios";
import { addPortfolioTransaction, fetchPortfolioOperation, type PortfolioTransactionType } from "../../api/client";
import { TerminalModal } from "../terminal/TerminalModal";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";

export const REPORTING_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "INR"];
export type OperationIntent = { portfolioId: string; type: PortfolioTransactionType; symbol?: string; shares?: number; price?: number; currency?: string; lotId?: string };

function newOperationId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // getRandomValues also works on self-hosted HTTP origins where randomUUID
  // is unavailable. Keep an RFC 4122 v4 identity rather than a timestamp key.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Mounted for one deliberate intent: its target and stable ID survive failures. */
export function PortfolioOperationDialog({ intent, portfolios, onClose, onSaved }: {
  intent: OperationIntent; portfolios: Array<{ id: string; name: string; currency?: string }>;
  onClose: () => void; onSaved: () => void;
}) {
  const [target, setTarget] = useState(intent.portfolioId);
  const [type, setType] = useState(intent.type);
  const [symbol, setSymbol] = useState(intent.symbol || "");
  const [shares, setShares] = useState(String(intent.shares || ""));
  const sourceCurrency = intent.currency || portfolios.find(p => p.id === target)?.currency || "";
  const needsExplicitPriceUnit = intent.type === "sell" && (!intent.currency || !REPORTING_CURRENCIES.includes(intent.currency));
  const [price, setPrice] = useState(needsExplicitPriceUnit || intent.price == null ? "" : String(intent.price));
  const [currency, setCurrency] = useState(!needsExplicitPriceUnit && REPORTING_CURRENCIES.includes(sourceCurrency) ? sourceCurrency : "");
  const [fees, setFees] = useState("0");
  const [feeCurrency, setFeeCurrency] = useState(currency);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState("");
  const [provenance, setProvenance] = useState("");
  const [contribution, setContribution] = useState("");
  const [contributionCurrency, setContributionCurrency] = useState(currency);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [operationId] = useState(newOperationId);
  const operation = useRef({ id: operationId, target: "", payload: null as Parameters<typeof addPortfolioTransaction>[1] | null });
  const inFlight = useRef(false);
  const opening = type === "opening", trade = type === "buy" || type === "sell";
  const needsSymbol = trade || opening || type === "dividend";
  const targetName = portfolios.find(p => p.id === target)?.name || target;
  const label = (name: string, child: ReactNode) => <label className="block min-w-0 space-y-1 text-xs text-terminal-muted"><span>{name}</span>{child}</label>;
  const finish = () => { onSaved(); onClose(); };
  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (!operation.current.payload) {
        operation.current.target = target;
        operation.current.payload = {
          operation_id: operation.current.id, type, symbol: needsSymbol ? symbol.trim().toUpperCase() : undefined,
          shares: trade || opening ? Number(shares) : 0, price: Number(price), currency, date,
          fees: opening ? 0 : Number(fees), fees_currency: feeCurrency, notes,
          lot_id: type === "sell" ? intent.lotId : undefined,
          opening: opening ? { acquisition_date: acquisitionDate, provenance,
            contribution_value: contribution === "" ? undefined : Number(contribution),
            contribution_currency: contributionCurrency } : undefined,
        };
      }
      setAttempted(true);
      await addPortfolioTransaction(operation.current.target, operation.current.payload);
      finish();
    } catch (error) {
      const response = isAxiosError(error) ? error.response : undefined;
      if (response && (response.status === 422 || response.status === 404 || ["Sale exceeds available quantity in the selected portfolio/lot", "Sale predates the recorded position observation or purchase date"].includes(response.data?.detail))) {
        setAttempted(false); setReview(false); operation.current.payload = null;
        setError(typeof response.data.detail === "string" ? response.data.detail : "Check the required operation fields and dates.");
        return;
      }
      setError("The operation was not confirmed. Check its result or retry the same operation; no automatic retry was sent.");
    } finally { setBusy(false); inFlight.current = false; }
  };
  const checkResult = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await fetchPortfolioOperation(operation.current.target, operation.current.id); finish(); }
    catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        setAttempted(false); setReview(false); operation.current.payload = null;
        setError("No operation is recorded under this identity. Correct the details or retry; the same operation ID is retained.");
      } else setError("The result check failed. Keep these details and retry the same operation or check again.");
    }
    finally { setBusy(false); inFlight.current = false; }
  };
  return <TerminalModal open onClose={onClose} busy={busy || attempted} title={opening ? "Add an existing position" : "Record operation"} size="lg"
    subtitle={opening ? "A non-cash opening entry. No purchase, deposit or cash movement is created." : "Buy and sell update holdings and cash together. Choose the account before recording."}
    footer={<div className="flex flex-wrap gap-2">
      {!attempted && <TerminalButton disabled={busy} onClick={onClose}>Cancel</TerminalButton>}
      {review && !attempted && <TerminalButton onClick={() => setReview(false)}>Edit details</TerminalButton>}
      {attempted && <TerminalButton disabled={busy} onClick={() => void checkResult()}>Check recorded result</TerminalButton>}
      {review && <TerminalButton variant="accent" disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : attempted ? "Retry same operation" : "Confirm operation"}</TerminalButton>}
    </div>}>
    {needsExplicitPriceUnit && <p className="mb-3 text-xs text-terminal-warn">Source quote unit: {intent.currency || "unknown"}. Enter the execution price and its currency explicitly.</p>}
    {error && <p role="alert" className="mb-3 text-sm text-terminal-neg">{error}</p>}
    {review ? <section aria-label="Operation review" className="space-y-3 text-sm text-terminal-text">
      <p><strong>{targetName}</strong> · {type === "opening" ? "Existing position" : type} {needsSymbol ? symbol.toUpperCase() : ""}</p>
      <p>{trade || opening ? `${shares} units × ${price}` : price} {currency}{!opening ? ` · fees ${fees} ${feeCurrency}` : " · cash movement: 0"}</p>
      <p>{opening ? "Observed in portfolio" : "Operation date"}: {date}</p>
      {trade && <p>{type === "sell" ? intent.lotId ? "Sale targets the selected lot. Cost/P&L uses existing portfolio weighted-average accounting." : "Sale consumes this portfolio’s lots oldest first. Cost/P&L uses weighted-average accounting." : "A buy adds a new lot and debits cash. Fees use their own currency."}</p>}
      {opening && <><p>Documented acquisition: {acquisitionDate}. Source: {provenance}.</p><p>Contribution at entry: {contribution === "" ? "Unknown; affected historical returns will be unavailable" : `${contribution} ${contributionCurrency}`}. Cost basis is separate.</p></>}
      {notes && <p>Operation rationale: {notes}</p>}
      {attempted && <p className="text-xs text-terminal-muted">Operation {operation.current.id}. Target and submitted details are fixed until the outcome is confirmed.</p>}
    </section> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); setError("");
      if ((needsSymbol && !symbol.trim()) || ((trade || opening) && (!Number.isFinite(Number(shares)) || Number(shares) <= 0))) { setError("Enter a symbol and a positive quantity."); return; }
      if (!Number.isFinite(Number(price)) || (opening ? Number(price) < 0 : Number(price) <= 0)) { setError("Enter a valid price or amount."); return; }
      setReview(true); }}>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {label("Target portfolio", <TerminalInput as="select" required value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose portfolio</option>{portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</TerminalInput>)}
        {!opening && label("Operation type", <TerminalInput as="select" value={type} onChange={e => setType(e.target.value as PortfolioTransactionType)}>{["buy", "sell", "deposit", "withdrawal", "dividend"].map(t => <option key={t} value={t}>{t}</option>)}</TerminalInput>)}
        {needsSymbol && label("Symbol", <TerminalInput required value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} />)}
        {(trade || opening) && label("Quantity", <TerminalInput required type="number" step="any" min="0" value={shares} onChange={e => setShares(e.target.value)} />)}
        {label(opening ? "Documented cost per unit" : trade ? "Unit price" : "Amount", <TerminalInput required type="number" step="any" min="0" value={price} onChange={e => setPrice(e.target.value)} />)}
        {label(opening ? "Cost currency" : "Price / amount currency", <TerminalInput required as="select" value={currency} onChange={e => setCurrency(e.target.value)}><option value="">Choose currency</option>{REPORTING_CURRENCIES.map(c => <option key={c}>{c}</option>)}</TerminalInput>)}
        {label(opening ? "Present in portfolio as of" : "Operation date", <TerminalInput required type="date" max={new Date().toISOString().slice(0, 10)} value={date} onChange={e => setDate(e.target.value)} />)}
        {!opening && <>{label("Fees", <TerminalInput required type="number" min="0" step="any" value={fees} onChange={e => setFees(e.target.value)} />)}{label("Fee currency", <TerminalInput required={Number(fees) > 0} as="select" value={feeCurrency} onChange={e => setFeeCurrency(e.target.value)}><option value="">Choose currency</option>{REPORTING_CURRENCIES.map(c => <option key={c}>{c}</option>)}</TerminalInput>)}</>}
        {opening && <>
          {label("Documented acquisition date", <TerminalInput required type="date" max={date} value={acquisitionDate} onChange={e => setAcquisitionDate(e.target.value)} />)}
          {label("Acquisition source / provenance", <TerminalInput required value={provenance} onChange={e => setProvenance(e.target.value)} />)}
          {label("Total contribution value at entry (optional)", <TerminalInput type="number" min="0" step="any" value={contribution} onChange={e => setContribution(e.target.value)} />)}
          {label("Contribution currency", <TerminalInput required={contribution !== ""} as="select" value={contributionCurrency} onChange={e => setContributionCurrency(e.target.value)}><option value="">Choose currency</option>{REPORTING_CURRENCIES.map(c => <option key={c}>{c}</option>)}</TerminalInput>)}
        </>}
      </div>
      {label("Operation rationale (optional)", <TerminalInput as="textarea" rows={3} value={notes} onChange={e => setNotes(e.target.value)} />)}
      {opening && <p className="text-xs text-terminal-muted">Use documented cost and acquisition date. Entry market value is separate; omitting it prevents return calculations across this opening.</p>}
      <TerminalButton type="submit" variant="accent">Review operation</TerminalButton>
    </form>}
  </TerminalModal>;
}
