import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalPanel } from "../terminal/TerminalPanel";

export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
export function riskNumber(value: unknown, digits = 2) {
  return finite(value) ? value.toFixed(digits) : "Unavailable";
}
export function riskPercent(value: unknown, digits = 2) {
  return finite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%` : "Unavailable";
}

/** One independently scoped read. Changing scope or retrying invalidates old completions. */
export function useRiskRead<T = any>(scope: string, fetcher: () => Promise<T>) {
  const loader = useRef(fetcher);
  loader.current = fetcher;
  const generation = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ scope: string; loading: boolean; failed: boolean; data: T | null }>({ scope, loading: true, failed: false, data: null });
  const reload = useCallback(() => {
    generation.current++;
    setState({ scope, loading: true, failed: false, data: null });
    setAttempt(value => value + 1);
  }, [scope]);
  useEffect(() => {
    let active = true;
    const id = ++generation.current;
    setState({ scope, loading: true, failed: false, data: null });
    const load = loader.current;
    void Promise.resolve().then(load).then(data => {
      if (active && id === generation.current) setState({ scope, loading: false, failed: false, data });
    }).catch(() => {
      if (active && id === generation.current) setState({ scope, loading: false, failed: true, data: null });
    });
    return () => { active = false; };
  }, [scope, attempt]);
  return { ...(state.scope === scope ? state : { loading: true, failed: false, data: null }), reload, revision: attempt };
}

export function RiskPanel({ title, subtitle, read, empty, children, className = "" }: {
  title: string; subtitle?: string; read: ReturnType<typeof useRiskRead>; empty?: boolean; children: ReactNode; className?: string;
}) {
  return <section aria-label={title} aria-busy={read.loading} className={`min-w-0 ${className}`}>
    <TerminalPanel className="min-w-0" title={title} subtitle={subtitle} actions={<TerminalButton type="button" disabled={read.loading} onClick={read.reload} className="normal-case tracking-normal" aria-label={`Refresh ${title}`}>Refresh</TerminalButton>}>
      {read.loading ? <p role="status" className="py-4 text-sm text-terminal-muted">Loading {title.toLowerCase()}…</p>
        : read.failed ? <p role="alert" className="py-4 text-sm text-terminal-neg">Could not load {title.toLowerCase()}. Refresh to retry; no previous values are shown.</p>
          : empty || read.data == null ? <p role="status" className="py-4 text-sm text-terminal-muted">No data returned for this scope.</p> : children}
    </TerminalPanel>
  </section>;
}

export function RiskTable({ name, headers, rows, compact = false }: { name: string; headers: string[]; rows: ReactNode[][]; compact?: boolean }) {
  return <div role="region" aria-label={name} tabIndex={0} className={`min-w-0 overflow-auto rounded border border-terminal-border focus-visible:outline focus-visible:outline-terminal-accent ${compact ? "max-h-56" : "max-h-[32rem]"}`}>
    <table className="w-full text-left text-sm"><thead className="sticky top-0 z-10 bg-terminal-bg text-terminal-muted"><tr>{headers.map(header => <th key={header} scope="col" className="min-w-[120px] px-3 py-3 text-xs font-medium">{header}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map((row, index) => <tr key={index} className="border-t border-terminal-border">{row.map((cell, column) => column === 0
        ? <th key={column} scope="row" className="min-w-[120px] max-w-xs break-words px-3 py-3 align-top font-normal tabular-nums">{cell}</th>
        : <td key={column} className="min-w-[120px] max-w-xs break-words px-3 py-3 align-top tabular-nums">{cell}</td>)}</tr>) : <tr><td colSpan={headers.length} className="p-4 text-sm text-terminal-muted">No rows returned.</td></tr>}</tbody>
    </table>
  </div>;
}
