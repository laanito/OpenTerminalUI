import { useState } from "react";
import { SymbolSuggestions } from "../market/SymbolSuggestions";
import { TerminalButton } from "../terminal/TerminalButton";

export function BrainTechnicalSymbols({ symbols, onChange, disabled }: { symbols: string[]; onChange: (symbols: string[]) => void; disabled: boolean }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = (raw: string) => {
    const symbol = raw.trim().toUpperCase();
    if (!/^[A-Z0-9^._=-]{1,40}$/.test(symbol)) { setError("Enter a valid instrument symbol."); return; }
    if (symbols.includes(symbol)) { setError("That symbol is already selected."); return; }
    if (symbols.length >= 3) { setError("Choose at most three technical symbols."); return; }
    onChange([...symbols, symbol]); setValue(""); setError(null);
  };
  return <fieldset disabled={disabled} className="space-y-2 rounded border border-terminal-border p-2">
    <legend className="px-1 text-[11px] text-terminal-muted">Optional current technical context · up to 3 symbols</legend>
    <p className="text-[11px] text-terminal-muted">Choose relevant instruments explicitly. Ask fetches their technical history even if private research has no matches; any private evidence gap is shown.</p>
    <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); add(value); }}>
      <div className="min-w-0 flex-1"><SymbolSuggestions key={symbols.join(",")} label="Add technical symbol" value={value} onChange={setValue} onPick={add}
        exclude={symbols} placeholder="AAPL, BTC-USD…" /></div>
      <TerminalButton type="submit" size="sm" disabled={!value.trim() || symbols.length >= 3}>Add</TerminalButton>
    </form>
    {!!symbols.length && <div className="flex flex-wrap gap-2">{symbols.map((symbol) => <button type="button" key={symbol}
      className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-accent" aria-label={`Remove technical ${symbol}`}
      onClick={() => { onChange(symbols.filter((item) => item !== symbol)); setError(null); }}>{symbol} ×</button>)}</div>}
    {error && <p role="alert" className="text-xs text-terminal-neg">{error}</p>}
  </fieldset>;
}
