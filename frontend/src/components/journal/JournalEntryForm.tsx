import { useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { Star } from "lucide-react";

import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalModal } from "../terminal/TerminalModal";
import { nativeCurrencyForSymbol } from "../../lib/currency";
import type { JournalEntry } from "../../types";
import type { JournalEntryPayload } from "../../api/client";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  entry?: JournalEntry | null;
  busy?: boolean;
  strategies: string[];
  setups: string[];
  onClose: () => void;
  onSubmit: (payload: JournalEntryPayload) => Promise<void> | void;
};

type FormState = {
  symbol: string;
  direction: "LONG" | "SHORT";
  entryDate: string;
  entryPrice: string;
  exitDate: string;
  exitPrice: string;
  quantity: string;
  tradeAmount: string;
  sizeMode: "cash" | "units";
  fees: string;
  strategy: string;
  setup: string;
  emotion: string;
  rating: number;
  notes: string;
  tags: string;
};

const emotionOptions = [
  { value: "confident", label: "Confident", emoji: "😎" },
  { value: "fearful", label: "Fearful", emoji: "😬" },
  { value: "greedy", label: "Greedy", emoji: "🤑" },
  { value: "neutral", label: "Neutral", emoji: "😐" },
] as const;

function toLocalDateTimeValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (input: number) => `${input}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildInitialState(entry?: JournalEntry | null): FormState {
  return {
    symbol: entry?.symbol ?? "",
    direction: entry?.direction ?? "LONG",
    entryDate: toLocalDateTimeValue(entry?.entry_date),
    entryPrice: entry?.entry_price ? String(entry.entry_price) : "",
    exitDate: toLocalDateTimeValue(entry?.exit_date),
    exitPrice: entry?.exit_price != null ? String(entry.exit_price) : "",
    quantity: entry?.quantity ? String(entry.quantity) : "",
    tradeAmount: entry ? String(entry.quantity * entry.entry_price) : "",
    sizeMode: entry ? "units" : "cash",
    fees: entry?.fees != null ? String(entry.fees) : "0",
    strategy: entry?.strategy ?? "",
    setup: entry?.setup ?? "",
    emotion: entry?.emotion ?? "neutral",
    rating: entry?.rating ?? 0,
    notes: entry?.notes ?? "",
    tags: entry?.tags?.join(", ") ?? "",
  };
}

export function journalSaveError(error: unknown): string {
  const fallback = "Could not save this entry.";
  if (!isAxiosError(error) || !error.response || error.response.status >= 500) return fallback;
  const detail: unknown = error.response.data?.detail;
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return fallback;
  const messages = detail.flatMap(issue => {
    if (!issue || typeof issue.msg !== "string") return [];
    const location = Array.isArray(issue.loc) ? issue.loc.filter((part: unknown) => part !== "body").join(" · ").replace(/_/g, " ") : "";
    const label = location ? location[0].toUpperCase() + location.slice(1) : "Trade";
    return [`${label}: ${issue.msg.replace(/^Value error, /, "").replace(/_/g, " ")}`];
  });
  return [...new Set(messages)].join("; ") || fallback;
}

export function JournalEntryForm({
  open,
  mode,
  entry,
  busy = false,
  strategies,
  setups,
  onClose,
  onSubmit,
}: Props) {
  const [state, setState] = useState<FormState>(() => buildInitialState(entry));

  useEffect(() => {
    if (open) setState(buildInitialState(entry));
  }, [entry, open]);

  const strategyOptions = useMemo(
    () => Array.from(new Set([state.strategy, ...strategies].filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [state.strategy, strategies],
  );
  const setupOptions = useMemo(
    () => Array.from(new Set([state.setup, ...setups].filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [state.setup, setups],
  );

  const [submitError, setSubmitError] = useState<string | null>(null);
  useEffect(() => { if (open) setSubmitError(null); }, [open]);

  const currency = state.symbol.trim() ? nativeCurrencyForSymbol(state.symbol) : null;
  const moneyUnit = currency || "quote currency";
  const unitQuantity = state.sizeMode === "cash" ? Number(state.tradeAmount) / Number(state.entryPrice) : Number(state.quantity);
  const validQuantity = Number.isFinite(unitQuantity) && unitQuantity > 0;

  function changeSizeMode(mode: "cash" | "units") {
    setState(current => ({ ...current, sizeMode: mode,
      quantity: mode === "units" && validQuantity ? String(unitQuantity) : current.quantity,
      tradeAmount: mode === "cash" && validQuantity && Number(current.entryPrice) > 0 ? String(unitQuantity * Number(current.entryPrice)) : current.tradeAmount,
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    const price = Number(state.entryPrice), fee = Number(state.fees || 0);
    let issue: string | null = null;
    if (!state.symbol.trim()) issue = "Enter a symbol.";
    else if (!Number.isFinite(price) || price <= 0) issue = "Entry price must be greater than zero.";
    else if (!validQuantity) issue = state.sizeMode === "cash" ? "Trade amount must be greater than zero and produce a valid quantity." : "Quantity must be greater than zero.";
    else if (!Number.isFinite(fee) || fee < 0) issue = "Fees must be zero or a positive cash amount.";
    else if (Boolean(state.exitDate) !== Boolean(state.exitPrice.trim())) issue = "Provide both exit date and exit price, or leave both blank for an open trade.";
    else if (state.exitPrice && (!Number.isFinite(Number(state.exitPrice)) || Number(state.exitPrice) <= 0)) issue = "Exit price must be greater than zero.";
    else if (!Number.isFinite(Date.parse(state.entryDate))) issue = "Enter a valid entry date.";
    else if (state.exitDate && (!Number.isFinite(Date.parse(state.exitDate)) || Date.parse(state.exitDate) < Date.parse(state.entryDate))) issue = "Exit date must be on or after the entry date.";
    if (issue) { setSubmitError(issue); return; }
    try {
      await onSubmit({
        symbol: state.symbol.trim().toUpperCase(),
        direction: state.direction,
        entry_date: new Date(state.entryDate).toISOString(),
        entry_price: Number(state.entryPrice),
        exit_date: state.exitDate ? new Date(state.exitDate).toISOString() : null,
        exit_price: state.exitPrice ? Number(state.exitPrice) : null,
        quantity: unitQuantity,
        fees: Number(state.fees || 0),
        strategy: state.strategy.trim() || null,
        setup: state.setup.trim() || null,
        emotion: state.emotion || null,
        rating: state.rating || null,
        notes: state.notes.trim() || null,
        tags: state.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
    } catch (error) {
      setSubmitError(`${journalSaveError(error)} Your draft is still here; correct the fields and retry when ready.`);
    }
  }

  return (
    <TerminalModal
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={mode === "create" ? "Add Trade" : `Edit ${entry?.symbol ?? "Trade"}`}
      subtitle="Capture execution, psychology, and post-trade review in one place."
      footer={
        <div className="flex items-center justify-end gap-2">
          <TerminalButton type="button" size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </TerminalButton>
          <TerminalButton type="submit" form="journal-entry-form" size="sm" variant="accent" loading={busy}>
            Save
          </TerminalButton>
        </div>
      }
    >
      {submitError ? <p role="alert" className="mb-3 text-sm text-terminal-neg">{submitError}</p> : null}
      <form id="journal-entry-form" className="space-y-4 [&_input]:min-w-0 [&_input]:!text-sm [&_select]:!text-sm [&_textarea]:!text-sm [&_button]:!text-xs" onSubmit={handleSubmit} data-testid="journal-entry-form">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block min-w-0 space-y-1">
            <div className="text-xs text-terminal-muted">Symbol</div>
            <TerminalInput
              required
              value={state.symbol}
              onChange={(event) => setState((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))}
              placeholder="AAPL"
            />
          </label>
          <fieldset className="min-w-0 space-y-1">
            <legend className="text-xs text-terminal-muted">Direction</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["LONG", "SHORT"] as const).map((direction) => (
                <TerminalButton
                  key={direction}
                  aria-pressed={state.direction === direction}
                  type="button"
                  variant={state.direction === direction ? (direction === "LONG" ? "success" : "danger") : "default"}
                  onClick={() => setState((current) => ({ ...current, direction }))}
                >
                  {direction}
                </TerminalButton>
              ))}
            </div>
          </fieldset>
        </div>

        <p className="text-xs text-terminal-muted">{currency ? `Currency: ${currency} (from symbol). Prices, trade amount and fees must use this currency.` : "Use the symbol’s quote currency for prices, trade amount and fees."}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block min-w-0 space-y-1">
            <div className="text-xs text-terminal-muted">Entry Date</div>
            <TerminalInput required type="datetime-local" value={state.entryDate} onChange={(event) => setState((current) => ({ ...current, entryDate: event.target.value }))} />
          </label>
          <label className="block min-w-0 space-y-1">
            <div className="text-xs text-terminal-muted">Entry Price ({moneyUnit} per unit)</div>
            <TerminalInput required type="number" min="0" step="any" value={state.entryPrice} onChange={(event) => setState((current) => ({ ...current, entryPrice: event.target.value }))} />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block min-w-0 space-y-1">
            <div className="text-xs text-terminal-muted">Exit Date</div>
            <TerminalInput type="datetime-local" value={state.exitDate} onChange={(event) => setState((current) => ({ ...current, exitDate: event.target.value }))} />
          </label>
          <label className="block min-w-0 space-y-1">
            <div className="text-xs text-terminal-muted">Exit Price ({moneyUnit} per unit)</div>
            <TerminalInput type="number" min="0" step="any" value={state.exitPrice} onChange={(event) => setState((current) => ({ ...current, exitPrice: event.target.value }))} />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="min-w-0 space-y-2">
            <label htmlFor="journal-size-mode" className="block text-xs text-terminal-muted">Trade size input</label>
            <TerminalInput id="journal-size-mode" as="select" value={state.sizeMode} onChange={event => changeSizeMode(event.target.value as "cash" | "units")}>
              <option value="cash">Cash amount</option><option value="units">Asset units</option>
            </TerminalInput>
            <label htmlFor="journal-size-value" className="block text-xs text-terminal-muted">{state.sizeMode === "cash" ? `Trade amount (${moneyUnit})` : "Quantity (asset units)"}</label>
            <TerminalInput id="journal-size-value" required type="number" inputMode="decimal" min="0" step="any" value={state.sizeMode === "cash" ? state.tradeAmount : state.quantity} onChange={event => setState(current => ({ ...current, [current.sizeMode === "cash" ? "tradeAmount" : "quantity"]: event.target.value }))} />
            <p className="text-xs text-terminal-muted">{state.sizeMode === "cash" ? "Before fees. Units = cash amount ÷ entry price." : "Shares or coins, rather than a cash amount."}</p>
            {state.sizeMode === "cash" && validQuantity && Number(state.entryPrice) > 0 ? <p role="status" className="break-words text-xs text-terminal-text">Calculated quantity: {new Intl.NumberFormat(undefined, { maximumSignificantDigits: 12 }).format(unitQuantity)} asset units</p> : null}
          </div>
          <label className="block min-w-0 space-y-1">
            <div className="text-xs text-terminal-muted">Fees ({moneyUnit})</div>
            <TerminalInput type="number" inputMode="decimal" min="0" step="any" value={state.fees} onChange={(event) => setState((current) => ({ ...current, fees: event.target.value }))} />
            <span className="block text-xs text-terminal-muted">Total cash charges, separate from the trade amount.</span>
          </label>
          <fieldset className="min-w-0 space-y-1">
            <legend className="text-xs text-terminal-muted">Emotion</legend>
            <div className="grid grid-cols-2 gap-2">
              {emotionOptions.map((option) => (
                <button
                  key={option.value}
                  aria-pressed={state.emotion === option.value}
                  type="button"
                  className={`rounded-sm border px-2 py-2 text-left text-xs transition-colors ${
                    state.emotion === option.value
                      ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent"
                      : "border-terminal-border text-terminal-muted hover:text-terminal-text"
                  }`}
                  onClick={() => setState((current) => ({ ...current, emotion: option.value }))}
                >
                  <span className="mr-1">{option.emoji}</span>
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <label className="block text-xs text-terminal-muted" htmlFor="journal-strategy">Strategy</label>
            <TerminalInput id="journal-strategy" as="select" value={state.strategy} onChange={(event) => setState((current) => ({ ...current, strategy: event.target.value }))}>
              <option value="">Select strategy</option>
              {strategyOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </TerminalInput>
            <label className="block pt-1 text-xs text-terminal-muted" htmlFor="journal-new-strategy">Or enter a strategy</label>
            <TerminalInput
              id="journal-new-strategy"
              placeholder="Or type a new strategy"
              value={state.strategy}
              onChange={(event) => setState((current) => ({ ...current, strategy: event.target.value }))}
            />
          </div>
          <div className="min-w-0 space-y-1">
            <label className="block text-xs text-terminal-muted" htmlFor="journal-setup">Setup</label>
            <TerminalInput id="journal-setup" as="select" value={state.setup} onChange={(event) => setState((current) => ({ ...current, setup: event.target.value }))}>
              <option value="">Select setup</option>
              {setupOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </TerminalInput>
            <label className="block pt-1 text-xs text-terminal-muted" htmlFor="journal-new-setup">Or enter a setup</label>
            <TerminalInput
              id="journal-new-setup"
              placeholder="Or type a new setup"
              value={state.setup}
              onChange={(event) => setState((current) => ({ ...current, setup: event.target.value }))}
            />
          </div>
        </div>

        <label className="block min-w-0 space-y-1">
          <div className="text-xs text-terminal-muted">Tags</div>
          <TerminalInput value={state.tags} onChange={(event) => setState((current) => ({ ...current, tags: event.target.value }))} placeholder="breakout, pullback, revenge-risk" />
        </label>

        <div className="block min-w-0 space-y-1">
          <div className="text-xs text-terminal-muted">Rating</div>
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }, (_, index) => index + 1).map((rating) => (
              <button key={rating} aria-label={`Rate ${rating} of 5`} aria-pressed={state.rating === rating} type="button" onClick={() => setState((current) => ({ ...current, rating }))} className="rounded-sm p-2 focus-visible:outline text-terminal-muted hover:text-terminal-accent">
                <Star className={`h-5 w-5 ${state.rating >= rating ? "fill-current text-amber-300" : ""}`} />
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 space-y-1">
          <label htmlFor="journal-notes" className="block text-xs text-terminal-muted">Notes</label>
          <TerminalInput
            id="journal-notes"
            as="textarea"
            rows={5}
            value={state.notes}
            onChange={(event) => setState((current) => ({ ...current, notes: event.target.value }))}
            placeholder="What worked, what failed, and what to repeat next time."
          />
        </div>
      </form>
    </TerminalModal>
  );
}
