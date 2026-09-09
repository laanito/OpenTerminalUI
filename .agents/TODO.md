# Current project state and backlog

Last audited: **2026-09-07**, from `main` at `1d2f3ca` (PR #126), plus the
post-release handoff changes on this branch. The latest tag and published GitHub
release are **v1.5.0** at `1d2f3ca`.

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
- [x] Remove verified dead/duplicate UI and obsolete backend paths, preserving
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
      have now been adjudicated: Economics is configuration-gated; ETF Analytics,
      Statistical Lab, and Pair Trading have supported real-data computation
      contracts; installation-global Model Lab and Portfolio Lab workflows are
      hidden from discovery with explicit direct-route warnings. Duplicate
      backend mounts, the shadowed Volume Profile implementation, redundant
      frontend wrappers, and duplicate lab route trees are now consolidated;
      intentional Backtest and Screener generations are recorded.
- [x] Align `docs/wiki/Limitations.md` with the resulting product surface. The
      sidebar and Home launcher now identify configuration-gated destinations,
      and Settings distinguishes host-managed provider secrets from automation
      API keys.
- [x] Close user-test release blockers: keep browser AI deadlines beyond the
      backend model timeout, disable direct public NSE scraping by default, and
      open a process-level circuit on the first opted-in NSE 403.
- [x] Close private-record capture gaps: expose Journal in the active icon rail
      and GO bar, make portfolio descriptions visibly editable as Second Brain
      theses, and return portfolio/position/transaction citations to Portfolio
      Manager rather than the unrelated installation-global Portfolio Lab.
- [x] Make shared AI insight cards tolerate one malformed structured response
      within the existing deadline, log the real degradation cause, ground the
      Home Market Outlook in its displayed live observations, and prevent Market
      Outlook/Risk Assessment generation when their required facts are absent.
- [x] Close the automated v1.4 release contract: align backend/frontend versions,
      changelog, roadmap, public site, release ledger, and agent handoff for
      v1.4.0.
- [x] Publish v1.4.0. The maintainer completed host/user verification, release PR
      #120 merged, and tag/GitHub release `v1.4.0` point to `2999a42`.

**Exit:** every reachable page and API is intentional and truthfully classified;
the primary navigation does not advertise an unexplained empty product.

### v1.5 — fork consistency

- [x] Replace accidental upstream repository identity, stale hard-coded versions,
      clone links, and obsolete screenshots/copy across the app and documentation.
- [x] Establish the canonical fork identity and documentation hierarchy. Shared
      frontend constants now own the build-time version and
      `laanito/OpenTerminalUI` URL; the login no longer carries a v1.0.0 label;
      current docs are distinguished from historical plans and partial API notes.
- [x] Audit inherited India-first defaults in screener, backtesting, charts,
      reports, and model tooling. Keep intentional NSE/BSE/F&O support, but make
      the configured market or the global fork default drive generic workflows.
      Shared frontend/backend contracts now fall back to US/NASDAQ, while
      explicit India selections still route to NSE/BSE, INR, and NIFTY.
- [x] Finish instrument-aware currency and locale cleanup. Provider currency
      metadata now wins over symbol/exchange inference; charts, backtests,
      security financials, screeners, portfolio exposures, Journal entries, and
      India derivatives pass an explicit native currency. Failed FX conversion
      keeps both the native value and its native unit, generic surfaces no longer
      inherit `en-IN`, and mixed-currency aggregates are identified rather than
      relabelled as one currency.
- [x] Reconcile architecture, installation, contribution, API, configuration,
      and release documentation with the actual PostgreSQL-first application and
      current commands.
- [x] Remove or clearly document stale compatibility code and historical design
      documents that otherwise look authoritative.
- [x] Close the automated v1.5 release contract: align backend/frontend versions,
      changelog, roadmap, public site, release ledger, and agent handoff for
      v1.5.0.
- [x] Publish v1.5.0. Release PR #125 merged, final user testing identified and
      closed the ambiguous Portfolio holding-entry layout in PR #126, and the
      maintainer verified the result. Tag/GitHub release `v1.5.0` point to
      `1d2f3ca`.

Start with a repository-identity and documentation audit because it establishes
the names, links, commands, and sources of truth used by every later cleanup.
Then take inherited market defaults and currency/locale semantics as separate
behavioural passes with focused regression coverage. Finish by adjudicating
compatibility code and historical documents against the now-consistent product.
PR boundaries may combine adjacent findings when they share one contract; do
not turn a mechanical grep result into an unrelated omnibus rewrite.

**Exit:** a new human or agent encounters one fork identity and one accurate set
of defaults, commands, contracts, and sources of truth.

### v1.6 — stable baseline

- [ ] Rehabilitate the valuable Playwright journeys using deterministic fixtures
      and seeded authentication, then restore an appropriate browser smoke set to
      the regular gate. The foundation pass consolidated the root configuration,
      isolated database state, made auth deterministic, classified the 29 legacy
      spec files, and restored login plus authenticated shell/GO-bar coverage to
      regular Chromium CI. The next promotion replaces Backtesting's obsolete
      empty-state assertions with a deterministic submit/poll/result fixture and
      exercises its lazy equity and trade-analysis workspace in the regular
      backend-free smoke gate; promote further journeys incrementally.
- [ ] Replace per-card LLM request handling with a shared, cancellable job
      lifecycle: server-owned deadlines, provider capability detection, bounded
      retry/repair, typed failure states, and SSE or NDJSON progress/streaming
      with a stable non-streaming fallback. Publish structured insight sections
      only after schema validation, and cover interruption, malformed streams,
      slow providers, cancellation, and fallback behavior. The first lifecycle
      pass adds typed NDJSON progress, browser-to-provider cancellation, strict
      validation with bounded repair, and stable fallback for POST-based market,
      risk, portfolio, screener, and backtest cards. Cached briefing/interrogation
      GETs are abortable but still use their existing non-streaming contracts;
      provider capability-driven token streaming remains a follow-up.
- [ ] Profile and reduce initial frontend load/chunk cost and the most expensive
      news, AI, and market-data paths without weakening correctness or fallbacks.
      The first measured pass moves the decorative Three.js scene behind the
      document-load/browser-idle boundary and respects reduced-motion/data-saver;
      production entry plus router JavaScript falls from ~219.4 to ~93.2 KiB
      gzip. A route-level pass replaces the small News trend with accessible SVG
      and defers Screener visualizations until a non-table view is selected, so
      neither cold default route pulls the 134.8 KiB gzip Recharts vendor chunk.
      A third pass defers Backtesting result charts, heatmaps, mosaic UI, and 3D
      panels until a completed result exists, removing about 433.4 KiB gzip from
      the measured pre-run route path.
      Further route-level and expensive data-path profiling remains.
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

- v1.4.0 is released at `2999a42`. Its implementation and documentation sequence
  is complete: surfaces are classified, empty products are hidden, compatibility
  boundaries are explicit, ownerless watchlists and verified duplicates/orphans
  are removed, and configuration-gated navigation explains its deployment
  requirements. User testing identified and closed slow-AI and repeated-NSE-403
  release blockers in PR #117. PR #118 then exposed Journal and portfolio-thesis
  capture and repaired Brain citation destinations. Continued live testing found
  that a healthy Gemma provider intermittently returned malformed structured
  output and that Home/Risk cards could ask for analysis without factual inputs;
  PR #119 added a bounded retry and factual generation gates. Release PR #120,
  maintainer verification, tag, and GitHub release completed the milestone.
  v1.5 PR #122 completed repository identity and documentation reconciliation;
  PR #123 moved generic workflows to shared US/NASDAQ defaults while preserving
  explicit India behavior; PR #124 completed instrument-aware currency and locale
  semantics. Release PR #125 completed automated preparation. Final user testing
  then found that the newly adjacent portfolio thesis left holding-entry fields
  ambiguous; PR #126 added visible labels, semantic grouping, and a responsive
  layout. The maintainer verified the fix, and tag/GitHub release `v1.5.0` were
  published from `1d2f3ca`. v1.6 is now active; start from its explicit baseline
  items rather than implementing data stubs merely to make the inventory fuller.
- Hermes-style pipelines can already send selected summaries through
  `PUT /api/v1/notes/external` with a `read_write` API key and stable
  source/external ID. Do not design a broad MCP surface unless it is explicitly
  prioritised; provenance and permission semantics remain the prerequisite.
- A bilingual v1.3 retrospective was merged in `praderasblog` PR #104. Blog
  deployment belongs to the host agent and is outside this repository's scope.
  The bilingual v1.4 retrospective was merged as PR #108, series order 11.
  The bilingual v1.5 retrospective is open as PR #109, series order 12.

## Other product work

These are the clearest remaining items from the current roadmap and code state.
They are demand-pulled or later-generation inputs, not a substitute for the
ordered v1.6 milestone above.

- [ ] **Relative Strength engine.** Replace the intentionally degraded `/rs/*`
      endpoints with a real, tested IBD-style computation. Never restore the old
      fabricated Indian rankings.
- [ ] **Rewrite/rehabilitate Playwright E2E.** A small deterministic Chromium
      smoke set now gates PRs. The remaining specs are classified in
      `frontend/tests/e2e/README.md`; update their fixtures and assertions before
      promoting them from the manual suite.
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
- [x] Refresh `docs/wiki/Architecture.md` for the PostgreSQL-first deployment,
      SQLite sidecar/fallback roles, current migration paths, auth boundary, and
      owner-scoped research architecture.
- [x] Reconcile contributor setup, CI, and `make gate`; remove the missing
      `backend/requirements-dev.txt` command and keep Playwright explicitly
      manual-only.
- [x] Refresh `docs/wiki/Limitations.md` for post-v1.0/v1.1 behaviour and verify
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
