import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { extractApiErrorMessage } from "../../api/base";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";

const destinations = [
  ["/backtesting", "Console"], ["/backtesting/model-governance", "Model Governance"],
  ["/backtesting/algorithm-framework", "Algorithm Framework"], ["/backtesting/portfolio-optimizer", "Portfolio Optimizer"],
];
export function ResearchWorkspace({ title, path, description, children }: { title: string; path: string; description: string; children: ReactNode }) {
  return <main aria-label={`${title} workspace`} className="h-full min-w-0 space-y-3 overflow-y-auto p-3 pb-6 text-sm text-terminal-text [overflow-wrap:anywhere]">
    <header><h1 className="text-xl font-semibold">{title}</h1><p className="mt-1 text-sm text-terminal-muted">{description}</p></header>
    <nav aria-label="Backtesting tools" className="flex flex-wrap gap-2 text-xs">{destinations.map(([href, label]) => <Link key={href} to={href} aria-current={path === href ? "page" : undefined} className={`rounded border px-3 py-2 ${path === href ? "border-terminal-accent text-terminal-accent" : "border-terminal-border"}`}>{label}</Link>)}</nav>
    {children}
  </main>;
}
export function ResearchField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">{label}</span>{children}</label>;
}
export function ResearchNumber({ label, value, onChange, step = "any", min, max }: { label: string; value: number; onChange: (value: number) => void; step?: number | "any"; min?: number; max?: number }) {
  return <ResearchField label={label}><TerminalInput type="number" className="min-w-0 text-sm" value={Number.isFinite(value) ? value : ""} min={min} max={max} step={step} onChange={event => onChange(event.target.valueAsNumber)} /></ResearchField>;
}
export function ResearchChoice({ label, value, onChange, items, disabled }: { label: string; value: string; onChange: (value: string) => void; items: { id: string; label: string }[]; disabled?: boolean }) {
  return <div className="min-w-0"><ResearchField label={label}><TerminalInput as="select" className="min-w-0 text-sm" value={value} onChange={event => onChange(event.target.value)} disabled={disabled}>{items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</TerminalInput></ResearchField>
    <p className="mt-1 text-xs text-terminal-muted">Selected: {items.find(item => item.id === value)?.label || "Unavailable"}</p></div>;
}
export function researchNumber(value: unknown, digits = 2, percent = false) {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * (percent ? 100 : 1)).toFixed(digits)}${percent ? "%" : ""}` : "Unavailable";
}
export function ResearchMetrics({ items }: { items: { label: string; value: unknown; percent?: boolean; digits?: number }[] }) {
  return <dl className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">{items.map(item => <div key={item.label} className="min-w-0 rounded border border-terminal-border bg-terminal-panel p-3"><dt className="text-xs text-terminal-muted">{item.label}</dt><dd className="mt-1 break-words text-base tabular-nums">{researchNumber(item.value, item.digits ?? 2, item.percent)}</dd></div>)}</dl>;
}
/** One explicit request and its immutable input receipt, isolated from later draft edits. */
export function useResearchRun<I, O>(request: (input: I) => Promise<O>, fallback: string) {
  const generation = useRef(0), busy = useRef(false);
  const [state, setState] = useState<{ phase: "idle" | "pending" | "done" | "failed"; input: I | null; data: O | null; error: string | null }>({ phase: "idle", input: null, data: null, error: null });
  useEffect(() => () => { generation.current++; busy.current = false; }, []);
  const run = async (input: I) => {
    if (busy.current) return;
    busy.current = true;
    const id = ++generation.current;
    const captured = structuredClone(input);
    setState({ phase: "pending", input: captured, data: null, error: null });
    try {
      const data = await request(captured);
      if (id === generation.current) setState({ phase: "done", input: captured, data, error: null });
    } catch (error) {
      if (id === generation.current) setState({ phase: "failed", input: captured, data: null, error: extractApiErrorMessage(error, fallback) });
    } finally { if (id === generation.current) busy.current = false; }
  };
  return { ...state, run, pending: state.phase === "pending" };
}
export function ResearchStatus({ phase, error, idle, pending }: { phase: string; error: string | null; idle: string; pending: string }) {
  return error ? <p role="alert" className="rounded border border-terminal-neg p-3 text-sm text-terminal-neg">{error} Your draft is retained; retry when ready. No previous result is shown.</p>
    : phase === "pending" ? <p role="status" className="rounded border border-terminal-border p-3 text-sm text-terminal-muted">{pending}</p>
      : phase === "idle" && idle ? <p className="rounded border border-terminal-border p-3 text-sm text-terminal-muted">{idle}</p> : null;
}
export function CatalogueStatus({ pending, failed, empty, retry }: { pending: boolean; failed: boolean; empty: boolean; retry: () => void }) {
  return pending ? <p role="status" className="p-3 text-sm text-terminal-muted">Loading available models…</p>
    : failed || empty ? <div className="space-y-2 rounded border border-terminal-border p-3"><p role={failed ? "alert" : "status"}>{failed ? "Could not load the model catalogue." : "No usable models are available for this workflow."}</p><TerminalButton type="button" onClick={retry}>Retry model catalogue</TerminalButton></div> : null;
}
