export const APP_NAME = "OpenTerminalUI";
// Version is sourced from package.json at build time via Vite's `__APP_VERSION__`
// global (see vite.config.ts) — the single frontend source of truth. Don't add a
// hardcoded version constant here; it drifts out of lockstep with package.json.

export const MOMENTUM_ROTATION_BASKET = [
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "NVDA",
  "META",
  "TSLA",
  "JPM",
  "V",
  "WMT",
];

export const MOMENTUM_ROTATION_BASKET_CSV = MOMENTUM_ROTATION_BASKET.join(",");

export const TIMEFRAMES = [
  { interval: "1m", range: "5d", label: "1m" },
  { interval: "5m", range: "1mo", label: "5m" },
  { interval: "15m", range: "1mo", label: "15m" },
  { interval: "1h", range: "3mo", label: "1h" },
  { interval: "1d", range: "1y", label: "1D" },
  { interval: "1wk", range: "5y", label: "1W" },
  { interval: "1mo", range: "max", label: "1M" }
];
