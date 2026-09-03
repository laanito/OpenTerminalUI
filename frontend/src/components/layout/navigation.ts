export type SurfaceState = "supported" | "configuration-gated" | "experimental";

export type TerminalNavItem = {
  label: string;
  path: string;
  key: string;
  hint?: string;
  state: SurfaceState;
};

/**
 * Primary product navigation. Every entry here must have a useful retained
 * contract in a normal installation, or clearly declare that it is gated or
 * experimental. See docs/wiki/Surface-Inventory.md.
 */
export const PRIMARY_NAV_ITEMS: readonly TerminalNavItem[] = [
  { label: "Market", path: "/equity/stocks", key: "F1", state: "supported" },
  { label: "Security Hub", path: "/equity/security", key: "SH", hint: "Research", state: "supported" },
  { label: "Economics", path: "/equity/economics", key: "E", hint: "Macro", state: "experimental" },
  { label: "Commodities", path: "/equity/commodities", key: "CMDTY", hint: "Macro", state: "configuration-gated" },
  { label: "Forex", path: "/equity/forex", key: "FX", hint: "Macro", state: "supported" },
  { label: "ETF Analytics", path: "/equity/etf-analytics", key: "ETFA", hint: "Funds", state: "experimental" },
  { label: "Yield Curve", path: "/equity/yield-curve", key: "YC", hint: "Fixed Income", state: "configuration-gated" },
  { label: "Rotation", path: "/equity/sector-rotation", key: "ROT", hint: "Relative", state: "supported" },
  { label: "Crypto", path: "/equity/crypto", key: "CR", hint: "Digital", state: "supported" },
  { label: "Compare", path: "/equity/compare", key: "CMP", hint: "Split View", state: "supported" },
  { label: "Screener", path: "/equity/screener", key: "F2", state: "supported" },
  { label: "Heatmap", path: "/equity/heatmap", key: "HM", hint: "Market", state: "supported" },
  { label: "Dividends", path: "/equity/dividends", key: "DIV", hint: "Income", state: "supported" },
  { label: "Launchpad", path: "/equity/launchpad", key: "LP", hint: "Workspace", state: "supported" },
  { label: "Workstation", path: "/equity/chart-workstation", key: "6", hint: "6 Charts", state: "supported" },
  { label: "MTA", path: "/equity/mta", key: "MT", hint: "Multi-TF", state: "supported" },
  { label: "DOM", path: "/equity/dom", key: "D", hint: "Depth", state: "configuration-gated" },
  { label: "Portfolio", path: "/equity/portfolio", key: "F3", state: "supported" },
  { label: "Portfolio Lab", path: "/equity/portfolio/lab", key: "PLB", hint: "Research", state: "experimental" },
  { label: "Paper", path: "/equity/paper", key: "P", state: "supported" },
  { label: "Position Sizer", path: "/equity/position-sizer", key: "PS", hint: "Trading", state: "supported" },
  { label: "Journal", path: "/equity/journal", key: "J", hint: "Trading", state: "supported" },
  { label: "Second Brain", path: "/equity/brain", key: "BR", hint: "AI Research", state: "supported" },
  { label: "Watchlist", path: "/equity/watchlist", key: "F4", state: "supported" },
  { label: "News", path: "/equity/news", key: "F5", state: "supported" },
  { label: "Alerts", path: "/equity/alerts", key: "A", state: "supported" },
  { label: "Risk", path: "/equity/risk", key: "R", state: "supported" },
  { label: "Correlation", path: "/equity/correlation", key: "CR", hint: "Risk", state: "supported" },
  { label: "Stat Lab", path: "/equity/stat-lab", key: "SL", hint: "Quant", state: "experimental" },
  { label: "Pair Trading", path: "/equity/pair-trading", key: "PT", hint: "Quant", state: "experimental" },
  { label: "Settings", path: "/equity/settings", key: "F6", state: "supported" },
  { label: "About", path: "/equity/stocks/about", key: "F7", state: "supported" },
  { label: "Model Lab", path: "/backtesting/model-lab", key: "ML", hint: "Backtest", state: "experimental" },
  { label: "Backtesting", path: "/backtesting", key: "F9", state: "supported" },
];

/**
 * Direct routes retained for bookmarks and API compatibility but intentionally
 * absent from primary navigation until their data contract becomes useful.
 */
export const HIDDEN_COMPATIBILITY_ROUTES = [
  { path: "/equity/bonds", reason: "Bond screening, spreads, and migrations have no live provider." },
  { path: "/equity/hotlists", reason: "Every hotlist is empty until a suitable screener feed is connected." },
  { path: "/equity/insider", reason: "The query layer exists, but no production insider filing ingestion is wired." },
  { path: "/equity/rs", reason: "All four Relative Strength endpoints intentionally return empty and degraded." },
  { path: "/equity/tape", reason: "No production recent-trades adapter is wired for the standalone tape." },
  { path: "/equity/cockpit", reason: "The legacy aggregator is not owner-scoped or connected to the real dashboard services." },
  { path: "/equity/plugins", reason: "Process-wide Python plugin lifecycle controls are restricted to local administrators." },
  { path: "/equity/oms", reason: "The internal quote-backed simulator is not a broker order-management system or Paper portfolio." },
  { path: "/equity/ops", reason: "The compatibility page is a measured system monitor; global controls are administrator-only." },
] as const;
