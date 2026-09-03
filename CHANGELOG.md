# Changelog

All notable changes to this fork are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
adopt [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from `1.0.0`.

## [Unreleased]

### Added
- **v1.4 product-surface inventory** — checked-in classifications cover every
  generated OpenAPI family and every primary navigation destination. A CI guard
  fails when API-family tags drift without an explicit supported, gated,
  experimental, hidden, or removal decision.

### Changed
- **GitHub Pages deployment maintenance** — upgraded the Pages workflow to
  Node.js 24-compatible action majors, removed an unauthorized attempt to enable
  Pages with the default workflow token, and made workflow changes trigger a
  deployment so they are exercised after merge.
- **Primary navigation reflects usable products** — Bonds screening, Hotlists,
  standalone Insider Activity, Relative Strength, and standalone Tape are hidden
  until real production data paths exist. Their direct routes and APIs remain
  compatible and honestly degraded; configured Yield Curve and DOM workflows
  remain visible.
- **Orphan frontend cleanup** — removed superseded Home, Crypto, and Login page
  implementations plus the unreachable Breakout Scanner page and its page-only
  presentation/test files. Active Home, Crypto Workspace, authentication,
  Screener, scanner APIs, and alert infrastructure are unchanged.
- **Cockpit is an honest compatibility surface** — removed fabricated AAPL,
  P&L, risk, and FOMC values from its legacy summary API. The endpoint now emits
  empty/null sections with explicit unavailable reasons, and Cockpit is hidden
  from navigation, home/about launchers, and command discovery until it becomes
  an authenticated, owner-scoped aggregation of real services.
- **Plugins are operator-only** — removed the local Python plugin loader from
  general navigation and Ops launch links, restricted discovery and process-wide
  lifecycle endpoints to administrators, and fixed rediscovery so it no longer
  silently forgets enabled runtime state. The compatibility page now states that
  host-installed plugins are trusted code and that no marketplace exists.

## [1.3.0] - 2026-09-02

The **"second brain gets depth"** release. v1.3 keeps private memory grounded in
the current user's own writing while making long sources, retrieval scope,
progressive answers, deliberate automation inputs, and documentation gaps
inspectable as that memory grows.

### Added
- **v1.3 chunk-aware Second Brain memory** — long private notes, journal entries,
  portfolio theses, holding notes, and transaction notes are split into
  deterministic, lightly overlapping chunks instead of one embedding per source
  record. Stable internal chunk keys preserve the original citation `ref_id` and
  expose a zero-based `chunk_index`; incremental reindexing embeds only new or
  changed chunks and prunes stale rows after replacements are safely persisted.
- **Inspectable Second Brain evidence scopes** — ask requests can restrict
  retrieval to validated private source types while omitted filters retain the
  all-private-writing default. The index status reports per-source chunk counts,
  and the UI shows filter chips and records the exact scope used for each answer.
- **Incremental Second Brain synthesis** — compatible OpenAI-style providers can
  stream grounded answer text to the UI over an authenticated NDJSON endpoint.
  The original non-streaming API remains available, retrieval/model fallbacks stay
  complete and cited, and interrupted browser streams retry through that stable
  path rather than leaving a partial answer presented as complete.
- **API-key external note ingestion** — `read_write` keys can idempotently upsert
  an owner-scoped private note at `PUT /api/v1/notes/external` using a stable
  source/external ID pair. This supports deliberate inputs such as Hermes YouTube
  summaries, adds provenance tags, and schedules normal Second Brain reindexing.
- **On-demand journal completeness review** — the Trade Journal can explicitly
  scan the current user's entries for absent rationale, outcomes, emotions, setup
  labels, and stale open-trade thesis updates, then open each result for editing.
  Checks are deterministic and do not invent facts, advice, or notifications.

## [1.2.0] - 2026-08-31

The **"research interrogates"** release. v1.2 turns the private research layer
from passive storage into an adversarial assistant: it challenges a thesis with
asset-appropriate market evidence and the user's own notes, while the News hub
adds optional, transparent LLM sentiment without making inference automatic.

### Added
- **Adversarial Interrogate research** for equities, crypto assets, and indices.
  The structured analysis pressure-tests the bull case, identifies missing
  evidence and disconfirming signals, and grounds its challenge in semantically
  related private notes when available.
- **Crypto- and index-aware research context.** Crypto interrogation uses
  tokenomics, dilution, TVL, fees, and on-chain context; index interrogation uses
  regime, breadth, constituents, and index-level market context instead of
  pretending either asset is an operating company.
- **Crypto-native and broader ticker news.** Keyless crypto RSS ingestion,
  crypto firehose routing, index news, and EU-aware search terms improve coverage
  outside US equities.
- **Optional batched AI article sentiment.** The backend scores and caches up to
  20 headlines in one structured LLM call and falls back per article to the
  classical lexical engine when the model is disabled or unreachable.
- **News hub research workflow.** Market-wide browsing, US/Europe/India/crypto/
  index slices, search and ticker scopes, sentiment drill-in, publisher-summary
  enrichment, and explicit on-demand AI scoring of visible headline batches.

### Changed
- **Asset-aware AI research** — stock, crypto, and index briefings/interrogations
  now use domain-appropriate facts and prompts. Coins are evaluated through
  tokenomics/on-chain context and indices through regime/breadth context rather
  than being treated as companies with issuer fundamentals.
- **On-demand News hub AI sentiment** — the main market, ticker, and search news
  feeds can score visible headlines in batches of at most 20, overlay concise
  rationales, and clearly identify LLM, mixed, or lexical-fallback results.
- **More portable structured LLM output** — the requested JSON schema is carried
  in the prompt for providers that ignore `response_format`, and truncated
  structured responses receive one larger-budget retry. Frontend AI requests now
  allow enough time for local and reasoning models to complete.

### Fixed
- **Fresh AI regeneration and note grounding** — Interrogate cache keys now
  follow each user's note state, and the UI's Regenerate action explicitly
  bypasses cached briefing/interrogation results. Unavailable insight generation
  is labelled honestly instead of being misreported as a lexical fallback.
- **News routing and classification** — crypto articles are tagged at ingestion,
  coin ticker requests use the crypto firehose, index headlines resolve, and EU
  company aliases no longer bias results toward unrelated US tickers.
- **Portfolio and PostgreSQL regressions** — projected dividends are included for
  regular distributors, sells reduce or remove their holding as well as updating
  cash, and screener materialised-store introspection works on PostgreSQL rather
  than relying on SQLite-only PRAGMA calls.

## [1.1.0] - 2026-07-05

The **"portfolio becomes real"** release. v1.0 hardened the *research* half of the
north star (never show fabricated market data as live); 1.1 turns that same
integrity lens on the *portfolio* half — a real cash/transaction spine, honest
realized-vs-unrealized P&L, and the retirement of the old global, shared-across-
users portfolio (a privacy contradiction) in favour of a per-user one.

### Added
- **Portfolio cash ledger** (v1.1 "portfolio becomes real", spine) — cash is now
  derived from the transaction ledger as the single source of truth: a buy debits
  cash, a sell/dividend/deposit credits it, a withdrawal debits it, and fees always
  cost cash. New `deposit`/`withdrawal` transaction types (cash-only, no symbol).
  `GET /api/portfolios`, `/api/portfolios/{id}`, and `/api/portfolios/{id}/analytics`
  now report `cash_balance` and `net_liquidation_value` (holdings + cash).
- **Portfolio transaction UI** (v1.1) — the Portfolio Manager can now record
  buy/sell/dividend/deposit/withdrawal transactions (the endpoints existed but no
  UI ever called them), with a live cash-impact preview and a trade-history table.
  New Net Liquidation and Cash metric cards surface the ledger balance.
- **Upcoming events in the Portfolio Manager** (v1.1) — dividends, earnings and
  corporate actions for your holdings now show in the Manager's events calendar,
  not only on the legacy view / dedicated Dividends page.
- **Deep analytics on the per-user portfolio** (v1.1, consolidation) — the
  Portfolio Manager now carries everything the old view had: correlation matrix,
  benchmark-overlay equity curve, the full risk-metric set (Sharpe, Sortino, beta,
  alpha, information ratio, max drawdown), an upcoming-dividend tracker, and
  Brinson + factor **attribution** — all scoped to the selected portfolio via new
  owner-checked `GET /api/portfolios/{id}/analytics/*` and `/attribution` routes
  (with a `primary` alias for dashboards).
- **AI Risk Assessment + backtesting in the Manager** (v1.1) — the local-LLM risk
  narrative (on-demand) and the backtester (seeded from the portfolio's holdings)
  now live in the Manager.
- **Sell from a holding row** (v1.1) — each holding has a "Sell" button that
  pre-fills the transaction form (sell / that symbol / full size / current price)
  so a sale is attributed to the position instead of typed from scratch.
- **Holdings CSV export** in the Manager (it already had CSV import).

### Changed
- **The equity portfolio is now per-user, full stop** (v1.1, consolidation) — the
  Portfolio Manager (`/api/portfolios`) is the only portfolio; the legacy
  manager|legacy view toggle is gone and every surface that read a portfolio
  (home, cockpit, HUD, launchpad, correlation dashboard, risk / stress / factor /
  dividends / reports) now reads the caller's own **primary** portfolio via
  `GET /api/portfolios/primary`.

### Removed
- **The global, user-less legacy portfolio** (v1.1, consolidation) — the shared
  `Holding` table and its `/api/portfolio`, `/api/portfolio/analytics/*`,
  `/api/portfolio/holdings*` and `/api/portfolio/{id}/attribution` endpoints are
  deleted. On a shared instance every user saw and edited the *same* holdings — a
  contradiction of the "private terminal" thesis; portfolios are per-user now.
  (The global `/watchlists/items` feed is unaffected.)
- **Tax-lot accounting** (the `TaxLot` model, `/api/portfolio/tax-lots*` endpoints
  and the Tax Lot Manager UI) — a jurisdiction-specific rabbit hole where a wrong
  number is worse than none; deliberately shelved.

### Fixed
- **Import from Legacy / bulk add crashed with a 500** (v1.1) — adding a holding
  auto-generated its `lot_id` from a second-resolution timestamp, so adding the
  same symbol more than once within a second (as the legacy import does) collided
  on the `(portfolio_id, symbol, lot_id)` unique constraint. Auto lot_ids now
  carry a random suffix, and a genuine duplicate `lot_id` returns a clean `409`
  instead of an unhandled `500`.
- **Realized P&L was proceeds, not gains** (v1.1) — analytics summed
  `shares * sell_price - fees`, overstating realized P&L by the entire cost basis.
  Now computed by replaying the ledger chronologically (running average cost per
  symbol): `shares_sold * (sell_price - avg_cost) - fees`, dividends excluded
  (they remain in `dividend_income_ytd`). New pure `backend/services/portfolio_pnl.py`.
  Annualized return now uses net liquidation (holdings + cash) as current equity.
  The "Total P&L" card is relabelled "Unrealized P&L" to match what it shows.
- Multi-portfolio analytics annualized-return crashed on portfolios whose
  transactions carried bare `YYYY-MM-DD` dates (naive vs. tz-aware datetime
  subtraction); inception dates are now normalised to UTC.
- Multi-portfolio analytics used India defaults for risk metrics (risk-free `0.06`,
  benchmark `NIFTY50`); now `0.04` / `S&P500` in line with the de-India defaults.

## [1.0.0] - 2026-06-29

The first tagged release. A **hardening** milestone: a coherent, honest,
installable product where every advertised feature works or is explicitly
labelled degraded. All release buckets are complete — integrity (A), de-India
defaults (B), robustness (C), the single-source version contract (D), and
ship-with docs (E). See `docs/wiki/Roadmap.md` → *Release plan* for the full
gate and `docs/wiki/Limitations.md` for the honest keys/limitations map.

### Added
- **Private second brain (RAG)** — flagship: ask-anything research grounded only
  in your own writing (journal, theses, position/transaction notes), with inline
  citations; provider-agnostic embeddings (Ollama `nomic-embed-text` default,
  `sentence-transformers` fallback) and a dialect-aware vector store (pgvector on
  Postgres, numpy cosine on SQLite). `POST /api/brain/ask|reindex`, `GET
  /api/brain/status` + a Second Brain page.
- **Generic notes capture** — one-step note capture anywhere (stock/crypto detail,
  watchlist rows, news, Portfolio Lab, Notes hub) feeding the second brain.
- **Crypto fundamentals** — tokenomics + on-chain TVL/fees (CoinGecko + keyless
  DefiLlama); `GET /api/v1/crypto/fundamentals/{symbol}`.
- **EUR display currency** — cross-rates-driven, instrument-currency-aware display
  engine (USD/EUR/INR) with correct per-currency symbol/locale/compaction.
- **Dividend calendar (real data)** — market-agnostic calendar/history/aristocrats/
  income via the corporate-actions service (Yahoo chart `events=div` + FMP), with
  labelled next-ex-date projections for regular distributors.
- **Scheduled reports + PDF generation backend**; **provider-agnostic LLM layer**
  (OpenAI-compatible, Ollama default); **economic data terminal** (calendar +
  macro dashboard).

### Changed
- **Postgres-first** persistence (SQLite opt-in); pgvector Postgres image
  (`pgvector/pgvector:0.8.3-pg16-trixie`, no migration).
- **De-India data layer** — unified `instrument_master` (US/EU/crypto sources),
  accent-insensitive search, EU Yahoo-suffix routing; market-overview/ticker-tape
  show US indices. NSE/BSE F&O stays supported.
- **External-client robustness (1.0 bucket C).** A shared retry-with-jitter +
  per-client circuit breaker (`backend/shared/http_resilience.py`) backs off on
  429/5xx instead of hammering a depleted provider, and response caching now
  covers **Finnhub** and **Yahoo** as well as FMP (the shared multi-tier cache
  incl. the persistent SQLite L3) to stop free-tier quota burn; 429/5xx never
  cached. Finnhub no longer force-appends `.NS` to bare symbols.

### Fixed
- **Silent-mock integrity sweep (1.0 bucket A, part 1).** Audited the backend for
  code that fabricated plausible market data when a real source was unavailable
  and presented it as live. Established a standard `degraded: {reason, source}`
  marker (`backend/shared/degraded.py`) + a reusable `DegradedBanner` so the UI
  always flags non-live data. Fixed the 7 critical sites:
  - **Market status** (`/reports/market-status`): removed the hardcoded
    index/commodity values + `random` jitter (NIFTY/SP500/gold/silver/crude…);
    missing quotes now stay null and the response is flagged degraded.
  - **Heatmap treemap**: stopped seeding synthetic price/change/volume per tile;
    tiles with no live quote render neutral and the response is flagged degraded.
  - **Tape** (`/tape/*`): removed synthetic bars and invented buy/sell order
    flow; only real trade-feed data is shown, otherwise empty + degraded.
  - **Historical OHLCV** (`historical_data_service`): removed the synthetic
    random-walk fallback so backtests/charts never run on fabricated history.
  - **Macro indicators**: the no-`FRED_API_KEY` fallback is now flagged degraded
    (previously only the calendar carried a `sample` flag, the macro dash didn't).
  - **Yield curve / 2s10s** (`fixed_income`): no-key/error paths return empty +
    degraded instead of a hardcoded curve.
  - **Bonds** (`/bonds/*`): replaced the hardcoded India-only bond universe,
    spreads, and ratings with empty + degraded (no live source wired yet).
- **Silent-mock integrity sweep (1.0 bucket A, part 2).** Extended the audit to
  the high-severity sites and a few the first pass missed:
  - **Hotlists** (`/api/hotlists`): the page 401'd because it used a raw `fetch()`
    that bypassed the bearer-token client — now routed through the authed `api`
    client. The endpoint itself was 100% fabricated (hardcoded prices + seeded
    sparklines) → now empty + degraded; default market de-India'd to `US`.
  - **Insider** (`/api/insider/*`): removed the auto-seeded fabricated India
    insider universe (`source="SEEDED"`); serves only ingested trades, else
    empty + degraded. Deleted the dead, mock-only `insider_monitor.py`.
  - **ETF** (`/api/etf/*`): removed the hardcoded screener (incl. NIFTYBEES),
    the AAPL/MSFT holdings placeholder, and the `random` fund-flows; empty +
    degraded instead. ETF FE components routed through the authed `api` client
    (same latent 401 as hotlists).
  - **Shareholding**: the no-source fallback no longer fabricates a "100%
    public" cap table — returns zeros + degraded.
  - **Sector rotation (RRG)**: removed the hashed-seed synthetic price series;
    empty + degraded when the price source is unavailable.
  - **Charts** (`/chart/{ticker}` + indicators): removed the synthetic
    random-walk fallback; empty + degraded instead of a fake series.
  - **Crypto correlation**: drops assets without real return history rather than
    back-filling a synthetic sine/cosine series; flags degraded when partial.
- **Silent-mock integrity sweep (1.0 bucket A, part 3) — real Binance crypto
  microstructure + derivatives.** Replaced the last synthesized-crypto sites with
  real Binance public-REST data (new `backend/core/binance_client.py` +
  `backend/services/crypto_derivatives_service.py`):
  - **Crypto heatmap depth** (`/v1/crypto/heatmap`): `depth_bid/ask_notional` +
    `depth_imbalance` are now the real best bid/ask from the spot order book
    (`bookTicker`, one call, cached), not `volume*price`. Symbols Binance doesn't
    list read as empty depth; no order-book coverage at all flags degraded.
  - **Crypto derivatives** (`/v1/crypto/derivatives`): `funding_rate_8h` is the
    real last funding rate (futures `premiumIndex`) and `open_interest_usd` is
    real (`openInterest` × mark price), no longer derived from `change_24h`.
    24h liquidations have no Binance REST endpoint, so they are read only from the
    live `forceOrder` WebSocket stream (`BinanceDerivativesState`); until that
    runner is wired they read 0 and the response is flagged `no_live_source`
    instead of being fabricated. `DegradedBanner` wired into both crypto tabs.
- **Silent-mock integrity sweep (1.0 bucket A, part 4) — real order-book depth.**
  The `/api/depth/{symbol}` REST route and the `/ws/depth` stream returned a
  fully **synthetic** order book for every market — prices, sizes, spread and
  imbalance were all derived from a `sha256(symbol:market:levels)` hash (a site
  the earlier audit missed). Both now serve real depth via `unified_fetcher.
  fetch_depth`:
  - **Crypto** → real Binance spot order book (`/api/v3/depth`, new
    `BinanceClient.get_order_book`); the FE panel detects crypto symbols so a
    crypto detail page no longer requests depth as an equity market.
  - **India** → already had real Kite/NSE depth in `fetch_depth`, but the route
    bypassed it; it's now wired through (real).
  - **US / EU equity** → no free Level-2 source, so the book is empty +
    `degraded` (`no_live_source`) instead of fabricated; `OrderBookPanel` shows
    the degraded banner. Real US/EU L2 is a roadmap item (Interactive Brokers).
  - Depth quantities widened to floats (crypto books are fractional); the
    synthetic `orderbook_service` generator was deleted.
- **De-India defaults (1.0 bucket B).** Western-oriented defaults across the app
  (India markets stay *supported*, just not the default): watchlist symbol search
  passes the selected market through instead of forcing NSE; home/sidebar F&O
  widgets default to `SPY` (sidebar label → "EQUITY ANALYTICS"); the portfolio
  risk/attribution/lab benchmark defaults to `S&P500` (FE + backend route &
  service defaults) and the default risk-free rate is `0.04` (was `0.06`).
  `NIFTY50`/`SENSEX` remain selectable benchmark options. The F&O heatmap's
  empty/error copy is now market-neutral ("F&O options data feed") instead of
  hard-coding "Kite API key required".
- **Relative Strength stub de-India'd + degraded (1.0 bucket A).** Every `/rs/*`
  endpoint (rankings, sector-rs, chart, new-highs) previously returned hardcoded
  fake Indian rows (RELIANCE/TCS/INFY…) presented as live; they now return empty
  + `degraded` and the FE defaults the universe to S&P 500. The real RS
  computation is a tracked post-1.0 follow-up.
- **Scheduled-report 422 on missing email (1.0 bucket A).** `POST
  /api/reports/scheduled` rejected a blank `email`; it now defaults to the
  authenticated user's account email and only errors when there's genuinely no
  address.
- **Index detail page (1.0 bucket A).** Navigating to a market index (`^GSPC`,
  `^NSEI`, …) rendered the full equity tab set — Financials/Peers/Valuation/
  Earnings/Shareholding — all blank, since an index has no issuer fundamentals.
  An index now shows only the chart-backed overview + notes, with an explicit
  "fundamentals don't apply to an index" note; price/chart/performance (which do
  apply) are unchanged. `isIndexSymbol` also keeps `^NSEI` from being treated as
  an NSE equity.
- **FMP corporate-actions migrated to `/stable`.** `corporate_actions.py` was
  missed in the original `/stable` migration and still used legacy `/api/v3`
  path-segment URLs that 404'd (dividends/splits/IPO calendar). Now uses the
  stable `/dividends`, `/splits`, `/ipos-calendar` shapes, skips crypto, and
  caches 404s as empty to stop log noise.
- **Portfolio asset classification for crypto (1.0 bucket A).** Crypto holdings
  (BTC-USD, ETH-USD, …) previously fell through the market classifier to the
  NASDAQ/US default — rendering a wrong US flag and collapsing into the "Unknown"
  sector. The classifier is now crypto-aware (`is_crypto_symbol` /
  `crypto_quote_currency` in `backend/shared/market_classifier.py`): crypto pairs
  classify as a global, 24/7 asset (exchange `CRYPTO`, 🌐 flag) whose display
  currency is the pair's quote leg (so BTC-EUR reads EUR, …USDT → USD), and
  portfolio sector allocation/attribution bucket them under "Crypto" instead of
  "Unknown". EU ETPs were already classified correctly via the deterministic
  foreign-suffix map.
- Full FE↔backend API audit (`/v1/...` path/shape mismatches; unmounted economics
  router; shadowed watchlist-items route).
- Ticker tape: real commodity values (GC=F/SI=F/CL=F were missing from the fetch
  list → permanent mock), clickable duplicate scroll segment, correct index/Nikkei
  link symbols.
- Economic calendar always-empty (FE read `data.items`; backend returns a bare
  array) + de-India macro config and labelled `sample` fallback.
- Portfolio: correlation 500 on duplicate-ticker lots; display-currency on the
  movement axis and holdings table; `BTC-EUR` resolved as EUR (not USD) by reading
  the crypto pair's quote leg.

---

_Pre-fork upstream history is not tracked here; this changelog begins with the
fork's road to 1.0._
