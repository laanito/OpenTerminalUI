import { useState } from "react";
import { api } from "../../api/client";
import { TerminalButton } from "../terminal/TerminalButton";

type CatalogItem = { name: string; bytes: number; updated_at: number };

export function DataManager() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  async function loadCatalog() {
    if (loading) return;
    setLoading(true); setError(false);
    try {
      const res = await api.get("/v1/backtest/data/catalog");
      setItems(Array.isArray(res.data.items) ? res.data.items : []); setLoaded(true);
    } catch { setError(true); }
    finally { setLoading(false); }
  }
  return <section aria-label="Backtest datasets" className="min-w-0 space-y-3 rounded border border-terminal-border bg-terminal-panel p-3 [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Backtest datasets</h2><TerminalButton size="sm" onClick={() => void loadCatalog()} loading={loading}>Refresh datasets</TerminalButton></div>
    {!loaded && !loading && !error ? <p className="text-sm text-terminal-muted">Refresh to inspect stored datasets.</p> : null}
    {loading ? <p role="status" className="text-sm text-terminal-muted">Loading datasets…</p> : null}
    {error ? <p role="alert" className="text-sm text-terminal-neg">Could not refresh datasets. Any previous files below have not been refreshed.</p> : null}
    {loaded && !loading && !error && !items.length ? <p className="text-sm text-terminal-muted">No stored datasets yet.</p> : null}
    {items.length ? <div role="region" aria-label="Stored dataset files" tabIndex={0} className="max-h-80 overflow-y-auto rounded focus-visible:outline focus-visible:outline-terminal-accent"><ul className="grid min-w-0 gap-3 lg:grid-cols-2">{items.map(item => <li key={item.name} className="min-w-0 space-y-1 rounded border border-terminal-border bg-terminal-bg p-3"><p className="break-all text-sm">{item.name}</p><p className="text-xs text-terminal-muted">{item.bytes.toLocaleString()} bytes</p></li>)}</ul></div> : null}
  </section>;
}
