import { Suspense, useRef } from "react";

import { TerminalInput } from "../../components/terminal/TerminalInput";
import { TerminalButton } from "../../components/terminal/TerminalButton";
import { AiInsightCard } from "../../components/terminal/AiInsightCard";
import { SavedViewsControl } from "../../components/savedViews/SavedViewsControl";

import { fetchCollectionBriefing } from "../../api/client";

import { AlternateDataFilter } from "./screener/AlternateDataFilter";
import { AdvancedArithmetic } from "./screener/AdvancedArithmetic";
import { CompanyDetailDrawer } from "./screener/CompanyDetailDrawer";
import { CustomFormulaScreener } from "./screener/CustomFormulaScreener";
import { FilterChips } from "./screener/FilterChips";
import { PublicScreens } from "./screener/PublicScreens";
import { QueryBar } from "./screener/QueryBar";
import { QueryBuilder } from "./screener/QueryBuilder";
import { ResultsTable } from "./screener/ResultsTable";
import { SaveScreenDialog } from "./screener/SaveScreenDialog";
import { SavedScreens } from "./screener/SavedScreens";
import { ScreenLibrarySidebar } from "./screener/ScreenLibrarySidebar";
import { ScreenerProvider, useScreenerContext } from "./screener/ScreenerContext";
import { StatusBar } from "./screener/StatusBar";
import { ViewToggle } from "./screener/ViewToggle";
import { MultiMarketScanPanel } from "./screener/MultiMarketScanPanel";
import { lazyWithRetry } from "../../utils/lazyWithRetry";
import "./screener/screener.css";

const ScreenVizLoader = lazyWithRetry(() =>
  import("./screener/viz/ScreenVizLoader").then((module) => ({ default: module.ScreenVizLoader })),
);

function ScreenerWorkspace() {
  const resultsRef = useRef<HTMLElement>(null);
  const { error, loading, tab, setTab, result, view, query, universe,
    selectedPresetId, selectedRow, setSelectedRow } = useScreenerContext();

  return (
    <main aria-label="Screener research" className="screener-workspace min-w-0 space-y-3 p-3 md:p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Screener</h1>
          <p className="text-sm text-terminal-muted">Choose a screen, run a query and inspect its results.</p>
        </div>
        <SavedViewsControl pageLabel="Screener" capture={() => ({
          filters: { query, universe, selectedPresetId }, activeTabs: { tab, view },
          tableColumns: "results-default", selectedTicker: typeof selectedRow?.ticker === "string" ? selectedRow.ticker : undefined,
        })} />
      </header>
      <label className="flex items-center gap-3 sm:hidden"><span className="shrink-0 text-xs text-terminal-muted">Screen source</span><TerminalInput as="select" value={tab} onChange={event => setTab(event.target.value as typeof tab)}>{[["library", "Screens Library"], ["custom", "Custom Query"], ["formula", "Custom Formula"], ["saved", "Saved Screens"], ["public", "Public Screens"]].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</TerminalInput></label>
      <nav aria-label="Screen sources" className="hidden flex-wrap gap-2 sm:flex">
        {[["library", "Screens Library"], ["custom", "Custom Query"], ["formula", "Custom Formula"],
          ["saved", "Saved Screens"], ["public", "Public Screens"]].map(([id, label]) => (
          <TerminalButton key={id} aria-pressed={tab === id} variant={tab === id ? "accent" : "default"} onClick={() => setTab(id as typeof tab)}>{label}</TerminalButton>
        ))}
      </nav>
      <details className="screener-disclosure">
        <summary>Preset library · browse and run a screen</summary>
        <ScreenLibrarySidebar />
      </details>
      <QueryBar />
      {error ? <p role="alert" className="rounded-sm border border-terminal-neg p-3 text-sm text-terminal-neg">{error}{result ? " Previous results remain below; they were not refreshed." : ""}</p> : null}
      {loading ? <p role="status" className="text-sm text-terminal-muted">Running screener...</p> : null}
      {tab === "custom" ? (
        <section aria-label="Query construction" className="space-y-3">
          <QueryBuilder />
          <details className="screener-disclosure"><summary>Additional filters and arithmetic</summary>
            <div className="grid gap-3 xl:grid-cols-2"><AlternateDataFilter /><AdvancedArithmetic /></div>
          </details>
          <SaveScreenDialog />
        </section>
      ) : null}
      {tab === "formula" ? <CustomFormulaScreener /> : null}
      {tab === "saved" ? <SavedScreens /> : null}
      {tab === "public" ? <PublicScreens /> : null}
      <section ref={resultsRef} tabIndex={-1} aria-label="Screen results" className="min-w-0 space-y-3 scroll-mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ViewToggle />
          {selectedRow ? <a href="#screener-company-detail" className="text-sm text-terminal-accent underline" onClick={() => document.getElementById("screener-company-detail")?.focus()}>Inspect selected company</a> : null}
        </div>
        {view === "table" || view === "split" ? <ResultsTable /> : null}
        {view !== "table" ? <Suspense fallback={<p role="status" className="p-3 text-sm text-terminal-muted">Loading screen visualizations...</p>}>
          <ScreenVizLoader screenId={selectedPresetId} vizData={(result?.viz_data || {}) as Record<string, unknown>} />
        </Suspense> : null}
        <StatusBar />
      </section>
      <details className="screener-disclosure"><summary>Active query filters</summary><FilterChips /></details>
      {selectedRow ? <section id="screener-company-detail" tabIndex={-1} aria-label="Selected company" className="min-w-0 scroll-mt-4">
        <CompanyDetailDrawer onClose={() => { setSelectedRow(null); resultsRef.current?.focus(); }} />
      </section> : null}
      {tab !== "saved" && tab !== "public" && result && result.results.length > 0 ? (
        <AiInsightCard title="AI Screener Analysis" description={`On-demand assessment of the top ${Math.min(result.results.length, 10)} results in this screen`}
          fetcher={(_, options) => fetchCollectionBriefing(result.results.slice(0, 10).map((i: any) => String(i.ticker || i.symbol || "")), "screen results", undefined, options)} />
      ) : null}
      <details className="screener-disclosure"><summary>Multi-market scan · separate filters and results</summary><MultiMarketScanPanel /></details>
    </main>
  );
}

export function ScreenerPage() {
  return (
    <ScreenerProvider>
      <ScreenerWorkspace />
    </ScreenerProvider>
  );
}
