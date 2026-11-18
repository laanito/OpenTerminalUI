import { useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { TerminalModal } from "../terminal/TerminalModal";
import { PRIMARY_NAV_ITEMS, type TerminalNavItem } from "./navigation";
import { useStockStore } from "../../store/stockStore";

const extraItems: TerminalNavItem[] = [
  { label: "Home", path: "/home", key: "", state: "supported" },
  { label: "Notes", path: "/equity/notes", key: "NOTES", state: "supported" },
  { label: "Saved views", path: "/equity/saved-views", key: "", state: "supported" },
  { label: "Account", path: "/account", key: "", state: "supported" },
];
const groups: Array<{ name: string; paths: string[] }> = [
  { name: "Home", paths: ["/home"] },
  { name: "Markets", paths: ["/equity/stocks", "/equity/security", "/equity/crypto", "/equity/news", "/equity/screener", "/equity/watchlist", "/equity/economics", "/equity/commodities", "/equity/forex", "/equity/etf-analytics", "/equity/yield-curve", "/equity/sector-rotation", "/equity/heatmap", "/equity/dividends", "/equity/dom"] },
  { name: "Portfolio", paths: ["/equity/portfolio", "/equity/paper", "/equity/risk", "/equity/position-sizer"] },
  { name: "Research", paths: ["/equity/brain", "/equity/notes", "/equity/journal"] },
  { name: "Workspace", paths: ["/equity/launchpad", "/equity/chart-workstation", "/equity/compare", "/equity/mta", "/equity/saved-views", "/equity/correlation", "/equity/stat-lab", "/equity/pair-trading", "/backtesting"] },
  { name: "Settings", paths: ["/equity/alerts", "/equity/settings", "/account", "/equity/stocks/about"] },
];

/** Existing supported/gated destinations only. Unclassified additions stay visible. */
export function shellNavigationGroups() {
  const items = [...extraItems, ...PRIMARY_NAV_ITEMS];
  const assigned = new Set(groups.flatMap(group => group.paths));
  return [...groups.map(group => ({ name: group.name, items: group.paths.flatMap(path => items.filter(item => item.path === path)) })),
    { name: "More tools", items: items.filter(item => !assigned.has(item.path)) }].filter(group => group.items.length);
}

export function ShellNavigation({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();
  const ticker = useStockStore(s => s.ticker) || "SPY";
  useEffect(() => { onClose(); }, [location.key, onClose]);
  return <TerminalModal open={open} onClose={onClose} title="Navigate" subtitle="Existing tools, grouped by task. GO commands and bookmarks still work." size="lg">
    <nav aria-label="All terminal destinations" className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {shellNavigationGroups().map(group => <section key={group.name} className="min-w-0">
        <h2 className="mb-2 text-sm font-semibold text-terminal-accent">{group.name}</h2>
        <ul className="space-y-1">{group.items.map(item => <li key={item.path}>
          <NavLink to={item.path} onClick={onClose} className={({ isActive }) => `block rounded border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-terminal-accent ${isActive ? "border-terminal-accent text-terminal-accent" : "border-transparent text-terminal-text hover:border-terminal-border"}`}>
            {item.path === "/equity/compare" ? "Chart compare" : item.label}
            {item.configuration ? <span className="mt-1 block break-words text-xs text-terminal-muted">{item.configuration.label} · {item.configuration.detail}</span> : null}
          </NavLink>
        </li>)}</ul>
      </section>)}
      <section><h2 className="mb-2 text-sm font-semibold text-terminal-accent">Derivatives</h2>
        <p className="mb-2 text-xs text-terminal-muted">Existing F&amp;O workspace; market/provider configuration applies.</p>
        <NavLink className="block px-3 py-2 text-sm text-terminal-text" to={`/fno?symbol=${encodeURIComponent(ticker)}`} onClick={onClose}>F&amp;O</NavLink>
        <NavLink className="block px-3 py-2 text-sm text-terminal-text" to={`/fno/heatmap?symbol=${encodeURIComponent(ticker)}`} onClick={onClose}>F&amp;O heatmap</NavLink>
      </section>
    </nav>
  </TerminalModal>;
}
