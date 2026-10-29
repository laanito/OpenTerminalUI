import { useEffect, useId, useRef, useState } from "react";

import {
  BRIEFING_CAVEATS, BRIEFING_EXCLUSIONS, streamComparisonBriefing,
  type BriefingAsset, type BriefingPair, type BriefingPhase, type BriefingSelection,
  type BriefingStatement, type ComparisonBriefingResult,
} from "../../api/comparisonBriefing";
import { extractApiErrorMessage } from "../../api/base";
import { TerminalPanel } from "../terminal/TerminalPanel";
import {
  CONTEXT_CAVEATS, streamContextBriefing,
  type BriefingContextOptions, type ContextBriefingResult,
} from "../../api/comparisonContextBriefing";
import { ContextCoverage, ContextEvidenceSections } from "./BriefingContextEvidence";

const PHASES: Record<BriefingPhase, string> = {
  queued: "Starting briefing", preparing_evidence: "Preparing fresh comparison evidence",
  collecting_context: "Collecting selected dated context",
  checking_model: "Checking the model", generating: "Generating the briefing",
  validating: "Checking structure and citation references", retrying: "Repairing the model response once",
};
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

type Props = { selection: BriefingSelection; disabledReason?: string };
export function ComparisonBriefingPanel(props: Props) {
  return <BriefingPanelContent key={JSON.stringify([props.selection, props.disabledReason])} {...props} />;
}

function BriefingPanelContent({ selection, disabledReason }: Props) {
  const id = useId();
  const request = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });
  const [status, setStatus] = useState<"idle" | "running" | "finished" | "failed" | "cancelled">("idle");
  const [phase, setPhase] = useState<BriefingPhase>("queued");
  const [context, setContext] = useState<BriefingContextOptions>({ news: false, macro_regions: [] });
  const [result, setResult] = useState<ComparisonBriefingResult | ContextBriefingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [citation, setCitation] = useState<{ reference: string } | null>(null);

  useEffect(() => () => {
    request.current.generation += 1;
    request.current.controller?.abort();
  }, []);
  useEffect(() => {
    if (status !== "running") return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [status]);
  useEffect(() => {
    if (expanded && citation) {
      const target = document.getElementById(`${id}-${citation.reference}`);
      target?.focus();
      target?.scrollIntoView?.({ block: "nearest" });
    }
  }, [expanded, citation, id]);

  async function generate() {
    request.current.controller?.abort();
    const generation = ++request.current.generation;
    const controller = new AbortController();
    request.current.controller = controller;
    setResult(null); setError(null); setExpanded(false); setCitation(null);
    setElapsed(0); setPhase("queued"); setStatus("running");
    try {
      const options = {
        signal: controller.signal,
        onProgress: (next: BriefingPhase) => {
          if (request.current.generation === generation && !controller.signal.aborted) setPhase(next);
        },
      };
      const response = context.news || context.macro_regions.length
        ? await streamContextBriefing(selection, context, options)
        : await streamComparisonBriefing(selection, options);
      if (request.current.generation !== generation || controller.signal.aborted) return;
      setResult(response); setStatus("finished");
    } catch (failure) {
      if (request.current.generation !== generation || controller.signal.aborted) return;
      setError(extractApiErrorMessage(failure, "Could not complete the briefing. Retry manually."));
      setStatus("failed");
    } finally {
      if (request.current.generation === generation) request.current.controller = undefined;
    }
  }

  function cancel() {
    request.current.generation += 1;
    request.current.controller?.abort();
    request.current.controller = undefined;
    setStatus("cancelled"); setResult(null); setError(null); setExpanded(false); setCitation(null);
  }
  function inspect(reference: string) {
    // Each click is a new focus request, including repeated references.
    setCitation({ reference }); setExpanded(true);
  }
  function changeContext(next: BriefingContextOptions) {
    request.current.generation += 1;
    request.current.controller?.abort();
    request.current.controller = undefined;
    setContext(next); setStatus("idle"); setResult(null); setError(null); setExpanded(false); setCitation(null);
  }
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

  return <TerminalPanel title="Comparison briefing" subtitle="On demand · citation references checked, not fact-checked">
    <div className="space-y-3 text-sm">
      <p className="text-terminal-muted">
        Applied selection: {selection.anchor} vs {selection.comparisons.join(", ")} · {selection.period}.
        {" "}This fetches a fresh shared-UTC, native-quote return snapshot, which may differ from the comparison below.
        {context.news || context.macro_regions.length ? " Only news and macro regions explicitly selected below will be included. Other page panels never imply inclusion. Fundamentals, SEC, technical, FX/adjusted/local-date views, private research and economic-calendar events remain excluded."
          : " Optional news, fundamentals, SEC, macro, technical, FX/adjusted/local-date views and private research are not included—even if open elsewhere on this page."}
      </p>
      <fieldset className="space-y-2 rounded border border-terminal-border p-3">
        <legend className="px-1 font-semibold">Briefing evidence scope</legend>
        <p className="text-xs text-terminal-muted">Price returns are always included when available. Context is opt-in; macro regions are not inferred from tickers. Changing scope clears the answer and cancels any running request.</p>
        <div className="flex flex-wrap gap-x-5 gap-y-3">
          <label className="flex items-center gap-2"><input type="checkbox" checked={context.news}
            onChange={(event) => changeContext({ ...context, news: event.target.checked })} />Dated news headlines</label>
          {(["us", "euro_area"] as const).map((region) => <label key={region} className="flex items-center gap-2"><input type="checkbox" checked={context.macro_regions.includes(region)}
            onChange={(event) => changeContext({ ...context, macro_regions: (["us", "euro_area"] as const).filter((item) => item === region ? event.target.checked : context.macro_regions.includes(item)) })} />
            {region === "us" ? "US macro (FRED)" : "Euro-area macro (Eurostat/ECB)"}</label>)}
        </div>
        {context.news || context.macro_regions.length ? <p className="text-xs text-terminal-warn">Headlines are unverified source text from incomplete current feeds. Macro is global reference-period context, not publication-day evidence or ticker relevance; current vintages do not establish past knowledge.</p> : null}
      </fieldset>
      <p className="text-xs text-terminal-warn">References are checked, not the truth of the model’s prose. This is neither a causal explanation nor investment advice.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="rounded border border-terminal-border px-3 py-2 text-terminal-accent disabled:opacity-50"
          disabled={Boolean(disabledReason) || status === "running"} onClick={() => void generate()}>
          {status === "running" ? "Briefing in progress…" : status === "failed" || result?.status === "unavailable" ? "Retry briefing" : result?.status === "complete" ? "Generate new briefing" : "Generate briefing"}
        </button>
        {status === "running" ? <button type="button" className="underline" onClick={cancel}>Cancel briefing</button> : null}
        {disabledReason ? <p className="text-xs text-terminal-muted">{disabledReason}</p> : null}
      </div>
      {status === "running" ? <p role="status" className="text-terminal-muted">{PHASES[phase]}… {elapsed}s elapsed. Only the final checked response will be shown.</p> : null}
      {status === "cancelled" ? <p role="status" className="text-terminal-muted">Briefing cancelled. No partial answer was kept.</p> : null}
      {error ? <p role="alert" className="text-terminal-warn">{error}</p> : null}
      {result ? <div className="space-y-3">
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
                <p>Included by explicit request: {contextPacket.requested.news ? "dated headlines" : "no news"}; macro regions {contextPacket.requested.macro_regions.join(", ") || "none"}. Prepared {new Date(contextPacket.prepared_at).toLocaleString()}.</p>
                <p>Always excluded (not evidence of absence): {contextPacket.always_excluded.map((key) => key === "economic_calendar" ? "Economic calendar" : BRIEFING_EXCLUSIONS[key as keyof typeof BRIEFING_EXCLUSIONS]).join(", ")}.</p>
                <ul className="list-disc space-y-1 pl-5">{contextPacket.caveats.map((key) => <li key={key}>{CONTEXT_CAVEATS[key as keyof typeof CONTEXT_CAVEATS]}</li>)}</ul>
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
      </div> : null}
    </div>
  </TerminalPanel>;
}
