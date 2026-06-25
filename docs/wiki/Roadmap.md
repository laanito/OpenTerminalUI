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
