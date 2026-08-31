# Current project state and backlog

Last audited: **2026-08-31**, against `main` at `acecb4e` (PR #91).

This is a handoff, not an immutable roadmap. Before taking an item, verify it
against recent Git history, code, and tests. Move shipped work to the completed
section and update this file in the same PR when priorities materially change.

## Released baseline

### v1.0.0 — integrity and portability

- PostgreSQL-first Docker deployment with SQLite compatibility.
- US/EU/crypto instrument universe, search, quotes, charts, and market-aware
  routing; US/NASDAQ defaults replace the old India-first defaults.
- Crypto live spot ticks via Binance and crypto fundamentals via CoinGecko and
  DefiLlama.
- Instrument-aware USD/EUR/INR display conversion.
- Provider-agnostic OpenAI-compatible LLM layer with Ollama defaults.
- Private notes and second-brain retrieval with pgvector/PostgreSQL and a local
  SQLite/numpy fallback.
- Integrity sweep: unsupported or unavailable data returns explicit degraded or
  sample states instead of plausible fabricated values.

### v1.1.0 — portfolio becomes real

- Per-user multi-portfolio system is the only portfolio model; the global legacy
  portfolio was removed.
- Cash is derived from the transaction ledger, with deposit/withdrawal support.
- Honest realised/unrealised P&L, portfolio analytics, attribution, events,
  reporting, AI risk narrative, and portfolio-seeded backtesting.
- Tax-lot accounting was deliberately removed and remains out of scope.

## Unreleased work already on `main`

The version remains 1.1.0, but these v1.2 slices landed after the tag (PRs
#76-#91):

- Fixed projected portfolio dividends and sell transactions reducing/removing
  the corresponding holding.
- Made screener materialised-store introspection PostgreSQL-safe.
- Added adversarial **Interrogate** experiences for stocks, crypto, and indices,
  grounded with semantically related private notes.
- Added note reindexing/test-readiness improvements and index-news support.
- Added crypto-native RSS ingestion, crypto-aware ticker routing, and EU ticker
  term resolution.
- Added optional batched/cached LLM per-article sentiment with classical fallback.
- Expanded the News hub with market overview, browse-by-market, sentiment
  drill-in, and short publisher summaries.
- Hardened LLM structured output for providers that ignore `response_format`,
  added a larger-budget retry for truncation, and increased frontend timeouts for
  long-running LLM-backed insight requests.

These changes should be captured in `CHANGELOG.md` before the next release; its
`[Unreleased]` section is currently empty.

## Active product work

These are the clearest remaining items from the current roadmap and code state.
They are not ordered unless a maintainer explicitly assigns priority.

- [ ] **Finish the v1.2 research-interrogation arc.** Evaluate consistent
      explain/interrogate affordances on remaining surfaces and complete the
      planned second-brain improvements: long-note chunking, proactive journal
      gaps, market-data/news corpus expansion, streaming answers, and source
      filters. Confirm what is already present before implementing a slice.
- [ ] **Relative Strength engine.** Replace the intentionally degraded `/rs/*`
      endpoints with a real, tested IBD-style computation. Never restore the old
      fabricated Indian rankings.
- [ ] **Rewrite/rehabilitate Playwright E2E.** The suite is manual-only because
      some specs assert pre-1.0 synthetic data and India-first defaults. Update
      fixtures and assertions before making it a required PR gate again.
- [ ] **Expand test depth.** Continue chart, portfolio, scanner, provider-failure,
      and PostgreSQL/SQLite coverage, especially around recent v1.2 paths.
- [ ] **Performance pass.** Reduce initial frontend load/chunk size and inspect
      expensive news/AI/market-data paths without weakening correctness.

## Data coverage and honest gaps

- [ ] **US/EU equity Level-2 depth.** No free general source is wired. Current
      behaviour must remain empty + degraded. The planned direction is an IBKR
      adapter gated by the user's exchange subscriptions.
- [ ] **EU and crypto heatmaps.** The heatmap universe remains IN/US-oriented;
      extend it using `instrument_master` and the crypto universe.
- [ ] **Economic calendar views and source.** Add daily/weekly views. The live
      forward-calendar source is unresolved; the existing sample fallback must
      remain visibly labelled.
- [ ] **Degraded data surfaces.** Bonds/fixed income, hotlists/movers, insider
      trades, portions of ETF screener/flows, and tape/time-and-sales still need
      real sources or fuller implementations. Preserve degraded markers until a
      genuine feed is connected.
- [ ] **Crypto liquidations.** Wire the Binance `forceOrder` WebSocket runner if
      this remains absent; do not invent REST liquidation values.
- [ ] **Broader realtime/depth coverage.** EU/crypto derivatives and non-spot
      depth remain demand-driven follow-ups beyond existing crypto spot/depth.

## UX and domain follow-ups

- [ ] Finish remaining EUR/native-currency presentation cleanup in stock detail,
      F&O, screener, chart, heatmap, and backtesting surfaces. Convert values or
      display their native currency; never merely swap the symbol.
- [ ] Add 1M/3M/6M portfolio movement ranges with suitable granularity.
- [ ] Allow notes capture from articles in every general News mode, not only
      ticker mode.
- [ ] Broaden chart context actions across chart surfaces.
- [ ] Expand portfolio analytics where useful (alpha/beta/tracking error and
      upside/downside capture are named roadmap candidates).
- [ ] Add market-open scheduler semantics for scanner alerts.

## Maintenance and documentation debt

- [ ] Update `CHANGELOG.md` with the post-v1.1 PRs before cutting the next release.
- [ ] Refresh `docs/wiki/Architecture.md`: it still says SQLite is the default,
      PostgreSQL optional, and points at obsolete migration/service locations.
- [ ] Reconcile test/setup commands across `README.md`, `CONTRIBUTING.md`, and
      `Makefile` (for example, `CONTRIBUTING.md` references a missing
      `backend/requirements-dev.txt`).
- [ ] Refresh `docs/wiki/Limitations.md` for post-v1.0/v1.1 behaviour and verify
      every listed degraded surface against current routes.
- [ ] Improve provider credential/config management before relying on paid APIs.
- [ ] Consider the deferred Docker Python 3.11 → 3.12 upgrade only with dependency
      and CI verification.

## Deliberately retained scope

- India NSE/BSE F&O remains supported and provider-specific under `backend/fno/`.
  It is not the global product default, but it should not be accidentally broken.
- SQLite remains supported even though Docker defaults to PostgreSQL.
- Local Ollama remains the default LLM path; hosted providers are optional.
- Tax-lot/tax accounting remains unscheduled unless a narrowly scoped,
  jurisdiction-aware design is explicitly approved.
