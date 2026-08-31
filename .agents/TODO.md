# Current project state and backlog

Last audited: **2026-08-31**, against `main` at `bd44141` (PR #94), plus the
v1.2.0 release-prep changes on this branch.

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

### v1.2.0 — research interrogates

- Adversarial **Interrogate** experiences for equities, crypto, and indices,
  grounded in semantically related private notes.
- Asset-aware briefing/interrogation facts: equity fundamentals, crypto
  tokenomics/on-chain evidence, and index regime/breadth context.
- Crypto-native RSS, crypto/index ticker routing, EU-aware news resolution, and
  a market/search/ticker News hub with publisher-summary enrichment.
- Explicit, on-demand LLM sentiment for visible News batches, with per-article
  caching and transparent classical fallback.
- Structured-output portability, truncation retry, realistic request timeouts,
  and explicit fresh regeneration of cached AI research.
- Portfolio and PostgreSQL correctness fixes described in `CHANGELOG.md`.

## Active product work

These are the clearest remaining items from the current roadmap and code state.
They are not ordered unless a maintainer explicitly assigns priority.

- [ ] **Second Brain depth after v1.2.** Evaluate long-note chunking, proactive
      journal gaps, market-data/news corpus expansion, streaming answers, and
      per-source filters as independently scoped work; none was a v1.2 release
      requirement.
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

- [x] Curate the v1.2 changelog and align the backend/frontend version contract.
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
