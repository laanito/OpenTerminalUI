import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { createSavedView, deleteSavedView, listSavedViews, updateSavedView, type SavedView, type SavedViewPayload } from "../../api/client";
import { useStockStore } from "../../store/stockStore";
import { WORKSPACE_PRESET_STORAGE_KEY, readWorkspacePreset } from "../../workspace/presets";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalModal } from "../terminal/TerminalModal";

const CAPTURE_STORAGE_KEYS = [
  WORKSPACE_PRESET_STORAGE_KEY,
  "ot:launchpad:layouts:v1",
  "ot:launchpad:active:v1",
  "ot:chart-workstation:v3",
  "ot:chart-workstation:snapshots:v1",
  "ot:backtesting:workspace:v1",
  "ot:portfolio:view:v1",
  "ot:screener:view:v1",
];
const PENDING_SAVED_VIEW_KEY = "ot:saved-view:pending";

function readStorageSnapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of CAPTURE_STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      out[key] = JSON.parse(raw);
    } catch {
      out[key] = localStorage.getItem(key);
    }
  }
  return out;
}

function restoreStorageSnapshot(storage: Record<string, unknown> | undefined) {
  if (!storage) return;
  for (const [key, value] of Object.entries(storage)) {
    try {
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    } catch {
      // Ignore storage failures and still restore route-level state.
    }
  }
}

function pageScope(pathname: string): string {
  if (pathname.includes("screener")) return "screener";
  if (pathname.includes("chart-workstation")) return "chart-workstation";
  if (pathname.includes("backtesting")) return "backtesting";
  if (pathname.includes("cockpit")) return "cockpit";
  if (pathname.includes("portfolio")) return "portfolio";
  return "workspace";
}

type Editor = ({ kind: "save"; payload: SavedViewPayload; scope: string; page: string } | { kind: "rename"; view: SavedView }) & { epoch: number };

export function SavedViewsControl({ pageLabel, capture, library = false }: {
  pageLabel: string; capture?: () => Partial<SavedViewPayload>; library?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const ticker = useStockStore(state => state.ticker);
  const setTicker = useStockStore(state => state.setTicker);
  const scope = pageScope(location.pathname);
  const listScope = library ? undefined : scope;
  const [views, setViews] = useState<SavedView[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [status, setStatus] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [name, setName] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const formId = useId();
  const libraryRef = useRef<HTMLDivElement>(null);
  const returnToLibrary = useRef(false);

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true); setLoadError("");
    try {
      const rows = await listSavedViews(listScope ? { scope: listScope } : undefined);
      if (request === requestId.current) setViews(rows);
    } catch {
      if (request === requestId.current) setLoadError("Could not refresh saved views. Any previous entries below have not been refreshed.");
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [listScope]);

  useEffect(() => {
    mounted.current = true; setBusy(false); setViews([]); setEditor(null); setActionError(""); setStatus(""); void refresh();
    return () => { mounted.current = false; requestId.current++; epoch.current++; };
  }, [refresh]);

  useEffect(() => {
    if (!editor && returnToLibrary.current) { returnToLibrary.current = false; libraryRef.current?.focus(); }
  }, [editor]);

  function beginSave() {
    setStatus(""); setFormError("");
    setName(`${pageLabel} ${new Date().toLocaleString()}`);
    // Capture the opening page/scope, not a potentially different page at submit.
    setEditor({ kind: "save", scope, page: location.pathname, epoch: epoch.current, payload: {
      page: location.pathname, search: location.search, selectedTicker: ticker,
      shellPreset: readWorkspacePreset(), storage: readStorageSnapshot(), ...(capture?.() ?? {}),
    } });
  }

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || busy) return;
    if (!name.trim()) { setFormError("Enter a name for this view."); return; }
    setBusy(true); setFormError("");
    let confirmed = false;
    try {
      const saved = editor.kind === "save"
        ? await createSavedView({ name: name.trim(), scope: editor.scope, page: editor.page, payload: editor.payload })
        : await updateSavedView(editor.view.id, { name: name.trim() });
      if (!mounted.current || editor.epoch !== epoch.current) return;
      setViews(previous => [saved, ...previous.filter(view => view.id !== saved.id)]);
      if (editor.kind === "rename") returnToLibrary.current = true;
      setEditor(null); setStatus(editor.kind === "save" ? "View saved." : "View renamed.");
      confirmed = true;
    } catch {
      if (mounted.current && editor.epoch === epoch.current) setFormError("Could not save this name. Your draft is still here; check the library before retrying manually.");
    } finally { if (mounted.current && editor.epoch === epoch.current) setBusy(false); }
    if (confirmed && mounted.current && editor.epoch === epoch.current) await refresh();
  }

  async function removeView(view: SavedView) {
    if (busy || !window.confirm(`Delete ${view.name}?`)) return;
    const operationEpoch = epoch.current;
    setBusy(true); setActionError(""); setStatus("");
    let confirmed = false;
    try {
      await deleteSavedView(view.id);
      if (!mounted.current || operationEpoch !== epoch.current) return;
      setViews(previous => previous.filter(item => item.id !== view.id));
      setStatus("View deleted."); libraryRef.current?.focus();
      confirmed = true;
    } catch {
      if (mounted.current && operationEpoch === epoch.current) setActionError("Could not confirm deletion. Check the library before retrying manually.");
    } finally { if (mounted.current && operationEpoch === epoch.current) setBusy(false); }
    if (confirmed && mounted.current && operationEpoch === epoch.current) await refresh();
  }

  function applyView(view: SavedView) {
    restoreStorageSnapshot(view.payload.storage);
    if (view.payload.shellPreset) localStorage.setItem(WORKSPACE_PRESET_STORAGE_KEY, view.payload.shellPreset);
    if (view.payload.selectedTicker) setTicker(String(view.payload.selectedTicker).toUpperCase());
    try { localStorage.setItem(PENDING_SAVED_VIEW_KEY, JSON.stringify(view.payload)); } catch { /* Retain existing route restoration when storage is unavailable. */ }
    navigate(`${view.payload.page || view.page}${view.payload.search || ""}`);
    window.dispatchEvent(new CustomEvent("ot:saved-view:apply", { detail: view.payload }));
    window.setTimeout(() => window.location.reload(), 50);
  }

  const entries = (
    <div ref={libraryRef} tabIndex={-1} role="region" aria-label="Saved view library" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-terminal-muted">{library ? "All saved workflow scopes" : `${pageLabel} scope`} · {views.length} entries</p>
        <TerminalButton size="sm" onClick={() => void refresh()} disabled={loading || busy}>Refresh views</TerminalButton>
      </div>
      {loading ? <p role="status" className="text-sm text-terminal-muted">Loading saved views…</p> : null}
      {loadError ? <p role="alert" className="text-sm text-terminal-neg">{loadError}</p> : null}
      {actionError ? <p role="alert" className="text-sm text-terminal-neg">{actionError}</p> : null}
      {!loading && !loadError && !views.length ? <p className="text-sm text-terminal-muted">No saved views yet. Save a view from a workflow page to return to its setup.</p> : null}
      <div className={library ? "grid items-start gap-3 xl:grid-cols-2" : "space-y-3"}>
      {views.map(view => <article key={view.id} aria-label={view.name} className="min-w-0 space-y-3 rounded-sm border border-terminal-border bg-terminal-bg p-3 [overflow-wrap:anywhere]">
        <div className="min-w-0 space-y-1">
          <h2 className="text-sm font-semibold text-terminal-text">{view.name}</h2>
          {view.description ? <p className="whitespace-pre-wrap text-sm text-terminal-muted">{view.description}</p> : null}
          <p className="text-xs text-terminal-muted">Scope: {view.scope} · Page: {view.page}</p>
          <p className="text-xs text-terminal-muted">Updated <time dateTime={view.updated_at}>{new Date(view.updated_at).toLocaleString()}</time></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TerminalButton size="sm" variant="accent" disabled={busy} onClick={() => applyView(view)}>Apply</TerminalButton>
          <TerminalButton size="sm" disabled={busy} onClick={() => { setName(view.name); setFormError(""); setEditor({ kind: "rename", view, epoch: epoch.current }); }}>Rename</TerminalButton>
          <TerminalButton size="sm" variant="danger" disabled={busy} onClick={() => void removeView(view)}>Delete</TerminalButton>
        </div>
      </article>)}
      </div>
    </div>
  );

  return (
    <div className={library ? "min-w-0 space-y-3" : "relative flex min-w-0 flex-wrap items-center gap-2"}>
      <div className="flex flex-wrap gap-2">
        <TerminalButton size="sm" variant="accent" disabled={busy} onClick={beginSave}>Save view</TerminalButton>
        {!library ? <TerminalButton size="sm" disabled={busy} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>Saved views</TerminalButton> : null}
      </div>
      {status ? <p role="status" className="text-xs text-terminal-muted">{status}</p> : null}
      {library ? entries : <TerminalModal open={open} onClose={() => setOpen(false)} title={`${pageLabel} saved views`} subtitle="Restore an existing workspace setup." size="lg" busy={busy}>{entries}</TerminalModal>}
      <TerminalModal open={Boolean(editor)} onClose={() => setEditor(null)} title={editor?.kind === "rename" ? "Rename saved view" : "Save view"} size="md" busy={busy}
        subtitle={editor?.kind === "save" ? `Capturing ${editor.payload.page} · ${editor.scope}` : editor?.kind === "rename" ? `Renaming ${editor.view.name}` : undefined}
        footer={<div className="flex flex-wrap justify-end gap-2"><TerminalButton size="sm" onClick={() => setEditor(null)} disabled={busy}>Cancel</TerminalButton><TerminalButton form={formId} type="submit" size="sm" variant="accent" loading={busy}>{editor?.kind === "rename" ? "Save name" : "Save view"}</TerminalButton></div>}>
        <form id={formId} onSubmit={event => void saveName(event)} className="min-w-0 space-y-3">
          {formError ? <p role="alert" className="text-sm text-terminal-neg">{formError}</p> : null}
          <label className="block min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">View name</span><TerminalInput required value={name} onChange={event => setName(event.target.value)} className="!text-sm" /></label>
        </form>
      </TerminalModal>
    </div>
  );
}
