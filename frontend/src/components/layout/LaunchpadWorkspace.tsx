import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { setGroupSymbol, subscribeSymbolLinkMessages, type LinkGroup } from "../../contexts/SymbolLinkContext";
import { PanelBody, PanelFrame, PanelHeader } from "./PanelChrome";
import { type LaunchpadPanelConfig, type LaunchpadPanelType, useLaunchpad } from "./LaunchpadContext";
import { LaunchpadGrid } from "./LaunchpadGrid";
import { TerminalButton, TerminalInput, TerminalModal } from "../terminal";
import { useStockStore } from "../../store/stockStore";

const PANEL_TYPES: LaunchpadPanelType[] = [
  "chart",
  "watchlist",
  "news-feed",
  "order-book",
  "ticker-detail",
  "screener-results",
  "alerts",
  "portfolio-summary",
  "heatmap",
  "market-pulse",
  "yield-curve",
  "ai-research",
  "option-chain",
  "watchlist-heatmap",
  "sector-rotation",
  "hotkeys",
];

function resolvePanelLinkGroup(panel: { linkGroup?: LinkGroup; linked?: boolean }): LinkGroup {
  if (
    panel.linkGroup === "none" ||
    panel.linkGroup === "red" ||
    panel.linkGroup === "blue" ||
    panel.linkGroup === "green" ||
    panel.linkGroup === "yellow"
  ) {
    return panel.linkGroup;
  }
  return panel.linked === false ? "none" : "red";
}

function VisibilityMount({
  panelId,
  focused,
  children,
}: {
  panelId: string;
  focused: boolean;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setVisible(Boolean(entry?.isIntersecting));
      },
      { root: null, threshold: 0.01, rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [panelId]);

  return (
    <div ref={hostRef} className="min-h-0 flex-1 overflow-auto">
      {visible || focused ? children : <PanelBody>Panel paused while out of view.</PanelBody>}
    </div>
  );
}

export function LaunchpadWorkspace({ toolbarActions }: { toolbarActions?: ReactNode }) {
  const { activeLayout, activeLayoutId, savedLayouts, setActiveLayoutId, createLayout, renameLayout, deleteLayout, addPanel, closePanel, updatePanel, updatePanelsLayout, setPanelPoppedOut, panelRegistry, emitSymbolChange, lastBroadcastSymbol, symbolEventVersion, loadingLayouts } = useLaunchpad();
  const globalTicker = useStockStore(state => state.ticker);
  const setTicker = useStockStore(state => state.setTicker);
  const loadTicker = useStockStore(state => state.load);
  const [layoutNameDraft, setLayoutNameDraft] = useState("");
  const [panelTypeOpen, setPanelTypeOpen] = useState(false);
  const [focusedPanelId, setFocusedPanelId] = useState<string | null>(null);
  const [panelSearch, setPanelSearch] = useState("");
  const [editingPanel, setEditingPanel] = useState<LaunchpadPanelConfig | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [symbolDraft, setSymbolDraft] = useState("");
  const [groupDraft, setGroupDraft] = useState<LinkGroup>("none");
  const [notice, setNotice] = useState("");
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const panels = activeLayout?.panels ?? [];
  const filteredTypes = useMemo(() => PANEL_TYPES.filter(type => type.replace(/-/g, " ").includes(panelSearch.toLowerCase().trim().replace(/-/g, " "))), [panelSearch]);
  useEffect(() => { setLayoutNameDraft(activeLayout?.name || ""); }, [activeLayout?.id, activeLayout?.name]);
  useEffect(() => { if (notice && !panelTypeOpen && !editingPanel) noticeRef.current?.focus(); }, [notice, panelTypeOpen, editingPanel]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || panelTypeOpen || editingPanel) return;
      if (/^[1-9]$/.test(event.key)) {
        const panel = panels[Number(event.key) - 1]; if (!panel) return;
        event.preventDefault(); setFocusedPanelId(panel.id);
        document.querySelector<HTMLElement>(`[data-launchpad-panel-id="${CSS.escape(panel.id)}"]`)?.focus();
      }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [panels, panelTypeOpen, editingPanel]);
  useEffect(() => subscribeSymbolLinkMessages(message => {
    if (message.type === "panel-return" && message.panelId) setPanelPoppedOut(message.panelId, false);
    if (message.type === "symbol-change" && message.linkGroup !== "none" && message.symbol) emitSymbolChange(message.symbol, undefined, message.linkGroup);
  }), [emitSymbolChange, setPanelPoppedOut]);

  function editPanel(panel: LaunchpadPanelConfig) {
    setTitleDraft(panel.title); setSymbolDraft(panel.symbol || ""); setGroupDraft(resolvePanelLinkGroup(panel)); setEditingPanel(panel); setNotice("");
  }
  function savePanel() {
    if (!editingPanel || !titleDraft.trim()) return;
    const current = panels.find(panel => panel.id === editingPanel.id);
    if (!current) { setEditingPanel(null); setNotice("This panel is no longer in the selected layout."); return; }
    const symbol = symbolDraft.trim().toUpperCase();
    updatePanel(current.id, { title: titleDraft.trim(), symbol, linkGroup: groupDraft, linked: groupDraft !== "none" });
    if (symbol && (symbol !== current.symbol || groupDraft !== resolvePanelLinkGroup(current))) {
      setTicker(symbol); void loadTicker();
      if (groupDraft !== "none") { setGroupSymbol(groupDraft, symbol, current.id); emitSymbolChange(symbol, current.id, groupDraft); }
    }
    setEditingPanel(null); setNotice("Panel settings updated in this workspace.");
  }
  if (!activeLayout) return <p role="status" className="p-3 text-sm text-terminal-muted">No Launchpad layout loaded.</p>;

  return <main aria-label="Launchpad workspace" className="min-h-full min-w-0 space-y-3 p-3 [overflow-wrap:anywhere] md:p-4">
    <header className="shrink-0 space-y-3">
      <div><h1 className="text-lg font-semibold">Launchpad</h1><p className="text-sm text-terminal-muted">{activeLayout.name}</p></div>
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-64 space-y-1"><span className="block text-xs text-terminal-muted">Layout</span><TerminalInput as="select" aria-label="Launchpad layout" className="!text-sm" value={activeLayoutId} onChange={event => { setActiveLayoutId(event.target.value); setNotice(""); }}>{savedLayouts.map(layout => <option key={layout.id} value={layout.id}>{layout.name}</option>)}</TerminalInput></label>
        <div className="flex max-w-full flex-wrap gap-2">{toolbarActions}<TerminalButton size="sm" onClick={() => { setPanelSearch(""); setPanelTypeOpen(true); setNotice(""); }}>Add panel</TerminalButton><TerminalButton size="sm" onClick={createLayout}>New layout</TerminalButton></div>
      </div>
      <details className="rounded border border-terminal-border bg-terminal-panel p-3"><summary className="cursor-pointer text-sm">Layout controls and linking</summary><div className="mt-3 space-y-3">
        <form aria-label="Rename layout" className="flex min-w-0 flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (layoutNameDraft.trim()) { renameLayout(activeLayout.id, layoutNameDraft.trim()); setNotice("Layout renamed in this workspace."); } }}><label className="min-w-0 flex-1 basis-64 space-y-1"><span className="block text-xs text-terminal-muted">Layout name</span><TerminalInput required className="!text-sm" value={layoutNameDraft} onChange={event => setLayoutNameDraft(event.target.value)} /></label><TerminalButton type="submit" size="sm">Rename layout</TerminalButton><TerminalButton type="button" size="sm" variant="danger" onClick={() => { deleteLayout(activeLayout.id); setNotice("Layout removed. Removing the last layout restores the defaults."); }}>Delete layout</TerminalButton></form>
        <p className="text-xs text-terminal-muted">Drag panel handles and resize on wide workspaces. Narrow screens stack panels without changing the saved grid. Ctrl/Cmd + 1–9 focuses a panel.</p>
        <p className="text-xs text-terminal-muted">Linked symbol: <span className="text-terminal-text">{lastBroadcastSymbol || globalTicker || "None"}</span> · event {symbolEventVersion}. Panels share symbols within their colour group.</p>
      </div></details>
      {loadingLayouts ? <p role="status" className="text-xs text-terminal-muted">Syncing layout list…</p> : null}
      {notice ? <p ref={noticeRef} role="status" tabIndex={-1} className="text-sm text-terminal-muted">{notice}</p> : null}
    </header>
    <div role="region" aria-label="Launchpad panels" tabIndex={0} className="min-w-0 rounded border border-terminal-border bg-terminal-bg p-2">
      {!panels.length ? <p className="p-3 text-sm text-terminal-muted">This layout has no panels. Add a panel or apply a template.</p> : null}
      <LaunchpadGrid panels={panels} onLayoutChange={updatePanelsLayout} renderPanel={panel => {
        const PanelView = panelRegistry[panel.type]; const group = resolvePanelLinkGroup(panel);
        return <PanelFrame className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden ${focusedPanelId === panel.id ? "ring-1 ring-terminal-accent/70" : ""}`} tabIndex={0} onFocus={() => setFocusedPanelId(panel.id)} aria-label={panel.title} data-launchpad-panel-id={panel.id} data-launchpad-panel-type={panel.type} data-launchpad-panel-title={panel.title} data-launchpad-panel-symbol={panel.symbol || ""} data-testid="launchpad-panel-frame">
          <PanelHeader title={<span className="block min-w-0 whitespace-normal text-sm">{panel.title}</span>} subtitle={<span className="block text-xs">{panel.type.replace(/-/g, " ")}{panel.symbol ? ` · ${panel.symbol}` : ""}</span>}
            toolbar={<div className="flex flex-wrap items-center gap-2 py-1"><button type="button" className="launchpad-drag-handle inline-flex min-h-8 items-center gap-1 rounded border border-terminal-border px-2 text-xs text-terminal-muted" aria-label={`Drag ${panel.title}`}><GripVertical size={14} />Move</button><TerminalButton size="sm" onClick={() => editPanel(panel)}>Panel settings</TerminalButton><TerminalButton size="sm" variant="danger" onClick={() => { closePanel(panel.id); setNotice(`Closed ${panel.title}.`); }}>Close panel</TerminalButton></div>}
            linkGroup={group} onLinkGroupChange={next => { updatePanel(panel.id, { linkGroup: next, linked: next !== "none" }); if (next !== "none" && panel.symbol) { setGroupSymbol(next, panel.symbol, panel.id); emitSymbolChange(panel.symbol, panel.id, next); } }} onPopout={() => setPanelPoppedOut(panel.id, true)} />
          {panel.poppedOut ? <PanelBody className="space-y-3 text-sm"><p>Panel in external window. Close it or recall it here.</p><TerminalButton size="sm" onClick={() => setPanelPoppedOut(panel.id, false)}>Recall Panel</TerminalButton></PanelBody> : <Suspense fallback={<PanelBody>Loading panel…</PanelBody>}><VisibilityMount panelId={panel.id} focused={focusedPanelId === panel.id}><PanelView panel={panel} /></VisibilityMount></Suspense>}
        </PanelFrame>;
      }} />
    </div>
    <TerminalModal open={panelTypeOpen} onClose={() => setPanelTypeOpen(false)} title="Add Launchpad panel" subtitle="Choose a panel for the selected layout." size="lg">
      <label className="block space-y-1"><span className="block text-xs text-terminal-muted">Find a panel</span><TerminalInput className="!text-sm" value={panelSearch} onChange={event => setPanelSearch(event.target.value)} placeholder="Chart, news, portfolio…" /></label>
      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">{filteredTypes.map(type => <TerminalButton key={type} className="justify-start whitespace-normal text-left !text-sm" onClick={() => { addPanel(type); setPanelTypeOpen(false); setNotice(`Added ${type.replace(/-/g, " ")} panel.`); }}>{type.replace(/-/g, " ")}</TerminalButton>)}</div>
      {!filteredTypes.length ? <p className="mt-3 text-sm text-terminal-muted">No matching panels.</p> : null}
    </TerminalModal>
    <TerminalModal open={Boolean(editingPanel)} onClose={() => setEditingPanel(null)} title="Panel settings" subtitle={editingPanel?.title} size="md" footer={<TerminalButton variant="accent" type="submit" form="launchpad-panel-settings">Save panel settings</TerminalButton>}>
      <form id="launchpad-panel-settings" aria-label="Panel settings" className="min-w-0 space-y-3 [&_input]:!text-sm [&_select]:!text-sm" onSubmit={event => { event.preventDefault(); savePanel(); }}>
        <label className="block space-y-1"><span className="block text-xs text-terminal-muted">Panel title</span><TerminalInput required value={titleDraft} onChange={event => setTitleDraft(event.target.value)} /></label>
        <label className="block space-y-1"><span className="block text-xs text-terminal-muted">Panel symbol</span><TerminalInput value={symbolDraft} onChange={event => setSymbolDraft(event.target.value)} placeholder="Optional symbol" /></label>
        <label className="block space-y-1"><span className="block text-xs text-terminal-muted">Symbol link group</span><TerminalInput as="select" value={groupDraft} onChange={event => setGroupDraft(event.target.value as LinkGroup)}>{["none", "red", "blue", "green", "yellow"].map(group => <option key={group}>{group}</option>)}</TerminalInput></label>
      </form>
    </TerminalModal>
  </main>;
}
