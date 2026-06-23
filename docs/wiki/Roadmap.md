# Roadmap

> **Fork direction (US / EU / crypto).** This fork re-centres the platform away
> from the NSE/India-first upstream toward US, EU, and crypto markets, on a
> Postgres-first stack with a local LLM. NSE/BSE **F&O** stays supported.

## Fork: Completed

- **Postgres-first persistence** hardening (default DB; SQLite opt-in)
- **De-India data layer**: retired the NSE-CSV `/search`; unified
  `instrument_master` universe seeded from free sources — US (Nasdaq Trader
  files), EU/UK (`pytickersymbols`), crypto (CoinGecko) — with auto-seed +
  periodic refresh
- **Search quality**: accent-insensitive matching, relevance bands, and
  context-weighted ranking by the active market/asset selector; Yahoo
  long-tail fallback
- **Crypto coverage**: CoinGecko universe/search/candles + **Binance** public
  WebSocket for live spot ticks
- **Foreign-symbol routing**: EU Yahoo suffixes (`.L`/`.DE`/`.PA`/…) classify
  deterministically and bypass the NSE/Kite path
- **Market-overview de-India**: home/dashboard/ticker-tape index widgets show
  S&P 500 / NASDAQ / DOW from the existing status payload
- **Frontend cleanup**: removed dead UI and swapped India-default tickers/
  baskets for US equivalents
- **News pipeline wiring fix**: corrected the frontend news/sentiment/AI API
  paths (the FE called non-existent `/v1/...` routes) and fixed a backend route
  ordering bug that shadowed `/news/sentiment/summary`
- **Full FE↔backend API audit**: cross-checked every `frontend/src/api/*.ts`
  call against the served route table and fixed all remaining path/shape
  mismatches in one pass — backtest job flow (`/v1/backtest/jobs` →
  `submit`/`status`/`result`), crypto movers path param, mutual-fund namespace,
  watchlist items (singular→plural), plugin enable/disable, fixed-income→bonds.
  Also fixed two backend wiring bugs the audit surfaced: the `economics` router
  was imported but never mounted (every `/api/economics/*` was a 404, plus a
  dead `settings.fmp_key` attribute), and the enriched watchlist-items GET was
  shadowed by the multi-watchlist router (moved to `/watchlists/items`)

## Fork: Next

- **Local LLM via Ollama** — make Ollama first-class for AI sentiment/insights
  (upstream defaults to LM Studio / Gemma)
- **EUR display currency** — wire FX conversion (and retire leftover `INR`
  formatting + `NIFTY50` benchmark-preset defaults)
- **Scheduled reports + report generation backend** — the frontend
  (`Settings.tsx` scheduled reports, `SecurityHub.tsx` report export) calls
  `/reports/scheduled` and `/reports/generate`, but only a `ScheduledReportService`
  exists — no HTTP routes are wired. Build the CRUD + generate endpoints. (Lower
  priority; surfaced by the API audit, deferred to after Ollama.)
- **Config/key management** — cleaner provider credential handling (deferred)

## Completed

- Terminal Noir base shell + semantic theme tokens
- GO Command Bar + ticker tape + market status bar
- Launchpad workspace and panel ecosystem
- Security Hub tabbed ticker workspace
- DenseTable reusable high-density data table
- Chart sync foundations + volume profile integration
- Multi-portfolio backend + manager UI
- Multi-market screener + formula mode
- News sentiment components and trend chart
- **Economic Data Terminal** (Calendar + Macro Dashboard)
- **AI Research Copilot** (Natural Language Query engine)
- **US Stock Options Support** (Greeks + IV Rank/Percentile)
- **Sector Rotation (RRG)** Map implementation
- **Redis Quote Bus** for distributed quote broadcasting
- **Multi-Watchlist System** with Treemap Heatmap mode
- **Intraday Backtesting** with Vectorized NumPy Engine
- **Keyboard Navigation System** (Bloomberg-style global hotkeys)
- **Advanced Reporting Engine** (Bloomberg-quality PDF export)

## In Progress

- Full parity and hardening for all Section 3 UX acceptance details
- Full parity and hardening for remaining Section 4 feature packs
- Additional chart/portfolio/scanner deep test coverage

## Next

- Broaden chart context actions across all chart surfaces
- Expand portfolio analytics (alpha/beta/tracking-error/up/down capture)
- Market-open scheduler semantics for scanner alerts
- Performance pass for chunk splitting and initial load footprint
