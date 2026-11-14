import { useEffect, useRef, useState } from "react";

import { streamComparisonBriefing, type BriefingPhase, type BriefingSelection, type ComparisonBriefingResult } from "../../api/comparisonBriefing";
import { extractApiErrorMessage } from "../../api/base";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { streamContextBriefing, type BriefingContextOptions, type ContextBriefingResult } from "../../api/comparisonContextBriefing";
import { streamComparisonCapture, type ComparisonCapture } from "../../api/comparisonCaptures";
import { ComparisonBriefingResultView } from "./ComparisonBriefingResultView";
import { SavedComparisonBriefings } from "./SavedComparisonBriefings";

const PHASES: Record<BriefingPhase, string> = {
  saving_capture: "Saving the briefing and its evidence", queued: "Starting briefing", preparing_evidence: "Preparing fresh comparison evidence",
  collecting_context: "Collecting selected dated context",
  checking_model: "Checking the model", generating: "Generating the briefing",
  validating: "Checking structure and citation references", retrying: "Repairing the model response once",
};
type Props = { selection: BriefingSelection; disabledReason?: string };
export function ComparisonBriefingPanel(props: Props) {
  return <BriefingPanelContent key={JSON.stringify([props.selection, props.disabledReason])} {...props} />;
}

function BriefingPanelContent({ selection, disabledReason }: Props) {
  const request = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });
  const [status, setStatus] = useState<"idle" | "running" | "finished" | "failed" | "cancelled">("idle");
  const [phase, setPhase] = useState<BriefingPhase>("queued");
  const [context, setContext] = useState<BriefingContextOptions>({ news: false, macro_regions: [] });
  const hasContext = Boolean(context.news || context.macro_regions.length || context.technical || context.fundamentals);
  const [result, setResult] = useState<ComparisonBriefingResult | ContextBriefingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ComparisonCapture | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);
  const [retaining, setRetaining] = useState(false);
  const [elapsed, setElapsed] = useState(0);

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

  async function generate(retain = false) {
    request.current.controller?.abort();
    const generation = ++request.current.generation;
    const controller = new AbortController();
    request.current.controller = controller;
    setSaved(null); setRetaining(retain);
    setResult(null); setError(null);
    setElapsed(0); setPhase("queued"); setStatus("running");
    try {
      const options = {
        signal: controller.signal,
        onProgress: (next: BriefingPhase) => {
          if (request.current.generation === generation && !controller.signal.aborted) setPhase(next);
        },
      };
      const capture = retain ? await streamComparisonCapture(selection, context, options) : null;
      const response = capture ? capture.content.result : hasContext
        ? await streamContextBriefing(selection, context, options)
        : await streamComparisonBriefing(selection, options);
      if (request.current.generation !== generation || controller.signal.aborted) return;
      setSaved(capture);
      if (capture) setSaveRevision((revision) => revision + 1);
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
    setStatus("cancelled"); setSaved(null); setResult(null); setError(null);
  }
  function changeContext(next: BriefingContextOptions) {
    request.current.generation += 1;
    request.current.controller?.abort();
    request.current.controller = undefined;
    setSaved(null); setContext(next); setStatus("idle"); setResult(null); setError(null);
  }
  return <TerminalPanel title="Comparison briefing" subtitle="On demand · citation references checked, not fact-checked">
    <div className="space-y-3 text-sm">
      <p className="text-terminal-muted">
        Applied selection: {selection.anchor} vs {selection.comparisons.join(", ")} · {selection.period}.
        {" "}This fetches a fresh shared-UTC, native-quote return snapshot, which may differ from the comparison below.
        {hasContext ? " Only context explicitly selected below will be included. Other page panels never imply inclusion. Exact SEC filing checks, separate FX/adjusted/local-date comparison views, private research and economic-calendar events remain excluded."
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
          <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(context.technical)}
            onChange={(event) => changeContext({ ...context, technical: event.target.checked })} />Technical observations</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(context.fundamentals)}
            onChange={(event) => changeContext({ ...context, fundamentals: event.target.checked })} />SEC filing facts</label>
        </div>
        {context.news || context.macro_regions.length ? <p className="text-xs text-terminal-warn">Headlines are unverified source text from incomplete current feeds. Macro is global reference-period context, not publication-day evidence or ticker relevance; current vintages do not establish past knowledge.</p> : null}
        {context.technical ? <p className="text-xs text-terminal-warn">Trend, momentum and unannualized volatility use each asset’s own Yahoo-reported adjusted closes. Lookbacks can span different calendar periods. Adjustment methods, sessions and bar completion remain unverified. Other feeds may provide prices without eligible technical values; these observations are not trading signals.</p> : null}
        {context.fundamentals ? <p className="text-xs text-terminal-warn">Selected US filing facts come from the current SEC aggregate and require host configuration of SEC_USER_AGENT. Conflicts are withheld. Fiscal periods, filing dates and retrieval times differ; these facts do not establish historical investor knowledge or verified revision order. Crypto and other unsupported symbols show their coverage gap.</p> : null}
      </fieldset>
      <p className="text-xs text-terminal-warn">References are checked, not the truth of the model’s prose. This is neither a causal explanation nor investment advice.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="rounded border border-terminal-border px-3 py-2 text-terminal-accent disabled:opacity-50"
          disabled={Boolean(disabledReason) || status === "running"} onClick={() => void generate()}>
          {status === "running" ? "Briefing in progress…" : status === "failed" || result?.status === "unavailable" ? "Retry briefing" : result?.status === "complete" ? "Generate new briefing" : "Generate briefing"}
        </button>
        <button type="button" className="rounded border border-terminal-accent px-3 py-2 text-terminal-accent disabled:opacity-50"
          disabled={Boolean(disabledReason) || status === "running"} onClick={() => void generate(true)}>Generate and save briefing</button>
        {status === "running" ? <button type="button" className="underline" onClick={cancel}>Cancel briefing</button> : null}
        {disabledReason ? <p className="text-xs text-terminal-muted">{disabledReason}</p> : null}
      </div>
      {status === "running" ? <p role="status" className="text-terminal-muted">{PHASES[phase]}… {elapsed}s elapsed. Only the final checked response will be shown.</p> : null}
      <p className="text-xs text-terminal-muted">Generate and save starts a new run with fresh evidence and retains its answer or failure, sources and model inputs. Reopening a saved briefing uses that original evidence.</p>
      {status === "cancelled" ? <p role="status" className="text-terminal-muted">{retaining ? "Request cancelled. Refresh saved briefings to check whether saving completed before cancellation." : "Briefing cancelled. No partial answer was kept."}</p> : null}
      {error ? <p role="alert" className="text-terminal-warn">{error}</p> : null}
      {saved ? <p role="status" className="text-xs text-terminal-pos">Saved {new Date(saved.captured_at).toLocaleString()} · retained until you delete it.</p> : null}
      {result && !saved ? <p className="text-xs text-terminal-muted">This briefing is temporary. Generate and save creates a separate, fresh run.</p> : null}
      {result ? <ComparisonBriefingResultView key={result.generated_at} result={result} /> : null}
      <SavedComparisonBriefings key={JSON.stringify(context)} revision={saveRevision} onDeleted={(id) => { if (saved?.id === id) setSaved(null); }} />
    </div>
  </TerminalPanel>;
}
