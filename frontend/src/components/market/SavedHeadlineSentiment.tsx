import { useEffect, useRef, useState } from "react";
import { extractApiErrorMessage } from "../../api/base";
import type { BriefingPhase } from "../../api/comparisonBriefing";
import type { ComparisonCapture } from "../../api/comparisonCaptures";
import { getRetainedHeadline, listHeadlineAssessments, savedHeadlineChoices, streamHeadlineAssessments, retainedObservationKey, deleteRetainedHeadline,
  type RetainedAssessment, type RetainedHeadline } from "../../api/headlineSentiment";

const when = (value: string | null) => value ? new Date(value).toLocaleString() : "Unknown";
const phases: Partial<Record<BriefingPhase, string>> = {
  queued: "Starting assessment", preparing_evidence: "Preparing saved headlines", checking_model: "Checking Fast model",
  generating: "Assessing selected headlines", validating: "Checking assessments", saving_capture: "Saving assessments",
};
function sourceUrl(value: string) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
}
export function Assessment({ item }: { item: RetainedAssessment }) {
  const [inputs, setInputs] = useState(false);
  const p = item.payload;
  const tone = p.meaning === "text_tone";
  const label = tone ? p.label === "bullish" ? "Positive" : p.label === "bearish" ? "Negative" : "Neutral" : p.label;
  return <article aria-label={`${tone ? "Text tone" : "Asset implication"} assessment ${item.id}`} className="min-w-0 space-y-2 rounded border border-terminal-border p-3 [overflow-wrap:anywhere]">
    <h5 className="font-semibold">{tone ? "Text tone" : `Asset implication for ${p.target_symbol}`}</h5>
    {p.status === "failed" ? <p className="text-terminal-warn">Not assessed · {p.failure_code?.replace(/_/g, " ")}. No model verdict is available.</p>
      : <><p>{label} · score {p.score?.toFixed(4)}{p.status === "fallback" ? ` · fallback (${p.failure_code})` : ""}</p>
        {p.rationale ? <p className="whitespace-pre-wrap">{p.rationale}</p> : null}</>}
    <p className="text-terminal-muted">Method {p.method} · {p.method_version}{p.model ? ` · model ${p.model}` : ""}</p>
    <p className="text-terminal-muted">Originally scored {when(p.scored_at)} · recorded {when(item.recorded_at)}{p.reused_from_cache ? " · reused from cache; scoring time preserved" : ""}</p>
    {p.confidence !== null ? <p>Heuristic confidence: {p.confidence} (not a correctness probability)</p> : null}
    {p.generation ? <details open={inputs} onToggle={(event) => setInputs(event.currentTarget.open)}>
      <summary className="cursor-pointer text-terminal-accent">Inspect scoring inputs</summary>
      <p>Original dispatched inputs, including the batch and target context. Opening this does not run a model.</p>
      {inputs ? <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(p.generation, null, 2)}</pre> : null}
    </details> : null}
  </article>;
}
export function RetainedEvidence({ row, embedded = false }: { row: RetainedHeadline; embedded?: boolean }) {
  const p = row.payload;
  const href = sourceUrl(p.source_url);
  return <section aria-label={`Retained headline ${row.id}`} tabIndex={-1} className="min-w-0 space-y-3 rounded border border-terminal-accent p-3 text-xs [overflow-wrap:anywhere]">
    <h4 className="font-semibold whitespace-pre-wrap">{p.title || "Retained news text"}</h4>
    {p.summary ? <p className="whitespace-pre-wrap">{p.summary}</p> : null}
    <p>{p.text_scope === "headline_only" ? "Headline only; full article not read" : "Headline and supplied summary"}{p.truncated ? " · source text was truncated" : ""}</p>
    <p>{p.publisher || "Unknown publisher"} · published {when(p.published_at)} · originally retrieved {when(p.retrieved_at)} · captured {when(row.captured_at)}</p>
    {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-terminal-accent underline">Open publisher source</a> : null}
    <p>Snapshot {row.id} · text hash {row.content_hash}</p>
    <p className="text-terminal-muted">{embedded ? "This evidence copy is retained with the saved briefing."
      : row.lifecycle?.state === "pinned" ? `Protected by ${row.lifecycle.referencing_capture_ids.length}${row.lifecycle.references_truncated ? "+" : ""} saved run(s).`
      : row.lifecycle?.expires_at ? `${row.lifecycle.state === "expired" ? "Eligible for cleanup since" : "Eligible for cleanup after"} ${when(row.lifecycle.expires_at)}.`
      : "Automatic expiry is disabled."}</p>
    {p.origin ? <p>Source saved run {p.origin.capture_id} · source hash {p.origin.capture_content_hash} · selected references {p.origin.citation_ids.join(", ")}</p>
      : <p>Source comparison provenance was not recorded.</p>}
    <div className="grid min-w-0 gap-3 lg:grid-cols-2">{row.assessments.map((item) => <Assessment key={item.id} item={item} />)}</div>
    {!row.assessments.length ? <p>No assessments were recorded for this text snapshot.</p> : null}
  </section>;
}

export function SavedHeadlineSentiment({ source, disabled = false, onBusyChange, onInterpret }: {
  source: ComparisonCapture | null; disabled?: boolean; onBusyChange: (busy: boolean) => void;
  onInterpret?: (snapshotIds: string[]) => void;
}) {
  const choices = savedHeadlineChoices(source);
  const [picked, setPicked] = useState<string[]>([]);
  const [interpretationIds, setInterpretationIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<BriefingPhase>("queued");
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(!source);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<RetainedHeadline[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<RetainedHeadline | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false), [deleting, setDeleting] = useState(false);
  const deletion = useRef<AbortController | null>(null);
  const run = useRef<AbortController | null>(null), listing = useRef<AbortController | null>(null), detail = useRef<AbortController | null>(null);
  const evidence = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => { run.current?.abort(); listing.current?.abort(); detail.current?.abort(); deletion.current?.abort(); onBusyChange(false); }, [onBusyChange]);
  useEffect(() => { if (open) void refresh(); }, [open, offset, all]);
  useEffect(() => { if (selected) evidence.current?.querySelector<HTMLElement>("section")?.focus(); }, [selected]);
  async function refresh() {
    listing.current?.abort();
    const controller = new AbortController(); listing.current = controller;
    setLoading(true); setRows([]); setInterpretationIds([]); setError(null);
    try {
      const result = await listHeadlineAssessments(all ? undefined : source?.id, offset, controller.signal);
      if (!controller.signal.aborted) { setRows(result); setLoaded(true); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(extractApiErrorMessage(failure, "Could not load retained assessments."));
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }
  async function inspect(id: string) {
    detail.current?.abort();
    const controller = new AbortController(); detail.current = controller;
    setOpening(true); setSelected(null); setConfirmDelete(false); setError(null);
    try {
      const result = await getRetainedHeadline(id, controller.signal);
      if (!controller.signal.aborted) setSelected(result);
    } catch (failure) {
      if (!controller.signal.aborted) setError(extractApiErrorMessage(failure, "Could not inspect this retained headline."));
    } finally { if (!controller.signal.aborted) setOpening(false); }
  }
  async function assess() {
    if (!source || !picked.length || run.current || deleting) return;
    listing.current?.abort(); setLoading(false);
    detail.current?.abort(); setOpening(false); setSelected(null); setReceipt(null); setError(null);
    const controller = new AbortController(); run.current = controller;
    setRunning(true); setPhase("queued"); onBusyChange(true);
    try {
      const result = await streamHeadlineAssessments(source, choices.filter((item) => picked.includes(item.citation_id))
        .map(({ citation_id, target_symbol }) => ({ citation_id, target_symbol })), {
        signal: controller.signal, onProgress: (value) => { if (!controller.signal.aborted) setPhase(value); },
      });
      if (controller.signal.aborted) return;
      setReceipt(`Saved ${result.length} headline observation${result.length === 1 ? "" : "s"} from ${picked.length} selected reference${picked.length === 1 ? "" : "s"}.`);
      setPicked([]); setSelected(result[0]);
      if (offset || !open) { setOffset(0); setOpen(true); } else await refresh();
    } catch (failure) {
      if (!controller.signal.aborted) setError(extractApiErrorMessage(failure, "Assessment saving could not be confirmed. Refresh retained assessments before retrying."));
    } finally {
      if (!controller.signal.aborted) { run.current = null; setRunning(false); onBusyChange(false); }
    }
  }
  function cancel() {
    run.current?.abort(); run.current = null; setRunning(false); onBusyChange(false);
    setError("Assessment request stopped. Refresh retained assessments to check whether saving completed before retrying.");
  }
  async function remove() {
    if (!selected || deleting) return;
    const controller = new AbortController(); deletion.current = controller;
    setDeleting(true); onBusyChange(true); setError(null);
    try {
      await deleteRetainedHeadline(selected.id, controller.signal);
      if (controller.signal.aborted) return;
      setSelected(null); setConfirmDelete(false); setReceipt("Retained headline and its assessments deleted.");
      await refresh();
    } catch (failure) {
      if (!controller.signal.aborted) setError(extractApiErrorMessage(failure, "Deletion could not be confirmed. Refresh retained history before retrying."));
    } finally {
      if (!controller.signal.aborted) { setDeleting(false); onBusyChange(false); }
    }
  }
  const busy = running || deleting;
  return <section aria-label="Headline sentiment" className="min-w-0 space-y-3 rounded border border-terminal-border p-3 text-xs [overflow-wrap:anywhere]">
    <h3 className="font-semibold">Headline sentiment</h3>
    <p>Keyword text tone and the Fast model’s implication for a named asset answer different questions. They are not a combined signal or measured investor sentiment.</p>
    {source ? <p>Source saved scope: {source.anchor} vs {source.comparisons.join(", ")} · {source.period}. Assessments use this saved text, independently of the current market page.</p> : null}
    {choices.length ? <>
      <p>Choose up to ten saved headline references. We retain selected text and both assessments independently of the source briefing. This does not change its answer or send sentiment to Deep.</p>
      <fieldset disabled={disabled || busy} className="max-h-80 space-y-2 overflow-y-auto rounded border border-terminal-border p-2">
        <legend>Saved headlines to assess · {picked.length}/10 selected</legend>
        {choices.map((choice) => <label key={choice.citation_id} className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 shrink-0" checked={picked.includes(choice.citation_id)} disabled={picked.length >= 10 && !picked.includes(choice.citation_id)}
            onChange={(event) => setPicked((previous) => event.target.checked ? [...previous, choice.citation_id] : previous.filter((id) => id !== choice.citation_id))} />
          <span className="min-w-0">{choice.target_symbol} · {choice.citation_id} · {choice.title}<span className="block text-terminal-muted">{choice.source} · published {when(choice.published_at)}{choice.title_truncated ? " · truncated headline" : ""}</span></span>
        </label>)}
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={disabled || busy || !picked.length} className="text-terminal-accent underline disabled:opacity-50" onClick={() => void assess()}>Assess and retain selected headlines</button>
        {running ? <button type="button" className="underline" onClick={cancel}>Cancel headline assessment</button> : null}
      </div>
    </> : <p>Open a saved briefing with news headlines to choose text to assess. Existing retained assessments can be reviewed below.</p>}
    {running ? <p role="status">{phases[phase] ?? "Processing assessments"}…</p> : null}
    {receipt ? <p role="status">{receipt}</p> : null}
    {error ? <p role="alert" className="text-terminal-warn">{error}</p> : null}
    <button type="button" className="text-terminal-accent underline" aria-expanded={open} disabled={busy} onClick={() => {
      if (open) { listing.current?.abort(); detail.current?.abort(); setLoading(false); setOpening(false); setSelected(null); }
      setOpen(!open);
    }}>{open ? "Hide retained assessments" : "Review retained headline assessments"}</button>
    {open ? <>
      <p>Retained history · 20 observations per page. Opening a record reads original evidence without running a model. Unreferenced observations follow the retention policy.</p>
      {source ? <label className="flex items-center gap-2"><input type="checkbox" checked={all} disabled={busy} onChange={(event) => {
        listing.current?.abort(); detail.current?.abort(); setOpening(false); setSelected(null); setOffset(0); setAll(event.target.checked);
      }} />Show all retained headline assessments</label> : null}
      <button type="button" className="underline disabled:opacity-50" disabled={loading || busy} onClick={() => void refresh()}>Refresh retained assessments</button>
      {loading ? <p role="status">Loading retained assessments…</p> : loaded && !rows.length && !error ? <p>{offset ? "No more retained observations on this page." : "No retained headline assessments yet."}</p> : null}
      {source && onInterpret && source.mode === "context" && source.content.result.evidence && !("sentiment" in source.content.result.evidence) ? <p>Select up to five retained observations, one per headline/target, for a new Deep interpretation. Original methods, dates, disagreements and failures are kept; no news is fetched or rescored.</p> : null}
      <ul className="space-y-2">{rows.map((row) => <li key={row.id}>
        {source && onInterpret && source.mode === "context" && source.content.result.evidence && !("sentiment" in source.content.result.evidence)
          && row.payload.origin?.capture_id === source.id && row.payload.origin.capture_content_hash === source.content_hash ? <label className="mb-1 flex items-center gap-2">
          <input type="checkbox" aria-label={`Use ${row.payload.title || row.id} in Deep interpretation`} checked={interpretationIds.includes(row.id)}
            disabled={disabled || busy || (!interpretationIds.includes(row.id) && (interpretationIds.length >= 5 || rows.some(other => interpretationIds.includes(other.id) && retainedObservationKey(other) === retainedObservationKey(row))))}
            onChange={(event) => setInterpretationIds(previous => event.target.checked ? [...previous, row.id] : previous.filter(id => id !== row.id))} />
          Include in Deep interpretation
        </label> : null}
        <button type="button" className="text-left text-terminal-accent underline disabled:opacity-50" disabled={busy} aria-pressed={selected?.id === row.id}
          onClick={() => void inspect(row.id)}>Inspect retained headline {row.id} · {row.payload.symbols.join(", ") || "Unspecified symbols"} · {row.payload.title || "Summary-only source"} · captured {when(row.captured_at)}</button>
      </li>)}</ul>
      {interpretationIds.length && onInterpret ? <button type="button" disabled={disabled || busy || loading}
        className="text-terminal-accent underline disabled:opacity-50" onClick={() => onInterpret(interpretationIds)}>Interpret selected sentiment and save ({interpretationIds.length}/5)</button> : null}
      <nav aria-label="Retained assessment pages" className="flex flex-wrap gap-3">
        <button type="button" className="underline disabled:opacity-50" disabled={!offset || loading || busy} onClick={() => setOffset((value) => Math.max(0, value - 20))}>Previous retained assessments</button>
        <button type="button" className="underline disabled:opacity-50" disabled={offset >= 10000 || rows.length < 20 || loading || busy} onClick={() => setOffset((value) => value + 20)}>Next retained assessments</button>
      </nav>
    </> : null}
    {opening ? <p role="status">Opening retained evidence…</p> : null}
    {selected ? <div ref={evidence} className="space-y-2"><RetainedEvidence key={selected.id} row={selected} />
      {selected.lifecycle?.state === "pinned" ? <p>Delete the referencing saved runs before removing this standalone evidence.</p>
        : selected.lifecycle ? <button type="button" disabled={disabled || busy} className="text-terminal-neg underline disabled:opacity-50" onClick={() => setConfirmDelete(true)}>Delete retained headline</button> : null}
      {confirmDelete ? <div role="group" aria-label="Confirm retained headline deletion" className="space-y-2 rounded border border-terminal-warn p-2">
        <p>Delete this standalone headline and both assessments? Saved briefings remain unchanged.</p>
        <button type="button" disabled={disabled || busy} className="mr-3 text-terminal-neg underline" onClick={() => void remove()}>{deleting ? "Deleting…" : "Confirm evidence deletion"}</button>
        <button type="button" disabled={busy} className="underline" onClick={() => setConfirmDelete(false)}>Keep retained headline</button>
      </div> : null}
    </div> : null}
  </section>;
}
