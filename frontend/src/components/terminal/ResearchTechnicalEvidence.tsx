import { useEffect, useRef, type ReactNode } from "react";
import type { ResearchTechnicalEvidence as Evidence } from "../../api/researchTechnicalContext";
import { TECHNICAL_DEFINITIONS, TECHNICAL_REASONS } from "../../api/technicalContext";

export type TechnicalInspection = { id: string; sequence: number } | null;
const reasons: Record<string, string> = { ...TECHNICAL_REASONS,
  provider_error: "Technical history could not be retrieved", provider_timeout: "Technical history retrieval reached its deadline",
  no_observations_in_window: "No source observations in the requested window" };
const reason = (code: string | null) => code && Object.prototype.hasOwnProperty.call(reasons, code) ? reasons[code] : "No usable technical observations";
const number = (value: number) => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 21 }).format(Object.is(value, -0) ? 0 : value);

export function technicalCitations(text: string, evidence: Evidence | null | undefined, inspect: (id: string) => void): ReactNode {
  if (!evidence) return text;
  const available = new Set(evidence.metrics.filter((metric) => metric.status === "available").map((metric) => `[${metric.citation_id}]`));
  return text.split(/(\[TECH[1-3]\])/g).map((part, index) => available.has(part)
    ? <button type="button" key={index} className="text-terminal-accent underline" aria-label={`Inspect ${part.slice(1, -1)} technical evidence`}
        onClick={() => inspect(part.slice(1, -1))}>{part}</button>
    : part);
}

export function ResearchTechnicalEvidence({ evidence, inspection }: { evidence: Evidence; inspection: TechnicalInspection }) {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!inspection || !root.current) return;
    root.current.open = true;
    const target = root.current.querySelector<HTMLElement>(`[data-technical-ref="${inspection.id}"]`);
    target?.focus(); target?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [inspection]);
  return <div className="mt-3 border-t border-terminal-border pt-2 text-xs">
    <p className="text-terminal-muted">Technical context supplied for {evidence.symbol}: {evidence.status === "available" ? "three available observations" : evidence.status === "partial" ? "partial observations" : "unavailable"}.
      {evidence.as_of_date ? ` Source history as of ${evidence.as_of_date}.` : ""} Retrieved {evidence.retrieved_at}.</p>
    <details ref={root} className="mt-2">
      <summary className="cursor-pointer text-terminal-accent">Inspect technical evidence</summary>
      <p className="mt-2">{evidence.source ?? "Unknown adapter"} · {evidence.feed ?? "Unknown feed"} · quote unit {evidence.quote_unit ?? "unknown"}.</p>
      <p>{evidence.input_status === "available" ? "Basis: Yahoo-reported adjusted closes." : "These measures require eligible Yahoo-reported adjusted history, which was not supplied."}</p>
      <p>Requested UTC dates {evidence.requested_start_date} to {evidence.requested_end_date}; {evidence.available_closes} observed closes.
        {evidence.window_start_date ? ` Observed window ${evidence.window_start_date} to ${evidence.window_end_date}.` : ""}
        {evidence.freshness ? ` ${evidence.freshness === "stale" ? "Stale" : "Current"} source history.` : ""}</p>
      {evidence.input_reason && <p className="text-terminal-warn">{reason(evidence.input_reason)}. Missing values are not zero.</p>}
      <p className="mt-1 text-terminal-warn">Descriptive daily observations, not trading signals. Adjustment methods, exchange sessions and bar completion are unverified. Current-source history does not establish what was known at a past time. References locate inputs; they do not prove the interpretation.</p>
      <p>Reported type {evidence.instrument_type ?? "unknown"}; timezone {evidence.exchange_timezone ?? "unknown"}; {evidence.shifted_local_dates} dates have different UTC/local labels. Calculations retain own UTC dates.</p>
      {evidence.metrics.map((metric, index) => <section key={metric.citation_id} data-technical-ref={metric.citation_id} tabIndex={-1} role="region"
        aria-label={`${metric.citation_id} technical evidence`} className="mt-3 rounded border border-terminal-border p-2 focus:outline focus:outline-terminal-accent">
        <h4 className="font-semibold">{metric.citation_id} · {TECHNICAL_DEFINITIONS[index].label}</h4>
        <p>{metric.status === "available" && metric.value !== null ? `${number(metric.value)} ${metric.unit === "percent" ? "%" : "percentage points"}`
          : `Unavailable: ${reason(metric.reason)}. Requires ${metric.required_closes} closes; ${evidence.available_closes} available. No zero value is implied.`}</p>
        {metric.start_date && <p>{metric.start_date} to {metric.end_date} · {metric.used_closes} own dated closes.</p>}
        <p>Formula: <code className="whitespace-pre-wrap break-words">{metric.formula}</code></p>
        {metric.name === "volatility20_pp" && <p>Sample dispersion of 20 simple returns, divisor 19; unannualized.</p>}
        {!!metric.observation_dates.length && <details><summary className="cursor-pointer text-terminal-accent">Exact observation dates ({metric.observation_dates.length})</summary>
          <p className="break-words">{metric.observation_dates.join(", ")}</p></details>}
        {metric.observation_id && <p className="break-all text-terminal-muted">Observation ID: {metric.observation_id}</p>}
      </section>)}
      {!!evidence.supporting_points.length && <details className="mt-2"><summary className="cursor-pointer text-terminal-accent">Supporting adjusted closes ({evidence.supporting_points.length})</summary>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs" aria-label={`${evidence.symbol} technical supporting closes`}>
          <thead><tr><th className="p-1">UTC date</th><th className="p-1">Adjusted close ({evidence.quote_unit})</th></tr></thead>
          <tbody>{evidence.supporting_points.map((point) => <tr key={point.date}><td className="p-1">{point.date}</td><td className="p-1">{number(point.adjusted_close)}</td></tr>)}</tbody>
        </table></div></details>}
      <p className="mt-2 break-all text-terminal-muted">Snapshot ID: {evidence.snapshot_id}{evidence.input_id ? ` · Input ID: ${evidence.input_id}` : ""}</p>
    </details>
  </div>;
}
