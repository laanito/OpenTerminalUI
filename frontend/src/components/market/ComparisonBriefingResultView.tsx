import { useEffect, useId, useState } from "react";
import { BRIEFING_CAVEATS, BRIEFING_EXCLUSIONS, type BriefingAsset, type BriefingPair,
  type BriefingStatement, type ComparisonBriefingResult } from "../../api/comparisonBriefing";
import { CONTEXT_CAVEATS, type ContextBriefingResult } from "../../api/comparisonContextBriefing";
import { ContextCoverage, ContextEvidenceSections } from "./BriefingContextEvidence";
import { TECHNICAL_CAVEATS } from "../../api/technicalContext";
import { FILING_CAVEATS } from "../../api/filingContext";

const GENERAL = new Set(["native_quote_not_fx_normalized", "utc_dates_not_simultaneous_sessions", "no_causal_or_investment_conclusion"]);
const number = (value: number) => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 21 }).format(value);

function Source({ asset }: { asset: BriefingAsset }) {
  return <p className="mt-1 text-terminal-muted">
    {asset.symbol}: adapter {asset.history_adapter ?? "unknown"} · feed {asset.history_feed ?? "unknown"} ·
    {" "}quote unit {asset.quote_unit ?? "unknown"} ({asset.quote_unit_source}) ·
    {" "}latest history date {asset.latest_date ?? "unknown"} · reported basis {asset.reported_adjustment_basis ?? "unknown"}.
    {asset.withheld_provider_close_count > 0 ? ` ${asset.withheld_provider_close_count} conflicting close dates withheld from the fetched payload, not necessarily this window.` : ""}
  </p>;
}

function PairEvidence({ pair }: { pair: BriefingPair }) {
  const returns = pair.returns;
  return <>
    <h4 className="font-semibold">{pair.citation_id}: {pair.anchor.symbol} vs {pair.comparison.symbol}</h4>
    {returns ? <p className="mt-1">
      {returns.start_date} to {returns.end_date} · {returns.observations} shared UTC closes · {returns.freshness} history.
      {" "}{pair.anchor.symbol}: {number(returns.anchor_return_pct)}%; {pair.comparison.symbol}: {number(returns.comparison_return_pct)}%;
      {" "}difference {number(returns.relative_return_pp)} percentage points (native quote units).
    </p> : <p className="mt-1 text-terminal-warn">Return unavailable: {pair.reason?.replace(/_/g, " ") ?? "not calculated"}. No zero return is implied.</p>}
    <Source asset={pair.anchor} /><Source asset={pair.comparison} />
    <ul className="mt-2 list-disc space-y-1 pl-5 text-terminal-muted">
      {pair.caveats.map((caveat) => <li key={caveat}>{BRIEFING_CAVEATS[caveat]}</li>)}
    </ul>
  </>;
}

export function ComparisonBriefingResultView({ result }: { result: ComparisonBriefingResult | ContextBriefingResult }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [citation, setCitation] = useState<{ reference: string } | null>(null);
  useEffect(() => {
    if (expanded && citation) {
      const target = document.getElementById(`${id}-${citation.reference}`);
      target?.focus(); target?.scrollIntoView?.({ block: "nearest" });
    }
  }, [expanded, citation, id]);
  function inspect(reference: string) { setCitation({ reference }); setExpanded(true); }
  function statements(title: string, points: BriefingStatement[]) {
    return <section aria-label={title} className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      <ul className="list-disc space-y-2 pl-5">{points.map((point, index) => <li key={index}>
        <span className="whitespace-pre-wrap">{point.text}</span>{" "}
        {point.citation_ids.map((reference) => <button key={reference} type="button"
          className="mr-2 text-terminal-accent underline" aria-controls={`${id}-${reference}`}
          aria-label={`Inspect ${reference} for ${title.toLowerCase()} ${index + 1}`} onClick={() => inspect(reference)}>
          [{reference}]
        </button>)}
      </li>)}</ul>
    </section>;
  }
  const contextPacket = result && "possible_context" in result ? result.evidence : null;
  const packet = contextPacket?.price ?? (result && !("possible_context" in result) ? result.evidence : null);
  const warnings = packet?.comparisons.filter((pair) => pair.caveats.some((caveat) => !GENERAL.has(caveat))) ?? [];

  return <div className="space-y-3">
        <p className="text-xs text-terminal-muted">
          {result.status === "complete" ? "Generated interpretation" : "Briefing unavailable"} · {new Date(result.generated_at).toLocaleString()}
          {result.model ? ` · model ${result.model}` : ""}
          {result.model_profile ? result.model_profile.resolved_profile === "deep"
            ? " · Deep profile" : " · Default profile (Deep not configured)" : ""}
        </p>
        <p className="text-xs text-terminal-warn">{result.scope_notice}</p>
        {contextPacket ? <ContextCoverage evidence={contextPacket} inspect={inspect} /> : null}
        {result.failure ? <p role="alert" className="text-terminal-warn">{result.failure.message} ({result.failure.code})</p> : null}
        {warnings.length ? <div aria-label="Mandatory evidence caveats" className="rounded border border-terminal-border p-2 text-xs text-terminal-warn">
          {warnings.map((pair) => <p key={pair.citation_id} className="mt-1">
            {pair.citation_id} · {pair.anchor.symbol}/{pair.comparison.symbol}: {pair.caveats.filter((caveat) => !GENERAL.has(caveat)).map((caveat) => BRIEFING_CAVEATS[caveat]).join(" ")}
          </p>)}
        </div> : null}
        {result.status === "complete" ? <>
          {statements("Observed movement", result.observations)}
          {"possible_context" in result ? (result.possible_context.length ? statements("Possible context", result.possible_context)
            : <p className="text-terminal-muted">No possible context was generated from the selected sources. Inspect coverage; this does not establish absence of relevant events.</p>) : null}
          <section aria-label="Interpretations to investigate" className="space-y-3">
            <h3 className="font-semibold">Interpretations to investigate</h3>
            <p className="text-xs text-terminal-warn">Model hypotheses, not established causes. Citations identify observed inputs; they do not prove a proposed mechanism.</p>
            {result.hypotheses.map((item, index) => <article key={index} className="space-y-2 rounded border border-terminal-border p-3">
              <h4 className="font-semibold whitespace-pre-wrap">{item.interpretation}</h4>
              <p className="whitespace-pre-wrap"><strong>Possible mechanism: </strong>{item.mechanism}</p>
              <p className="whitespace-pre-wrap"><strong>Competing explanation: </strong>{item.alternative}</p>
              <p className="whitespace-pre-wrap"><strong>What would help: </strong>{item.what_would_help}</p>
              <div className="text-xs">Observed inputs: {item.citation_ids.map((reference) => <button key={reference} type="button"
                className="mr-2 text-terminal-accent underline" aria-controls={`${id}-${reference}`}
                aria-label={`Inspect ${reference} for hypothesis ${index + 1}`} onClick={() => inspect(reference)}>[{reference}]</button>)}</div>
            </article>)}
          </section>
          {statements("Evidence limitations", result.limitations)}
          {statements("Unknowns", result.unknowns)}
        </> : null}
        {packet ? <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)} className="rounded border border-terminal-border p-3 text-xs">
          <summary className="cursor-pointer text-terminal-accent">Inspect briefing evidence snapshot ({packet.status})</summary>
          <div className="mt-3 space-y-3">
            <section id={`${id}-SCOPE`} tabIndex={-1} aria-label="SCOPE evidence" className="space-y-1 rounded p-2 focus:outline focus:outline-terminal-accent">
              <h3 className="font-semibold">SCOPE: this packet only</h3>
              <p>Fetched {new Date(packet.retrieved_at).toLocaleString()} · {packet.anchor} · {packet.period}. Shared UTC daily closes; native provider-close returns, not FX-normalized or verified simultaneous sessions.</p>
              {contextPacket ? <>
                <p>Included by explicit request: {contextPacket.requested.news ? "dated headlines" : "no news"}; macro regions {contextPacket.requested.macro_regions.join(", ") || "none"}; {contextPacket.requested.technical ? "technical observations" : "no technical observations"}; {contextPacket.requested.fundamentals ? "SEC filing facts" : "no filing facts"}. Prepared {new Date(contextPacket.prepared_at).toLocaleString()}.</p>
                <p>Always excluded (not evidence of absence): {contextPacket.always_excluded.map((key) => key === "economic_calendar" ? "Economic calendar" : BRIEFING_EXCLUSIONS[key as keyof typeof BRIEFING_EXCLUSIONS]).join(", ")}.</p>
                <ul className="list-disc space-y-1 pl-5">{contextPacket.caveats.map((key) => <li key={key}>{({ ...CONTEXT_CAVEATS, ...TECHNICAL_CAVEATS, ...FILING_CAVEATS })[key as keyof typeof CONTEXT_CAVEATS | keyof typeof TECHNICAL_CAVEATS | keyof typeof FILING_CAVEATS]}</li>)}</ul>
                <p className="break-all">Price subpacket ID: {packet.packet_id}</p>
              </> : <p>Not included (not evidence of absence): {packet.not_included.map((key) => BRIEFING_EXCLUSIONS[key]).join(", ")}.</p>}
              <p className="break-all">Snapshot ID: {contextPacket?.packet_id ?? packet.packet_id}</p>
              <p>All citations are local to this snapshot. The hash is not a signature or a historical archive.</p>
            </section>
            {packet.comparisons.map((pair) => <section key={pair.citation_id} id={`${id}-${pair.citation_id}`}
              tabIndex={-1} aria-label={`${pair.citation_id} evidence`} className="rounded border-t border-terminal-border p-2 focus:outline focus:outline-terminal-accent">
              <PairEvidence pair={pair} />
            </section>)}
            {contextPacket ? <ContextEvidenceSections evidence={contextPacket} id={id} /> : null}
          </div>
        </details> : null}
  </div>;
}
