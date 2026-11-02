import type { HTMLAttributes } from "react";
import { TECHNICAL_DEFINITIONS, TECHNICAL_REASONS, type ContextTechnicalSection } from "../../api/technicalContext";

const number = (value: number) => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 21 }).format(Object.is(value, -0) ? 0 : value);
const reason = (code: string | null) => code && Object.prototype.hasOwnProperty.call(TECHNICAL_REASONS, code)
  ? TECHNICAL_REASONS[code] : "No value available";

export function TechnicalBriefingEvidence({ section, target }: {
  section: ContextTechnicalSection; target: (ref: string) => HTMLAttributes<HTMLElement>;
}) {
  return <>
    <p>Yahoo-reported adjusted closes on each asset’s own UTC dates. These are descriptive observations, not trading signals. Lookbacks may span different calendar periods.</p>
    {!section.assets.length ? <p>No technical values included. Inspect the coverage reason; missing values are not zero.</p> : null}
    {section.assets.map((asset) => <section key={asset.citation_id} {...target(asset.citation_id)}>
      <h4 className="font-semibold">{asset.citation_id}: {asset.symbol} · {asset.status === "available" ? "Available observations" : asset.status === "partial" ? "Partial observations" : "Technical input unavailable"}</h4>
      <p>{asset.source ?? "Unknown adapter"} · {asset.feed ?? "Unknown feed"} · quote unit {asset.quote_unit ?? "unknown"} · reported type {asset.instrument_type ?? "unknown"}.</p>
      <p>{asset.available_closes} observed closes in the pair window{asset.as_of_date ? ` · as of ${asset.as_of_date}` : " · no calculation window"}.
        {asset.freshness ? ` ${asset.freshness === "stale" ? "Stale" : "Current"} source history.` : ""}
        {asset.input_reason ? ` ${reason(asset.input_reason)}.` : ""}</p>
      <p className="text-terminal-warn">Adjustment methods, exchange sessions and bar completion have not been independently verified. Volatility is unannualized.</p>
      <p>Reported timezone {asset.exchange_timezone ?? "unknown"}; {asset.shifted_local_dates} source dates have different UTC/local labels. Calculations retain UTC observation dates.</p>
      {asset.metrics.map((metric, index) => <section key={metric.citation_id} {...target(metric.citation_id)}>
        <h5 className="font-semibold">{metric.citation_id}: {TECHNICAL_DEFINITIONS[index].label}</h5>
        {metric.status === "available" && metric.value !== null
          ? <p className="text-sm font-semibold">{number(metric.value)} {metric.unit === "percent" ? "%" : "percentage points"}</p>
          : <p className="text-terminal-warn">Unavailable · {reason(metric.reason)}. Requires {metric.required_closes} closes; {asset.available_closes} available. No zero value is implied.</p>}
        {metric.start_date ? <p>{metric.start_date} to {metric.end_date} · {metric.used_closes} own dated closes · lookback {metric.lookback} {metric.required_closes === 20 ? "closes" : "close-to-close returns"}.</p> : null}
        <p>Formula: <code className="whitespace-pre-wrap break-words">{metric.formula}</code></p>
        {metric.name === "volatility20_pp" ? <p>Sample standard deviation of 20 simple returns, divisor 19; no annualization.</p> : null}
        {metric.observation_dates.length ? <details>
          <summary className="cursor-pointer text-terminal-accent">Exact observation dates ({metric.observation_dates.length})</summary>
          <p className="mt-1 break-words">{metric.observation_dates.join(", ")}</p>
        </details> : null}
        {metric.observation_id ? <p className="break-all text-terminal-muted">Observation ID: {metric.observation_id}</p> : null}
      </section>)}
      {asset.supporting_points.length ? <details>
        <summary className="cursor-pointer text-terminal-accent">Supporting adjusted closes ({asset.supporting_points.length})</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs" aria-label={`${asset.symbol} supporting adjusted closes`}>
            <thead><tr><th className="p-1">UTC date</th><th className="p-1">Adjusted close ({asset.quote_unit})</th></tr></thead>
            <tbody>{asset.supporting_points.map((point) => <tr key={point.date}><td className="p-1">{point.date}</td><td className="break-all p-1">{number(point.adjusted_close)}</td></tr>)}</tbody>
          </table>
        </div>
      </details> : null}
      {asset.input_id ? <p className="break-all text-terminal-muted">Input ID: {asset.input_id}</p> : null}
    </section>)}
  </>;
}
