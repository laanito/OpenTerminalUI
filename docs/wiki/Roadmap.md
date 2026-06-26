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

## Fork: Next

- **EUR display-currency follow-ups** — the multi-currency engine shipped
  (cross-rates-driven, instrument-currency aware), but three refinements remain:
  the `-USD` hardcoding for EUR-quoted crypto (e.g. `BTC-EUR`); threading the
  viewed symbol's currency into StockDetail's financial/analysis panels (they use
  the market-native default today); and the leftover `en-IN` digit grouping in
  NSE-by-design F&O panels and a few screener/chart number formatters.
- **LLM-based per-article sentiment** (nice-to-have) — the News feed's per-article
  bullish/bearish/neutral classification currently uses the local non-LLM engine
  (FinBERT → TextBlob → lexicon, `backend/services/sentiment_engine.py`). Optionally
  route it through the local LLM by reusing the Emotion Indicator pipeline
  (`stock_emotion.py` already returns a per-article breakdown). Because sentiment is
  persisted per article, the inference cost is paid once and shouldn't be prohibitive.
  Keep the classical engine as the offline/disabled fallback.
- **Heatmap EU / crypto coverage** — the Market Heatmap supports only IN/US
  (`HeatmapMarket = "IN" | "US"`; `IN_UNIVERSE`/`US_UNIVERSE` in
  `backend/api/routes/heatmap.py`). Add **EU** and **Crypto** universes + selector
  options (reuse the `instrument_master` EU rows and the crypto universe) so the
  heatmap covers the fork's full asset set.
- **Crypto Market Depth tab** — the Market Depth tab on the crypto detail page
  doesn't work for crypto: `OrderBookPanel` is wired to the equity `realtimeMarket`
  rather than the Binance CRYPTO depth feed. Wire a crypto order-book / depth source
  so the tab populates for coins.
- **Watchlist India default** — the watchlist appears to default to Indian symbols
  (e.g. `WatchlistManager` symbol search falls back to NSE when the market isn't
  NASDAQ; check any seeded/default watchlist symbols too). De-India the defaults to
  follow the selected market.
- **Portfolio asset classification gaps** — crypto holdings and EU ETPs show up as
  "unknown" in the portfolio (country / exchange / asset-class classification).
  Investigate the market classifier / instrument mapping for non-US/India
  instruments — likely broader than these two cases.
- **429 backoff / circuit-breaker + wider response caching** — FMP responses are
  now cached persistently (shared multi-tier cache incl. SQLite L3), which stops
  repeated identical requests from re-spending quota and is working well. Next:
  (1) extend the same persistent response caching to the other external clients
  (Finnhub, Yahoo, etc. — the cache layer is generic, so it's mostly wiring each
  client's `_get` through `cache.get/set` with sensible TTLs); (2) add shared
  retry-with-jitter + short circuit-breaking on 429/5xx so that on a *cold* cache
  a rate-limited provider backs off instead of hammering. Clients live in
  `backend/core/*_client.py`.
- **Economic calendar — daily & weekly views** — the Economic Terminal calendar
  is month-grid only. Add day and week granularities (the data is already
  date-stamped; this is a frontend view/range addition in
  `frontend/src/pages/economics/EconomicTerminal.tsx`).
- **Portfolio Movement & Historical Return — sub-1Y timeframes** — the chart
  only offers 1Y with monthly datapoints; add shorter ranges (1M/3M/6M with finer
  granularity). *(The INR-hardcoded value axis is fixed — it now routes through
  `useDisplayCurrency` / `formatCompactMoney`.)*
- **Dividends in the Portfolio Events Calendar** — upcoming dividend ex-dates
  (now available via the corporate-actions service / `get_upcoming_dividends`,
  incl. labelled projections) should also surface in the portfolio events
  calendar, not just the dedicated Dividends page.
- **Notes capture from the News feed** — notes can be added per-symbol in News
  *ticker* mode, but not from the general latest/search feed. Allow attaching a
  note to an individual article (or the current view) from any News mode so the
  second brain captures reactions to non-watchlist stories too.
- **Crypto news sources** — review/extend the news ingestion sources to add
  crypto-focused outlets, so crypto detail/news pages have real coverage beyond
  the equity-centric feeds.
- **Live economic-calendar source** — Finnhub's economic calendar is premium-only
  and FMP's free quota depletes, so the calendar often shows labelled *sample*
  data. Find a free/cheap forward calendar feed (or accept the sample fallback).
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
