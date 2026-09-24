import { useEffect, useId, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";

import { searchSymbols } from "../../api/marketData";
import type { SearchSymbolItem } from "../../api/types";

const VALID_SYMBOL = /^[A-Z0-9^._=-]{1,40}$/;

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (symbol: string) => void;
  exclude?: string[];
  placeholder?: string;
};

export function SymbolSuggestions({ label, value, onChange, onPick, exclude = [], placeholder }: Props) {
  const id = useId();
  const [active, setActive] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchSymbolItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const excludeKey = exclude.map((symbol) => symbol.trim().toUpperCase()).join(",");

  useEffect(() => {
    const query = term.trim();
    if (!active || query.length < 2) {
      setResults([]);
      setLoading(false);
      setFailed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const timer = setTimeout(async () => {
      try {
        const excluded = new Set(excludeKey.split(",").filter(Boolean));
        const found = await searchSymbols(query);
        if (!cancelled) {
          const seen = new Set<string>();
          setResults(found.filter((item) => {
            const symbol = item.ticker.trim().toUpperCase();
            if (!VALID_SYMBOL.test(symbol) || excluded.has(symbol) || seen.has(symbol)) return false;
            seen.add(symbol);
            return true;
          }).slice(0, 8));
          setSelected(0);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
          setFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, term, excludeKey]);

  function pick(item: SearchSymbolItem) {
    onPick(item.ticker.trim().toUpperCase());
    setActive(false);
    setTerm("");
    setResults([]);
    setFailed(false);
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (!active || !results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(results[selected]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setActive(false);
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false);
  }

  return (
    <div className="relative" onBlur={handleBlur}>
      <label htmlFor={id} className="block text-xs text-terminal-muted">{label}</label>
      <input
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value.toUpperCase());
          setTerm(event.target.value);
          setActive(true);
        }}
        onFocus={() => { setActive(true); setTerm(value); }}
        onKeyDown={handleKey}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={active && results.length > 0}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={active && results[selected] ? `${id}-option-${selected}` : undefined}
        aria-busy={loading || undefined}
        className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-sm text-terminal-text"
      />
      {active && results.length > 0 ? (
        <div id={`${id}-listbox`} role="listbox" aria-label={`${label} suggestions`} className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border border-terminal-border bg-terminal-panel shadow-lg">
          {results.map((item, index) => (
            <button
              key={`${item.ticker}-${index}`}
              id={`${id}-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === selected}
              onClick={() => pick(item)}
              className={`flex w-full items-center justify-between gap-2 px-2 py-2 text-left text-xs hover:bg-terminal-accent/10 ${index === selected ? "bg-terminal-accent/10" : ""}`}
            >
              <span className="font-semibold text-terminal-text">{item.ticker}</span>
              <span className="truncate text-terminal-muted">{item.name}{item.exchange ? ` · ${item.exchange}` : ""}</span>
            </button>
          ))}
        </div>
      ) : null}
      {active && failed ? <p className="mt-1 text-xs text-terminal-warn">Suggestions unavailable; enter a symbol manually.</p> : null}
      {active && !loading && !failed && term.trim().length >= 2 && results.length === 0 ? (
        <p className="mt-1 text-xs text-terminal-muted">No matching suggestions; you can enter a symbol manually.</p>
      ) : null}
    </div>
  );
}
