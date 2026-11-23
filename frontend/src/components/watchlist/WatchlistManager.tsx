import { useState, useEffect, useMemo, useRef } from "react";
import { MoreHorizontal, Trash2, StickyNote } from "lucide-react";
import { NotesPanel } from "../notes/NotesPanel";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  fetchWatchlists, createWatchlist, deleteWatchlist,
  addWatchlistSymbols, removeWatchlistSymbol, searchSymbols
} from "../../api/client";
import { HeatmapView } from "./HeatmapView";
import { useQuoteTokens, useQuotesStore } from "../../realtime/useQuotesStream";
import { useSettingsStore } from "../../store/settingsStore";
import { ExportButton } from "../common/ExportButton";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalCombobox } from "../terminal/TerminalCombobox";
import type { Watchlist } from "../../types";
import { quoteToken, watchlistQuoteRoute } from "../../lib/watchlistQuotes";
import { SymbolContextMenu } from "../common/SymbolContextMenu";

const PULL_THRESHOLD = 30;
const RELEASE_THRESHOLD = 70;

export function WatchlistManager() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedMarket = useSettingsStore(s => s.selectedMarket);
  const ticksByToken = useQuotesStore(s => s.ticksByToken);

  const [activeWlId, setActiveWlId] = useState<string | null>(null);
  const [viewMode, setViewByMode] = useState<"table" | "heatmap">("table");
  const [isCreating, setIsCreating] = useState(false);
  const [newWlName, setNewWlName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isTickerSearchOpen, setIsTickerSearchOpen] = useState(false);
  const [tickerResults, setTickerResults] = useState<any[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ symbol: string; x: number; y: number } | null>(null);
  const notesRef = useRef<HTMLElement>(null);
  const notesButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const [searchError, setSearchError] = useState("");
  const [notesFor, setNotesFor] = useState<string | null>(null);

  useEffect(() => { if (notesFor) notesRef.current?.focus(); }, [notesFor]);

  // Pull-to-refresh state
  const [pullY, setPullY] = useState(0);
  const pullStartY = useRef(0);
  const isPulling = useRef(false);
  const pullYRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Data fetching
  const { data: watchlists, isLoading: loadingWl, isError: failedWatchlists, refetch } = useQuery({
    queryKey: ["watchlists"],
    queryFn: fetchWatchlists
  });

  const activeWl = useMemo(() => {
    const nameParam = searchParams.get("name");
    const safeWatchlists = Array.isArray(watchlists) ? watchlists : [];
    if (nameParam && safeWatchlists.length > 0) {
      const found = safeWatchlists.find(w => w.name.toLowerCase() === nameParam.toLowerCase());
      if (found) return found;
    }
    return safeWatchlists.find(w => w.id === activeWlId) || safeWatchlists[0];
  }, [watchlists, activeWlId, searchParams]);

  useEffect(() => {
    if (activeWl && activeWlId !== activeWl.id) setActiveWlId(activeWl.id);
  }, [activeWl, activeWlId]);

  const routes = useMemo(() => new Map((activeWl?.symbols || []).map(symbol => [symbol, watchlistQuoteRoute(activeWl, symbol)])), [activeWl]);
  const tokens = [...routes.values()].map(quoteToken).filter((token): token is string => Boolean(token));
  const { connectionState } = useQuoteTokens(tokens);
  const quoteMarkets = [...new Set([...routes.values()].map(route => route.market).filter(Boolean))].join(" / ");
  const unresolved = [...routes.values()].filter(route => route.status !== "resolved");
  const tickFor = (symbol: string) => { const route = routes.get(symbol); const token = route && quoteToken(route); return token ? ticksByToken[token] : undefined; };

  function chooseList(id: string) {
    const next = new URLSearchParams(searchParams); next.delete("name");
    setSearchParams(next, { replace: true }); setActiveWlId(id); setNotesFor(null);
    setSearchQuery(""); setTickerResults([]); setIsTickerSearchOpen(false);
  }

  // Mutations
  const createMut = useMutation({
    mutationFn: createWatchlist,
    onSuccess: (data) => {
      queryClient.setQueryData<Watchlist[]>(["watchlists"], current => [...(current || []).filter(list => list.id !== data.id), { ...data, symbols: data.symbols || [] }]);
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      chooseList(data.id);
      setIsCreating(false);
      setNewWlName("");
    }
  });

  const deleteMut = useMutation({
    mutationFn: deleteWatchlist,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlists"] })
  });

  const addSymbolMut = useMutation({
    mutationFn: ({ id, symbols }: { id: string, symbols: string[] }) => addWatchlistSymbols(id, symbols),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      setSearchQuery(""); setIsTickerSearchOpen(false);
    }
  });

  function selectSymbol(ticker: string) {
    if (activeWl && !addSymbolMut.isPending) addSymbolMut.mutate({ id: activeWl.id, symbols: [ticker] });
  }

  const removeSymbolMut = useMutation({
    mutationFn: ({ id, symbol }: { id: string, symbol: string }) => removeWatchlistSymbol(id, symbol),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlists"] })
  });

  const closeContextMenu = () => setContextMenu(null);

  // Ignore results from a previous search/market without replaying writes.
  useEffect(() => {
    let cancelled = false;
    setSearchError(""); setTickerResults([]); setSearchIndex(0); setIsSearching(false);
    if (!searchQuery.trim()) return;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchSymbols(searchQuery, selectedMarket);
        if (!cancelled) setTickerResults(results.slice(0, 10));
      } catch {
        if (!cancelled) setSearchError("Symbol search unavailable. Try another search.");
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchQuery, selectedMarket]);

  // Attach native touch listeners so custom Events dispatched via dispatchEvent() are handled
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onStart = (e: Event) => {
      const te = e as any;
      pullStartY.current = te.touches?.[0]?.clientY ?? 0;
      isPulling.current = true;
    };

    const onMove = (e: Event) => {
      if (!isPulling.current) return;
      const te = e as any;
      const delta = (te.touches?.[0]?.clientY ?? 0) - pullStartY.current;
      if (delta > 0) {
        pullYRef.current = delta;
        setPullY(delta);
      }
    };

    const onEnd = () => {
      if (pullYRef.current >= RELEASE_THRESHOLD) {
        queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      }
      pullYRef.current = 0;
      setPullY(0);
      isPulling.current = false;
    };

    el.addEventListener("touchstart", onStart);
    el.addEventListener("touchmove", onMove);
    el.addEventListener("touchend", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
  }, [queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  const heatmapData = activeWl?.symbols.filter(s => Number.isFinite(tickFor(s)?.change_pct)).map(s => {
    const live = tickFor(s);
    return {
      ticker: s,
      changePct: live?.change_pct || 0,
      value: 100, // Default to equal weight for now, can be extended to fetch market cap
      price: live?.ltp || 0
    };
  }) || [];

  const writeError = [createMut, deleteMut, addSymbolMut, removeSymbolMut].find(mutation => mutation.isError)?.error;
  const createList = () => { if (newWlName.trim() && !createMut.isPending) createMut.mutate(newWlName.trim()); };

  return (
    <main aria-label="Watchlist research" className="watchlist-workspace min-w-0 space-y-3 p-3 md:p-4">
      <header>
        <h1 className="text-lg font-semibold">Watchlists</h1>
        <p className="text-sm text-terminal-muted">Monitor a list, inspect a symbol and keep its research nearby.</p>
      </header>
      {failedWatchlists ? <div role="alert" className="space-y-2 text-sm text-terminal-neg">
        Could not refresh watchlists.{watchlists ? " Previous lists remain visible." : ""}
        <TerminalButton onClick={() => void refetch()}>Retry loading lists</TerminalButton>
      </div> : null}
      {writeError ? <p role="alert" className="text-sm text-terminal-neg">{createMut.isError ? "Could not create the watchlist. Your name draft is retained; correct it and retry manually." : "Could not update this watchlist. Check the list before retrying manually."}</p> : null}
      <section aria-label="Watchlist scope" className="space-y-3 rounded-sm border border-terminal-border bg-terminal-panel p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 space-y-1"><span className="block text-xs text-terminal-muted">Selected watchlist</span>
            <TerminalInput as="select" value={activeWl?.id || ""} onChange={event => chooseList(event.target.value)} disabled={!watchlists?.length}>
              {!watchlists?.length ? <option value="">No watchlists available</option> : null}
              {watchlists?.map(wl => <option key={wl.id} value={wl.id}>{wl.name}</option>)}
            </TerminalInput>
          </label>
          <TerminalButton onClick={() => setIsCreating(open => !open)} aria-expanded={isCreating}>Create watchlist</TerminalButton>
        </div>
        {activeWl ? <div className="flex flex-wrap items-center gap-2 text-xs text-terminal-muted">
          <span className="break-words">{activeWl.name}</span><span>{activeWl.symbols.length} symbols</span>
          <span data-testid="watchlist-route-status">{quoteMarkets || "No resolved quote routes"} · {connectionState}</span>
        </div> : null}
        {isCreating ? <form aria-label="Create watchlist" className="space-y-2" onSubmit={event => { event.preventDefault(); createList(); }}>
          <label className="block space-y-1"><span className="block text-xs text-terminal-muted">Watchlist name</span>
            <TerminalInput required autoFocus value={newWlName} onChange={event => setNewWlName(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2"><TerminalButton type="submit" variant="accent" loading={createMut.isPending}>Save watchlist</TerminalButton>
            <TerminalButton type="button" onClick={() => setIsCreating(false)}>Cancel</TerminalButton></div>
        </form> : null}
        <details><summary className="cursor-pointer text-sm">Manage lists · names and deletion</summary>
          <ul className="mt-2 space-y-2">{watchlists?.map(wl => <li key={wl.id} className="flex items-start justify-between gap-2 rounded border border-terminal-border p-2">
            <button className="min-w-0 break-words text-left text-sm" aria-pressed={activeWl?.id === wl.id} onClick={() => chooseList(wl.id)}>{wl.name} · {wl.symbols.length} symbols</button>
            <button className="shrink-0 text-xs text-terminal-neg" aria-label={`Delete watchlist ${wl.name}`} disabled={deleteMut.isPending} onClick={() => { if (confirm('Delete?')) deleteMut.mutate(wl.id); }}>Delete</button>
          </li>)}</ul>
        </details>
      </section>
      {activeWl ? <section aria-label="Watchlist tools" className="space-y-3">
        <div ref={searchRef} className="min-w-0 space-y-1">
          <div className="text-xs text-terminal-muted">Find a symbol to add · {selectedMarket}</div>
          <TerminalCombobox aria-label="Find a symbol to add" placeholder="Search ticker..." value={searchQuery} items={tickerResults} loading={isSearching} open={isTickerSearchOpen} selectedIndex={searchIndex}
            onFocus={() => setIsTickerSearchOpen(true)} onBlur={() => setTimeout(() => setIsTickerSearchOpen(false), 200)} onChange={v => { setSearchQuery(v); setIsTickerSearchOpen(true); }}
            onKeyDown={event => {
              if (event.key === "Escape") setIsTickerSearchOpen(false);
              if (!isTickerSearchOpen) return;
              if (event.key === "ArrowDown") { event.preventDefault(); setSearchIndex(index => Math.min(index + 1, tickerResults.length - 1)); }
              if (event.key === "ArrowUp") { event.preventDefault(); setSearchIndex(index => Math.max(index - 1, 0)); }
              if (event.key === "Enter" && tickerResults[searchIndex]) { event.preventDefault(); selectSymbol(tickerResults[searchIndex].ticker); }
            }}
            getItemKey={item => item.ticker} onSelect={item => selectSymbol(item.ticker)}
            renderItem={item => <div className="space-y-1 px-2 py-2 text-sm"><span className="font-semibold">{item.ticker}</span><span className="ml-2 break-words text-terminal-muted">{item.name}</span></div>} />
          {searchError ? <p role="alert" className="text-xs text-terminal-neg">{searchError}</p> : null}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="space-y-1"><span className="block text-xs text-terminal-muted">Watchlist view</span><TerminalInput as="select" value={viewMode} onChange={event => setViewByMode(event.target.value as typeof viewMode)}><option value="table">Table</option><option value="heatmap">Heatmap</option></TerminalInput></label>
          <div className="flex flex-wrap items-center gap-2"><ExportButton source="watchlist" data={activeWl.symbols.map(s => { const live = tickFor(s); return { symbol: s, market: routes.get(s)?.market, currency: live?.currency || routes.get(s)?.currency, price: live?.ltp, change_pct: live?.change_pct, volume: live?.volume }; })} filename={`${activeWl.name}_watchlist.csv`} />
            <TerminalButton size="sm" variant="accent" onClick={() => { setIsTickerSearchOpen(true); searchRef.current?.querySelector("input")?.focus(); }}>Add to Watchlist</TerminalButton>
          </div>
        </div>
      </section> : null}
        {unresolved.length ? <p role="status" className="text-sm text-terminal-warn">Choose an explicit exchange or ticker suffix for: {unresolved.map(route => route.symbol).join(", ")}. Quotes are withheld for ambiguous or unsupported listings.</p> : null}
        {/* Touch refresh stays on the content container; the page owns scrolling. */}
        <div className="min-w-0">
          {pullY > PULL_THRESHOLD && (
            <div className="border-b border-terminal-border py-2 text-center text-xs text-terminal-muted">
              {pullY >= RELEASE_THRESHOLD ? "Release to refresh" : "Pull to refresh"}
            </div>
          )}
          <div
            ref={containerRef}
            data-testid="watchlist-content"
            className="min-w-0 space-y-3"
          >
            {loadingWl ? (
              <p className="animate-pulse text-center text-xs text-terminal-muted">SYNCHRONIZING WATCHLISTS...</p>
            ) : activeWl ? (
              viewMode === "table" ? (
                <div role="region" aria-label="Watchlist quotes" tabIndex={0} className="overflow-x-auto rounded border border-terminal-border">
                  {!activeWl.symbols.length ? <p className="p-3 text-sm text-terminal-muted">This watchlist has no symbols. Search above to add one.</p> : null}
                  <table className="w-full min-w-[760px] text-left text-sm font-mono">
                    <thead className="bg-terminal-panel text-terminal-muted border-b border-terminal-border">
                      <tr>
                        <th className="px-3 py-2">SYMBOL</th>
                        <th className="px-3 py-2">Currency</th>
                        <th className="px-3 py-2 text-right">Last price</th>
                        <th className="px-3 py-2 text-right">Change %</th>
                        <th className="px-3 py-2 text-right">Volume</th>
                        <th className="px-3 py-2 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-terminal-border/30">
                      {activeWl.symbols.map(s => {
                        const live = tickFor(s);
                        const changePct = live?.change_pct;
                        return (

                          <tr key={s}
                            className="cursor-pointer hover:bg-terminal-accent/5 focus-within:bg-terminal-accent/5"
                            tabIndex={0}
                            onClick={() => navigate(`/equity/stocks?ticker=${s}`)}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                navigate(`/equity/stocks?ticker=${s}`);
                              }
                              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                                event.preventDefault();
                                const rect = event.currentTarget.getBoundingClientRect();
                                setContextMenu({ symbol: s, x: rect.left + Math.min(rect.width / 2, 220), y: rect.bottom + 4 });
                              }
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setContextMenu({ symbol: s, x: event.clientX, y: event.clientY });
                            }}
                          >
                            <td className="px-3 py-2 font-bold text-terminal-accent">{s}</td>
                            <td className="px-3 py-2 text-terminal-muted">{live?.currency || routes.get(s)?.currency || "Unknown"}</td>
                            <td className="px-3 py-2 text-right text-terminal-text">{live?.ltp?.toFixed(2) || '--'}</td>
                            <td className={`px-3 py-2 text-right ${changePct == null ? 'text-terminal-muted' : changePct >= 0 ? 'text-terminal-pos' : 'text-terminal-neg'}`}>
                              {Number.isFinite(changePct) ? `${changePct! >= 0 ? "+" : ""}${changePct!.toFixed(2)}%` : "--"}
                            </td>
                            <td className="px-3 py-2 text-right text-terminal-muted">{live?.volume != null ? live.volume.toLocaleString() : '--'}</td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); notesButtonRef.current = e.currentTarget; setNotesFor(notesFor === s ? null : s); }}
                                className={`mr-2 ${notesFor === s ? "text-terminal-accent" : "text-terminal-muted hover:text-terminal-accent"}`}
                                aria-expanded={notesFor === s} aria-label={`Notes for ${s}`}
                              >
                                <StickyNote className="inline" size={14} /> Notes
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setContextMenu({ symbol: s, x: rect.left, y: rect.bottom + 4 });
                                }}
                                className="mr-2 text-terminal-muted hover:text-terminal-accent"
                                aria-label={`Open context menu for ${s}`}
                              >
                                <MoreHorizontal className="inline" size={14} /> Actions
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); removeSymbolMut.mutate({ id: activeWl.id, symbol: s }); }}
                                className="text-terminal-muted hover:text-terminal-neg"
                                aria-label={`Remove ${s} from watchlist`}
                              >
                                <Trash2 className="inline" size={14} /> Remove
                              </button>
                            </td>
                          </tr>

                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="min-w-0 space-y-2 rounded border border-terminal-border bg-terminal-panel/30 p-2">
                  <p className="text-xs text-terminal-muted">{heatmapData.length} / {activeWl.symbols.length} symbols with received quotes. Equal tile weights; unquoted symbols are omitted.</p>
                  {!heatmapData.length ? <p role="status" className="text-sm text-terminal-muted">No live quotes received for this list yet.</p> : null}
                  <HeatmapView
                    data={heatmapData}
                    width={800}
                    height={500}
                    responsive
                    sizeBy="equal"
                  />
                </div>
              )
            ) : (
              <p className="text-sm text-terminal-muted">
                Select or create a watchlist to begin.
              </p>
            )}
          </div>
        </div>
      {notesFor && activeWl?.symbols.includes(notesFor) ? <section ref={notesRef} tabIndex={-1} aria-label={`Research notes for ${notesFor}`} className="min-w-0 space-y-2"><TerminalButton onClick={() => { setNotesFor(null); notesButtonRef.current?.focus(); }}>Close research notes</TerminalButton><NotesPanel symbol={notesFor} context="watchlist" /></section> : null}

      {contextMenu && activeWl ? (
        <SymbolContextMenu
          open={Boolean(contextMenu)}
          symbol={contextMenu.symbol}
          anchor={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={closeContextMenu}
          market={routes.get(contextMenu.symbol)?.market || "NASDAQ"}
          customActions={[
            {
              id: "watchlist-remove-symbol",
              label: "Remove from Watchlist",
              danger: true,
              onAction: async (symbol) => {
                await removeSymbolMut.mutateAsync({ id: activeWl.id, symbol });
              },
            },
          ]}
        />
      ) : null}
    </main>
  );
}
