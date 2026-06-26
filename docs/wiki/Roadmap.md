# Roadmap

> **North star.** An open, private terminal that helps an individual invest
> *without being fooled* — by markets, by hype, or by themselves — through
> AI-native research you can grow privately. The foundational fork goals
> (Postgres-first, frontend↔backend wiring, de-India data layer) are complete;
> new work serves that mission. Bloomberg parity is pursued only "just enough to
> be credible" — the differentiation is AI-native, private, open, multi-asset.
>
> **Fork direction (US / EU / crypto).** Re-centres the platform away from the
> NSE/India-first upstream toward US, EU, and crypto markets, on a Postgres-first
> stack with a local LLM. NSE/BSE **F&O** stays supported.

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
- **Provider-agnostic LLM layer**: replaced the LM Studio-specific client with a
  generic OpenAI-compatible `LLMClient` (default **Ollama** at
  `localhost:11434/v1`, also works with LM Studio, OpenAI, OpenRouter, Groq,
  vLLM, …). Added optional Bearer `api_key`, a structured-output fallback ladder
  (`json_schema` → `json_object` → text), and collapsed the old
  LM Studio/OpenAI/Ollama-native fork in `ai_service` into one path. Config via
  `LLM_BASE_URL`/`LLM_MODEL`/`LLM_API_KEY` (legacy `LM_STUDIO_*` still honored).
- **EUR display currency**: a cross-rates-driven, instrument-currency-aware
  display engine (`lib/currency.ts` + `useDisplayCurrency`). USD/EUR/INR selectable
  with correct per-currency symbol/locale/compaction (no more ₹-for-everything),
  converting from each instrument's native currency via the existing
  `/api/forex/cross-rates` matrix; retired the hardcoded `formatInr`.
- **Sentiment engine deps**: declared the intended classifier dependencies
  (`textblob` core; FinBERT extras in `requirements-ml.txt`) so the news
  per-article sentiment runs its designed FinBERT → TextBlob → lexicon ladder
  instead of silently degrading to keyword-only.
- **Crypto fundamentals** (first feature built *from* the north star): a new
  Fundamentals tab on the crypto detail page answering "is the price backed by
  real usage, or just a story?" — tokenomics (supply %, FDV/MCap dilution) from
  CoinGecko + on-chain TVL and fee revenue (MCap/TVL, price/fees) from keyless
  **DefiLlama**, each metric annotated in plain language with conservative
  "investigate this" cues. New `GET /api/v1/crypto/fundamentals/{symbol}`.
- **Private second brain (RAG)** — *the flagship north-star feature.* An
  ask-anything research partner grounded **only in your own writing**: it indexes
  your trade journal, portfolio theses, and position/transaction notes, embeds
  them locally, and answers questions with inline citations back to the source
  notes (e.g. "what setups lose me money when I'm anxious?"). Designed as a check
  against your own biases, not a cheerleader, and it never leaves the machine.
  Embeddings use the same provider-agnostic OpenAI-compatible endpoint as chat
  (Ollama `nomic-embed-text` by default), with a local `sentence-transformers`
  fallback. Storage is dialect-aware: **pgvector** (ANN cosine index) on Postgres,
  in-process **numpy cosine** on SQLite. New authed `POST /api/brain/ask`,
  `POST /api/brain/reindex`, `GET /api/brain/status` + a Second Brain page.
- **Generic notes capture (feeds the second brain)** — a one-step way to jot a
  thought *anywhere* so the brain has something to remember without requiring a
  full journal trade. One per-user `notes` table (symbol-optional, context tag,
  optional source link) with authed CRUD `GET/POST/PUT/DELETE /api/notes`, indexed
  as a first-class brain source. A reusable composer is wired into the
  stock/crypto detail page (Notes tab), watchlist rows, the news page (per-symbol
  reactions), and Portfolio Lab positions, plus a standalone **Notes** hub
  (`/equity/notes`, `NOTES` command).
- **Dividend calendar — real, market-agnostic data**: the `/dividends` page
  previously returned hardcoded NSE mock rows (RELIANCE/TCS/INFY). Rewired all
  four routes (`calendar`/`history`/`aristocrats`/`portfolio-income`) to the
  corporate-actions service (Yahoo/FMP), so the calendar now covers the user's
  holdings ∪ watchlist (or a default US basket), history is real per-symbol,
  aristocrats is the S&P 500 index list with **live** trailing yields, and
  portfolio income is bucketed by month. Added Yahoo's chart `events=div` feed as
  a dividend source (far richer than the next-ex-date-only `calendarEvents`, and
  works for ETFs / EU names like JEIP.DE that the old path missed), plus a
  labelled next-ex-date **projection** from historical cadence for regular
  distributors that have no free forward calendar (`type: "Estimated"`). Added a
  currency-agnostic amount parser (`extract_amount`) — the portfolio dividend
  tracker used to strip only "INR", parsing every USD/EUR dividend to 0.0 — and a
  `DVD`/`DIV` GO command. Yahoo corporate-action lookups now try the bare symbol
  first and only fall back to `.NS`/`.BO` when it yields nothing.
- **Economic calendar — de-India + empty-results fix**: the calendar always
  rendered empty because the frontend read `data.items` while the backend
  returns a bare array (now tolerant of both). De-Indianized the macro config
  and mock fallbacks (dropped the India/RBI series and events; US/EU/China
  remain), and the `/economics/indicators` route now honors the `country`
  filter the frontend already sent. When no live source is available (no key or
  a rate-limited provider) the sample fallback is flagged `sample: true` and the
  UI shows a banner, so placeholder events are never mistaken for live data.
- **Portfolio currency display fixes**: the Movement & Historical Return chart
  axis was hardcoded to INR (`formatCompactInr` with Cr/L) — now routed through
  the display-currency engine (`formatCompactMoney`). The holdings table Avg Cost
  / Current / Market Value / P&L columns rendered bare numbers (DenseTable's
  `type: "currency"` emits no symbol and no conversion), so mixed-currency
  holdings were misleading; they now convert each holding from its native
  currency (suffix-aware, e.g. `.DE` → EUR; market fallback otherwise) into the
  active display currency with the correct symbol.
- **Scheduled reports + report generation backend**: wired the per-user CRUD
  routes (`GET/POST/DELETE /api/reports/scheduled`) on a new DB-backed
  `scheduled_reports` table (rehydrated into APScheduler on boot) plus on-demand
  `POST /api/reports/generate` returning a PDF (portfolio / stock / backtest).
  Scheduled delivery emails the report via SMTP, degrading gracefully when SMTP
  env isn't configured. Unblocks the Settings scheduler + SecurityHub export.

## Release plan

The fork has shipped a large feature set but never cut a tagged release. The plan
below draws the line: **v1.0.0 is a *hardening* milestone, not a feature one** —
its job is a coherent, honest, installable product where every advertised feature
works or is explicitly labelled degraded, with a real version contract and docs.
New surfaces are deferred to v1.1+. See [Releasing](Releasing.md) for the
mechanics and the `CHANGELOG.md` for curated history.

> **What "stable" means here.** For a private-investing terminal whose north star
> is *don't get fooled*, integrity outranks feature count: no silent mock data
> masquerading as live, no broken links, no wrong-currency numbers, honest
> limitations. 1.0 finishes that pass.

### v1.0.0 — Stable (in progress)

Release-blocking only. Grouped by intent; treat as the release checklist.

**A. Integrity — the "don't get fooled" bar**
- [ ] **Silent-mock audit** — sweep services that fabricate data on a failed
  fetch (the commodity bug served `2100.0 + random` as a live gold price). Audit
  the `random`/`mock`/`placeholder` paths under `backend/services` &
  `backend/api/routes`; wire real data, or label it degraded (generalise the
  econ-calendar `sample: true` + banner pattern). Nothing fabricated may look live.
- [ ] **Portfolio asset classification** — crypto holdings & EU ETPs show as
  "unknown" (country/exchange/asset-class). Fix the market classifier / instrument
  mapping for non-US/India instruments (likely broader than these two cases).
- [ ] **Index detail page** — clicking a headline index (`^GSPC`/`^IXIC`/`^DJI`)
  from the ticker tape must land somewhere sensible. Confirm the ticker-tape
  ghost-click fix resolved the "missing" report, or ship a chart-first /
  index-aware detail view.
- [ ] **Scheduled-report 422** — `POST /api/reports/scheduled` rejects a missing
  `email` (`Field(min_length=3)`). Default to the authenticated user's account
  email; only skip delivery when there's genuinely no address.

**B. De-India defaults — the western-oriented release identity**
- [ ] **Watchlist default** — `WatchlistManager` symbol search falls back to NSE
  when the market isn't NASDAQ; de-India the default + any seeded watchlist symbols
  to follow the selected market.
- [ ] **F&O India defaults** — home/sidebar F&O widgets default to `NIFTY`
  (`HomePage.tsx`, `Sidebar.tsx`) and the Portfolio risk benchmark defaults to
  `NIFTY50`. Pick western defaults (F&O stays India-*supported*, just not the
  default). Note: a bare `NIFTY` request 404s under the US-default classifier.

**C. Robustness**
- [ ] **429 backoff / circuit-breaker + wider caching** — extend the working FMP
  persistent response cache to the other external clients (Finnhub, Yahoo — the
  cache layer is generic), and add shared retry-with-jitter + short
  circuit-breaking on 429/5xx so a *cold*-cache burst backs off instead of
  hammering. Clients live in `backend/core/*_client.py`.
- [ ] **Config/key clarity** — document which features need which keys; ensure
  every keyless/rate-limited degradation is honestly labelled in-UI (no silent
  fallbacks). See bucket E.

**D. Release mechanics**
- [ ] **Single version source of truth** — reconcile the mismatched
  `frontend/package.json` (`0.4.0`) and `backend` `app_version` (`0.2.0`) to
  `1.0.0`; surface it in `/api` health + the UI footer.
- [ ] **`CHANGELOG.md`** — curate from the fork history (Keep a Changelog format).
- [ ] **Tag `v1.0.0` + GitHub release** notes.
- [ ] **Release smoke matrix** — SQLite vs Postgres(+pgvector) × with-keys vs
  no-keys; confirm CI (pytest+coverage, Vitest, Playwright smoke) green.

**E. Docs (ship-with-release)**
- [ ] **"Out-of-the-box vs needs-keys" matrix** in README/wiki (FMP/Finnhub/FRED/
  LLM) — what works keyless vs what degrades.
- [ ] **Honest Limitations section** — no live economic-calendar source (sample
  fallback); dividend forward dates are *estimates*; commodities/econ need keys;
  index detail is chart-only (until fixed in A).
- [ ] **`Releasing.md`** (this checklist + version-bump steps) and **upgrade
  notes** (the `pgvector/pgvector:0.8.3-pg16-trixie` image swap).

### v1.1 — Multi-asset depth

Round out the western/crypto pivot's coverage gaps (the first feature release).

- **Heatmap EU / crypto coverage** — `HeatmapMarket` is IN|US only
  (`backend/api/routes/heatmap.py`); add EU + Crypto universes/selector (reuse the
  `instrument_master` EU rows + crypto universe).
- **Crypto Market Depth tab** — `OrderBookPanel` is wired to the equity
  `realtimeMarket`, not the Binance CRYPTO depth feed; wire a crypto depth source.
- **Dividends in the Portfolio Events Calendar** — surface upcoming ex-dates
  (`corporate_actions_service.get_upcoming_dividends`, incl. labelled projections)
  in the events calendar, not just the dedicated Dividends page.
- **Economic calendar — daily & weekly views** — currently month-grid only
  (`EconomicTerminal.tsx`); data is date-stamped, so add day/week ranges.
- **Crypto news sources** — extend news ingestion with crypto-focused outlets so
  crypto detail/news pages have real coverage.

### v1.2 — AI-native deepening

Lean into the north-star spine.

- **LLM-based per-article sentiment** — optionally route the News feed's
  per-article classification through the local LLM (reuse the Emotion Indicator
  pipeline; sentiment is persisted, so inference is paid once). Keep the classical
  FinBERT → TextBlob → lexicon engine as the offline fallback.
- **Second-brain enhancements** — chunk long notes, proactively surface "what to
  journal" gaps, add market-data/news to the corpus, streaming answers, a
  per-source filter in the UI.
- **Consistent explain / interrogate affordance** — a uniform "explain this /
  what am I missing / is this hype?" layer across surfaces.

### Degraded stubs → real data

The silent-mock sweep (#41/#42) replaced fabricated data with honest
`empty + degraded` responses. That stops the integrity problem but leaves these
surfaces as **stubs until a real source is wired** — they must not stay stubs
forever. Each needs a live integration (or removal if we decide the surface
isn't worth keeping). Pull into a milestone as data sources are chosen.

- **Bonds & fixed income** (`/api/bonds/*` — screener, credit spreads, ratings
  migration) — no live provider. Needs a fixed-income feed (e.g. FRED for
  rates/spreads, a bond reference-data provider for the screener/ratings). Until
  then the Bonds page is empty + degraded.
- **Hotlists / movers** (`/api/hotlists`) — needs a market screener feed exposing
  the fields a basic quote lacks: volume, avg volume, 52-week high/low, prior
  close/open (for gainers/losers/most-active/52w/gap/unusual-volume). `QuoteResponse`
  alone can't drive it.
- **Insider trades** (`/api/insider/*`) — needs an ingest pipeline populating
  `InsiderTrade` (e.g. SEC Form 4 for US; Finnhub/FMP insider endpoints). Routes,
  filtering, ranking, and cluster detection already work on real rows — only the
  data feed is missing.
- **ETF screener & fund flows** (`/api/etf/screener`, `/api/etf/flows`) — need an
  ETF data provider. (ETF **holdings**/**overlap** already use real Yahoo
  `topHoldings`; they degrade only when Yahoo returns nothing.)
- **Tape / Time & Sales** (`/api/tape/*`) — needs a real trade/tick feed adapter
  (`get_recent_trades`). Without it the tape is empty + degraded; we deliberately
  do **not** synthesize ticks or buy/sell order flow.
- **Crypto market depth & derivatives** (`/v1/crypto/heatmap` depth fields,
  `/v1/crypto/derivatives`) — currently still derive depth from `volume*price`
  and funding/liquidations from `change_24h` (deferred from #42). Wire a real
  orderbook/derivatives source (Binance depth + funding/OI/liquidations) or make
  them explicitly degraded + redesign the response models.

**Key-gated, not stubs** (these work today once a key is set — no new source
needed, just configuration): the **yield curve / 2s10s** and **macro indicators**
return live data with `FRED_API_KEY`, and **market status / heatmap / charts /
sector-rotation** return live data from Yahoo/adapters — they only show
`degraded` when the key is absent or the upstream fetch fails.

### Backlog / unscheduled

Real but unscheduled; pull into a milestone when it fits.

- **EUR display-currency leftovers** — thread the viewed symbol's currency into
  StockDetail's financial/analysis panels (market-native default today); clear the
  `en-IN` digit grouping in NSE-by-design F&O panels and a few screener/chart
  formatters.
- **Portfolio Movement sub-1Y timeframes** — add 1M/3M/6M ranges with finer
  granularity (the chart is 1Y/monthly only).
- **Notes capture from the general News feed** — notes work in News *ticker* mode
  only; allow per-article capture from any News mode.
- **Live economic-calendar source** — find a free/cheap forward calendar feed
  (Finnhub's is premium-only, FMP's free quota depletes); until then 1.0 ships the
  labelled sample fallback.
- **Config/key management** — cleaner provider credential handling (deferred).

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
