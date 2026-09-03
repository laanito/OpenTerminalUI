# Current project state and backlog

Last audited: **2026-09-03**, against `main` at `c12ddc6` (PR #103; latest
release remains `v1.3.0` at `293f911`).

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

### v1.3.0 — the second brain gets depth

Released 2026-09-02. The implementation landed through PRs #96–#101 and release
preparation through PR #102. The release is tagged and published; there is no
remaining v1.3 release task.

- [x] **Chunk long sources deterministically.** Long notes and journal text are
      split into bounded, lightly overlapping chunks with stable internal keys;
      citation metadata retains the original source record and chunk index.
      Reindexing embeds only new/changed chunks, persists replacements before
      pruning stale rows, and uses the same storage path for SQLite and
      PostgreSQL/pgvector.
- [x] **Make retrieval source-aware and inspectable.** The ask API validates
      filters for notes, journal, portfolio theses, holding notes, and transaction
      notes; status exposes per-source indexed chunk counts; and the Second Brain
      shows selectable source chips plus the evidence scope attached to each
      answer. Omitted filters still search all of the user's own writing.
- [x] **Stream synthesis without weakening fallbacks.** Compatible OpenAI-style
      providers stream incremental answers through `/api/brain/ask/stream`, while
      the existing non-streaming `/api/brain/ask` contract remains unchanged.
      Retrieval-only and model-unavailable paths emit complete, honestly labelled
      results, and interrupted browser streams retry through the stable endpoint.
- [x] **Accept deliberate external note capture.** A `read_write` API key can
      idempotently upsert an owner-scoped note through
      `PUT /api/v1/notes/external`, keyed by a short source and external ID. This
      supports pipelines such as Hermes summaries of selected YouTube videos and
      schedules normal Second Brain reindexing without exposing browser JWTs.
- [x] **Add an explicit journal-gap review.** The Journal page now runs an
      explicitly requested, deterministic completeness review that identifies
      missing rationale, outcomes, emotions, setup labels, or thesis
      updates and opens the relevant owner-scoped entry for editing. It does not
      run silently, invent missing facts, issue trade directives, or become a
      background notification engine.
- [x] **Close the automated release contract.** Tests cover chunk boundaries,
      incremental pruning, source filters, ownership, SQLite/pgvector query
      parity, stream interruption, provider degradation, and frontend fallback
      behaviour. User docs, changelog, and backend/frontend versions are aligned
      for v1.3.0.
- [x] **Publish v1.3.0.** The release-prep branch merged, the maintainer
      authorised the release after the verification sequence, and tag/release
      `v1.3.0` points to `293f911`.

Explicitly out of v1.3: general MCP tooling, automatic external market/news corpus
indexing, autonomous advice or trading, cross-user retrieval, the Relative
Strength engine, paid market-data adapters, and general dashboard coverage work.

## Remaining v1 plan — consolidate the fork

The maintainer selected **a coherent, honest fork** as the v1 completion promise.
Do not pull unrelated feature ideas into v1 merely because they are listed in the
continuous backlog. The work proceeds in three minor-release arcs; exact PR
boundaries should follow the audit rather than being guessed in advance.

### v1.4 — surface truth

- [x] Inventory every navigable frontend destination and public backend API
      family, including duplicated, orphaned, compatibility, and experimental
      paths. The baseline is recorded in `docs/wiki/Surface-Inventory.md` and
      `docs/surface-inventory.json`; keep the OpenAPI-tag check passing.
- [x] Classify each exposed feature as **supported**, **configuration-gated**,
      **experimental**, **hidden**, or **remove**. Record the user-visible contract
      and owner for every retained degraded surface.
- [x] Decide each current stub explicitly: Relative Strength, bonds/fixed-income
      screening, hotlists, insider ingestion, ETF flows, tape/time-and-sales,
      US/EU Level-2, crypto liquidations, and the sample economic calendar. A
      decision may be to implement, gate, hide, or remove; v1 does not require
      buying or inventing a feed. Five wholly empty standalone products are now
      hidden from primary navigation; useful mixed surfaces remain classified
      with their narrower limitation.
- [ ] Remove verified dead/duplicate UI and obsolete backend paths, preserving
      compatibility aliases only when they serve a documented consumer. Add
      regression coverage for changed navigation and contracts. The first four
      orphan pages and the page-only Breakout Scanner component/test island have
      been removed. Cockpit is now hidden from discovery: its compatibility API
      returns explicit empty/degraded sections instead of fabricated portfolio,
      risk, and event values. Plugins are also hidden from general discovery and
      their process-wide lifecycle is admin-only; repeated discovery now preserves
      enabled runtime state. OMS and Ops are hidden compatibility tools: invented
      operational panels were removed, OMS data/audit are user-scoped, and global
      compliance controls are admin-only. The remaining experimental destinations
      and backend duplicates remain to be adjudicated.
- [ ] Align `docs/wiki/Limitations.md` with the resulting product surface.

**Exit:** every reachable page and API is intentional and truthfully classified;
the primary navigation does not advertise an unexplained empty product.

### v1.5 — fork consistency

- [ ] Replace accidental upstream repository identity, stale hard-coded versions,
      clone links, and obsolete screenshots/copy across the app and documentation.
- [ ] Audit inherited India-first defaults in screener, backtesting, charts,
      reports, and model tooling. Keep intentional NSE/BSE/F&O support, but make
      the configured market or the global fork default drive generic workflows.
- [ ] Finish instrument-aware currency and locale cleanup. Never relabel an
      unconverted value or apply an India-specific grouping format globally.
- [ ] Reconcile architecture, installation, contribution, API, configuration,
      and release documentation with the actual PostgreSQL-first application and
      current commands.
- [ ] Remove or clearly document stale compatibility code and historical design
      documents that otherwise look authoritative.

**Exit:** a new human or agent encounters one fork identity and one accurate set
of defaults, commands, contracts, and sources of truth.

### v1.6 — stable baseline

- [ ] Rehabilitate the valuable Playwright journeys using deterministic fixtures
      and seeded authentication, then restore an appropriate browser smoke set to
      the regular gate.
- [ ] Profile and reduce initial frontend load/chunk cost and the most expensive
      news, AI, and market-data paths without weakening correctness or fallbacks.
- [ ] Expand high-risk SQLite/PostgreSQL, provider-failure, navigation, portfolio,
      scanner, and chart regression coverage identified by the v1.4 audit.
- [ ] Complete the public API reference, supported/configured/degraded feature
      matrix, clean-install verification, and final v1 release checklist.
- [ ] Convert the accepted v2 cross-market-intelligence promise into concrete
      user journeys and contracts only after the consolidated v1 surface is known.

**Exit:** the retained fork installs, documents, navigates, degrades, and tests as
one dependable product; v2 can build across intentional interfaces rather than
inherited ambiguity.

## Current handoff boundary

- v1.3.0 is complete. The next product work starts with the v1.4 inventory and
  classification; do not begin by arbitrarily implementing the first data stub.
- Hermes-style pipelines can already send selected summaries through
  `PUT /api/v1/notes/external` with a `read_write` API key and stable
  source/external ID. Do not design a broad MCP surface unless it is explicitly
  prioritised; provenance and permission semantics remain the prerequisite.
- A bilingual v1.3 retrospective was merged in `praderasblog` PR #104. Blog
  deployment belongs to the host agent and is outside this repository's scope.

## Other product work

These are the clearest remaining items from the current roadmap and code state.
They are inputs to the v1.4 classification or later product generations, not an
ordered implementation queue.

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
