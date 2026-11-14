import { useEffect, useRef, useState } from "react";
import { deleteComparisonCapture, getComparisonCapture, listComparisonCaptures, streamCaptureFollowup,
  type CaptureSummary, type ComparisonCapture } from "../../api/comparisonCaptures";
import type { BriefingPhase } from "../../api/comparisonBriefing";
import { extractApiErrorMessage } from "../../api/base";
import { ComparisonBriefingResultView } from "./ComparisonBriefingResultView";

export function SavedComparisonBriefings({ revision, onDeleted }: { revision: number; onDeleted?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const previousRevision = useRef(revision);
  const [rows, setRows] = useState<CaptureSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [selected, setSelected] = useState<ComparisonCapture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInputs, setShowInputs] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [following, setFollowing] = useState<"rerun" | "refresh" | null>(null);
  const [followPhase, setFollowPhase] = useState<BriefingPhase>("queued");
  const followup = useRef<AbortController | null>(null);
  const list = useRef<AbortController | null>(null);
  const detail = useRef<AbortController | null>(null);
  const deletion = useRef<AbortController | null>(null);
  useEffect(() => () => { list.current?.abort(); detail.current?.abort(); deletion.current?.abort(); followup.current?.abort(); }, []);
  useEffect(() => {
    if (previousRevision.current !== revision) {
      previousRevision.current = revision;
      if (offset) { setOffset(0); return; }
    }
    if (open) void refresh();
  }, [open, revision, offset]);

  async function refresh() {
    list.current?.abort();
    const controller = new AbortController(); list.current = controller;
    setLoading(true); setRows([]); setError(null);
    try {
      const response = await listComparisonCaptures(controller.signal, offset);
      if (!controller.signal.aborted) { setRows(response); setLoaded(true); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(extractApiErrorMessage(failure, "Could not load saved briefings."));
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }
  async function inspect(id: string, keepCurrent = false) {
    stopFollowup();
    detail.current?.abort();
    const controller = new AbortController(); detail.current = controller;
    setOpening(id); setShowInputs(false); if (!keepCurrent) setSelected(null); setConfirmDelete(false); setError(null);
    try {
      const saved = await getComparisonCapture(id, controller.signal);
      if (!controller.signal.aborted) setSelected(saved);
    } catch (failure) {
      if (!controller.signal.aborted) setError(extractApiErrorMessage(failure, "Could not open this saved briefing."));
    } finally { if (!controller.signal.aborted) setOpening(null); }
  }
  async function remove() {
    if (!selected) return;
    const id = selected.id;
    list.current?.abort(); setLoading(false);
    const controller = new AbortController(); deletion.current = controller;
    setDeleting(true); setError(null);
    try {
      await deleteComparisonCapture(id, controller.signal);
      if (controller.signal.aborted) return;
      onDeleted?.(id);
      setSelected(null); setConfirmDelete(false); setRows((previous) => previous.filter((row) => row.id !== id));
      await refresh();
    } catch (failure) {
      if (!controller.signal.aborted) setError(extractApiErrorMessage(failure, "Deletion could not be confirmed. Refresh saved briefings to check."));
    } finally { if (!controller.signal.aborted) setDeleting(false); }
  }
  function stopFollowup() {
    if (followup.current) {
      followup.current.abort(); followup.current = null; setFollowing(null);
    }
  }
  async function follow(kind: "rerun" | "refresh") {
    if (!selected) return;
    stopFollowup();
    detail.current?.abort(); setOpening(null);
    const source = selected;
    const controller = new AbortController(); followup.current = controller;
    setFollowing(kind); setFollowPhase("queued"); setError(null); setConfirmDelete(false);
    try {
      const child = await streamCaptureFollowup(source, kind, { signal: controller.signal, onProgress: (value) => {
        if (!controller.signal.aborted) setFollowPhase(value);
      } });
      if (controller.signal.aborted) return;
      setSelected(child); setShowInputs(false);
      if (offset) setOffset(0); else await refresh();
    } catch (failure) {
      if (!controller.signal.aborted) setError(extractApiErrorMessage(failure, "Could not confirm the new saved run. Refresh saved briefings before retrying."));
    } finally {
      if (!controller.signal.aborted) { followup.current = null; setFollowing(null); }
    }
  }
  function close() {
    stopFollowup();
    detail.current?.abort(); deletion.current?.abort();
    setSelected(null); setOpening(null); setConfirmDelete(false); setDeleting(false);
  }

  return <section aria-label="Saved comparison briefings" className="space-y-3 rounded border border-terminal-border p-3">
    <button type="button" className="text-terminal-accent underline" aria-expanded={open} onClick={() => {
      if (open) { list.current?.abort(); close(); }
      setOpen(!open);
    }}>{open ? "Hide saved briefings" : "Review saved briefings"}</button>
    {open ? <>
      <p className="text-xs text-terminal-muted">Your saved runs, across selections, 20 per page. Opening one reads its original evidence and answer without fetching sources or running a model. Retained until you delete it.</p>
      <button type="button" className="underline disabled:opacity-50" disabled={loading || deleting} onClick={() => void refresh()}>Refresh saved briefings</button>
      {loading ? <p role="status">Loading saved briefings…</p> : loaded && !error && !rows.length ? <p>{offset ? "No more saved briefings on this page." : "No saved briefings yet."}</p> : null}
      {error ? <p role="alert" className="text-terminal-warn">{error}</p> : null}
      <ul className="space-y-2">{rows.map((row) => <li key={row.id}>
        <button type="button" className="text-terminal-accent underline disabled:opacity-50" disabled={deleting || Boolean(following)}
          onClick={() => void inspect(row.id)} aria-pressed={selected?.id === row.id}>
          Open saved {row.anchor} vs {row.comparisons.join(", ")} · {row.period} · {new Date(row.captured_at).toLocaleString()} · {row.status}
        </button>
      </li>)}</ul>
      <nav aria-label="Saved briefing pages" className="flex flex-wrap items-center gap-3 text-xs">
        <button type="button" className="underline disabled:opacity-50" disabled={!offset || loading || deleting} onClick={() => setOffset((value) => Math.max(0, value - 20))}>Previous saved briefings</button>
        <button type="button" className="underline disabled:opacity-50" disabled={offset >= 10000 || rows.length < 20 || loading || deleting} onClick={() => setOffset((value) => value + 20)}>Next saved briefings</button>
        {rows.length ? <span>Showing {offset + 1}–{offset + rows.length}</span> : null}
      </nav>
      {opening ? <p role="status">Opening the original saved briefing…</p> : null}
      {selected ? <section aria-label="Saved briefing review" className="space-y-3 border-t border-terminal-border pt-3">
        <h3 className="font-semibold">Saved scope: {selected.anchor} vs {selected.comparisons.join(", ")} · {selected.period}</h3>
        <p className="text-xs text-terminal-muted">Saved {new Date(selected.captured_at).toLocaleString()}. Evidence and generation dates below belong to this original run, independently of the page’s current selection. Retained until deleted.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="underline" onClick={close}>Close saved briefing</button>
          <button type="button" disabled={Boolean(following) || Boolean(opening)} className="text-terminal-neg underline disabled:opacity-50" onClick={() => setConfirmDelete(true)}>Delete saved briefing</button>
        </div>
        {selected.lineage ? <div aria-label="Saved run lineage" className="space-y-1 rounded border border-terminal-border p-2 text-xs">
          <p>{selected.lineage.kind === "saved_input_rerun" ? "Saved-input rerun" : "Fresh-data refresh"} of a run generated {new Date(selected.lineage.source_generated_at).toLocaleString()}.</p>
          <p className="break-all">Source ID: {selected.lineage.parent_id} · source content hash: {selected.lineage.parent_content_hash}</p>
          <button type="button" disabled={Boolean(following) || Boolean(opening) || deleting} className="text-terminal-accent underline" onClick={() => void inspect(selected.lineage!.parent_id, true)}>Open source saved run</button>
          <p>Each run retains its own evidence even if its source run is deleted.</p>
        </div> : null}
        <div aria-label="Saved run follow-up" className="space-y-2 rounded border border-terminal-border p-3 text-xs">
          <p>Re-run sends the last saved prompts and generation settings to the current Deep model with frozen source data. Refresh fetches current evidence for this saved selection and uses current prompts. Both save a separate linked run and keep this original unchanged.</p>
          <p>Re-run makes one checked completion with the saved response format and token budget. Model aliases and provider behavior can change; identical wording is not guaranteed.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={Boolean(following) || Boolean(opening) || deleting || !selected.content.result.evidence || !(selected.content.generation.attempts.length || selected.content.generation.prepared_request)}
              className="text-terminal-accent underline disabled:opacity-50" onClick={() => void follow("rerun")}>Re-run saved inputs</button>
            <button type="button" disabled={Boolean(following) || Boolean(opening) || deleting} className="text-terminal-accent underline disabled:opacity-50" onClick={() => void follow("refresh")}>Refresh with current data</button>
            {following ? <button type="button" className="underline" onClick={() => { stopFollowup(); setError("Request stopped. Refresh saved briefings to check whether saving completed."); }}>Cancel saved follow-up</button> : null}
          </div>
          {following ? <p role="status">{following === "rerun" ? "Re-running saved inputs" : "Refreshing current evidence"} · {followPhase.replace(/_/g, " ")}…</p> : null}
          {!selected.content.generation.attempts.length && !selected.content.generation.prepared_request ? <p>No saved completion request is available to re-run. Refresh can collect new evidence and start a new run.</p> : null}
        </div>
        {confirmDelete ? <div role="group" aria-label="Confirm saved briefing deletion" className="space-y-2 rounded border border-terminal-warn p-3">
          <p>Delete this saved briefing and its retained evidence and model inputs?</p>
          <button type="button" disabled={deleting} className="mr-3 text-terminal-neg underline" onClick={() => void remove()}>{deleting ? "Deleting…" : "Confirm deletion"}</button>
          <button type="button" disabled={deleting} className="underline" onClick={() => setConfirmDelete(false)}>Keep saved briefing</button>
        </div> : null}
        <ComparisonBriefingResultView key={selected.id} result={selected.content.result} />
        <details open={showInputs} onToggle={(event) => setShowInputs(event.currentTarget.open)} className="rounded border border-terminal-border p-3 text-xs">
          <summary className="cursor-pointer text-terminal-accent">Inspect saved model inputs</summary>
          <p className="mt-2">These are the original dispatched inputs, not a new model run. An empty attempt list means generation did not reach a completion request. Model aliases and provider behavior can change.</p>
          <p className="break-all">Capture {selected.id} · content hash {selected.content_hash}</p>
          {showInputs ? <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(selected.content.generation, null, 2)}</pre> : null}
        </details>
      </section> : null}
    </> : null}
  </section>;
}
