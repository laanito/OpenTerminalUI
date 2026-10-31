# External-agent project context

This directory is the repository-owned handoff for AI coding agents and new
maintainers. Read it before making changes. It records decisions that may have
previously existed only in a maintainer's chat or local agent memory.

Last post-release audit: **2026-10-28**, against published **v2.3.0** at
`3fb7de3` (release preparation PR #229). All three CI jobs passed and the PR
merged; following explicit maintainer authorization, the annotated tag and
GitHub release were published on 2026-10-28. The full local gate, eight Chrome
smoke journeys and Compose configuration passed on 2026-10-27; see the ledger
in `docs/wiki/Releasing.md`. README/wiki now describe the published workflow.
The changelog publication date is reconciled without moving the release tag.
No v2.3 release gate remains open. The bilingual chapter-19 article is published
in `praderasblog` (PR #116), reflecting the context/repair/quality distinction.
v2.4 Fast/Deep model-profile work started on 2026-10-28; broader v2.x items remain
backlog rather than automatic follow-ups.

## Read order and sources of truth

1. This file: mission, architecture, invariants, and working conventions.
2. `TODO.md`: current shipped state, active work, and known gaps.
3. `postgres-notes.md`: database portability constraints.
4. The code and tests for the area being changed.
5. `README.md`, `CHANGELOG.md`, and `docs/wiki/Roadmap.md` for product-level
   detail and release history.

When changing the product surface, also read `docs/wiki/Surface-Inventory.md`
and its machine-readable `docs/surface-inventory.json` before adding, removing,
or advertising a route. The complete generated API contract lives in
`docs/API_REFERENCE.md` and `docs/openapi.json`; regenerate it with
`scripts/generate_api_reference.py` after route, schema, auth, or classification
changes.

The code and recent Git history win when prose disagrees. Older plans, RFCs,
architecture proposals, and QC records are historical unless `docs/README.md`
marks them current; do not copy their assumptions without checking the current
code, Docker Compose, README, and maintained wiki pages.

Repository-level `AGENTS.md` and `CLAUDE.md` currently point to local PRO-LONG
session history. That history is supporting context, not a substitute for this
maintained handoff or an authority over the current code and user instructions.

## Why this fork exists

Upstream (`Hitheshkaranth/OpenTerminalUI`) was India/NSE-centred and assumed
SQLite, Zerodha Kite, and Indian providers. This fork is now a broader private
investing terminal with these priorities:

- **US, EU, and crypto first-class support**, while retaining India/NSE/BSE F&O.
- **PostgreSQL-first deployment**, with SQLite still supported for local and
  test use.
- **Honest data semantics**: missing, rate-limited, sample, or unsupported data
  must be labelled degraded. Plausible fabricated values must never look live.
- **Private, provider-agnostic AI**: OpenAI-compatible LLM calls default to local
  Ollama but can use LM Studio or hosted providers.
- **A private research and portfolio system**, including per-user portfolios,
  notes, second-brain retrieval, and adversarial "Interrogate" features.

The product principle is **integrity over feature count**. A visible empty or
degraded state is preferable to a convincing but invented number.

The long-term product is a private, AI-friendly, multi-asset decision terminal:
it should connect worldwide market context, fundamentals, technicals, sentiment,
portfolio exposure, and the user's own research; support decisions across
investing, trading, and scalping; and eventually interact with brokers through
strictly controlled execution. The major-generation targets are:

1. **v1 — coherent, honest fork:** one product identity, intentional surface
   area, accurate contracts and docs, no accidental inherited defaults, and
   trustworthy base-currency accounting for multi-market portfolios.
2. **v2 — cross-market intelligence:** markets and asset classes explain one
   another rather than existing as isolated screens.
3. **v3 — multi-dimensional validation:** fundamentals, technicals, sentiment,
   regime, portfolio context, and private evidence converge on an opportunity.
4. **v4 — decision lifecycle:** evidence, thesis, decision, position, outcome,
   and review form one traceable loop.
5. **v5 — multiple horizons and instruments:** investing, swing trading,
   intraday/scalping, spot, and leveraged products have coherent workflows and
   risk semantics.
6. **v6 — agent-native terminal:** external models receive stable, scoped APIs
   for reading, investigating, ingesting, and proposing.
7. **v7 — controlled execution:** broker sync progresses from read-only and
   paper workflows to approval-gated, auditable, bounded automation.

These are dominant product promises, not silos. Existing journal, derivatives,
and Hermes ingestion work are foundations for later generations, not evidence
that those generations are complete. `docs/wiki/Roadmap.md` is canonical for the
release-level interpretation and safety boundaries.

## Current release and development state

- **v2.3.0 released — Context beyond price.** Extend the selected comparison
  briefing with explicitly included dated headlines and existing US/euro-area
  macro observations, preserving scope, source links, actual pair windows,
  current-vintage/reference-period semantics and failures. First slice is a pure
  deterministic context projection in `market_briefing_context_evidence.py`:
  selected regions are never inferred from tickers, headline text is untrusted,
  values/flags/counts survive bounded projection, and references are local to a
  separately fingerprinted envelope. Its nested v2.2 price packet keeps its
  original price-only scope. Separate JWT-only `/briefing-context-evidence`,
  `/briefing-context` and `/briefing-context/stream` endpoints now collect selected
  sources and synthesize observations/possible context/limitations/unknowns.
  Context collection is bounded to 40s, 12s per source, three concurrent jobs;
  identical macro region/window requests share one fetch within the operation.
  Price preparation retains 45s and model health/completion/one repair share the
  configured LLM deadline. Exact references, linked pairs and coverage are checked,
  not prose truth. Evidence above 120,000 serialized characters is rejected for
  synthesis without silent trimming; model failure retains the entire envelope.
  Closing either briefing stream immediately cancels/joins its operation. The
  browser now defaults to price-only and offers independent news, US FRED and
  euro-area macro opt-ins. Scope/selection changes abort and clear old work;
  the shared stream reader includes the context budget without silent replay.
  Coverage/failures stay beside prose, with keyboard-focusable section/group/
  headline/series citations, safe source links, exact values/counts/flags and
  separate outer/price snapshot IDs. Browser shape/reference checks do not
  fact-check prose. Desktop/narrow Chrome journeys and deterministic frontend
  tests cover the richer and degraded paths. Release PR #229 passed all three
  CI jobs and merged; publication is complete. Host feedback on
  2026-10-27 confirmed price-only works but news+macro hit validation failure
  after repair; the old logs did not capture which check failed. Context prompts
  now include validator-derived reference obligations, and the single repair
  gets safe reason codes/schema paths/required server IDs. Both attempts log
  these diagnostics without rejected prose/provider secrets. The maintainer
  confirmed the news+macro retest completed after repair on 2026-10-27; attempt 1
  logged `context_source_pair`. This does not diagnose the older uninstrumented
  failure or certify prose quality. Shallow extraction/reasoning on the fast
  model remains a limitation; Fast/Deep task routing is approved for v2.4, not
  a new v2.3 gate. Do not relax validation. No persistence
  or indexing is added; v2.2 request/result shapes stay price-only. Fundamentals,
  technicals, private notes, portfolio-wide context, discovery, saving and new
  provider acquisition are excluded. Calendar-provider reliability and historical
  vintage/release audits are not gates on this milestone.
- **v2.4 in development — Task-appropriate models.** After v2.3
  closure, add named Fast/Deep generation profiles with explicit task routing,
  independent model/endpoint/credentials/timeout, legacy `LLM_*` compatibility,
  consistent deadlines and visible resolved identity. Deep failure must not
  silently substitute Fast; credentials must not leak across endpoints.
  Embeddings remain independent. Evaluate representative tasks for usefulness,
  fidelity and latency, not only structure. No model deployment, autonomous
  escalation, new evidence providers or broader validation features. See the
  Roadmap and TODO before continuing. First slice adds validated optional Deep
  settings, task map/resolver and `get_llm_client(task=...)`. Comparison briefings
  (price-only and selected context) now resolve Deep once and share that snapshot
  across transport, health, bounded repair, deadline announcements and visible
  model identity. Default single-model operation stays explicit when Deep is
  unset; configured Deep failures never retry Fast. Shared stock/Interrogate,
  market/collection outlooks, risk and backtest insights now also use Deep with
  one profile across health, requests, repair, identity and deadlines. Their
  browser cards share a cancellable lifecycle, including research GET-compatible
  surfaces; total operation budget is model timeout plus 60 seconds preparation
  allowance, with 15 seconds browser margin. Interrupted runs never replay;
  manual retry is explicit. Research caches hash profile configuration and retain
  owner/note-version isolation; failed insights are not cached. Embeddings stay
  on the legacy factory. Explicit Deep URLs never inherit
  Fast keys; when the Deep URL is omitted, the existing endpoint/key may be
  inherited. Shared insight host testing after #234 confirmed it works as intended.
  Brain synthesis is now integrated: one selected profile spans retrieval gating,
  completion, streaming/fallback, identity and deadlines. `queued` announces an
  overall model-timeout-plus-120-second preparation allowance before retrieval;
  the producer owns model/operation deadlines across heartbeat reads. The browser
  adds 15 seconds of margin, supports Cancel and never replays interrupted runs.
  Completed Brain Log saves retain the actual model through existing fields;
  provider labels are generic classes, not hostnames. There is no Brain answer
  cache, database migration or embedding/indexing change. After #235 the maintainer
  confirmed Brain works as intended. Filing analysis is now integrated separately:
  one profile/deadline, typed output checks and explicit lexical fallback reasons.
  A portable, lazily created `stock_conviction_provenance` companion table stores
  model/failure metadata atomically with the existing report. No old columns,
  catalyst JSON, engine labels or historical model provenance are rewritten.
  New model output uses engine `llm`; old `lmstudio` rows remain unknown-provenance.
  A cancellable ingest lifecycle/browser helper honors announced budgets without
  replay. The saved-report panel labels model/lexical/legacy states; no new
  ingestion UI or provider is added. This remains an experimental global report,
  not private Brain evidence or SEC fact verification. SQLite persistence and
  PostgreSQL DDL compilation are checked; no live PostgreSQL rollout is claimed.
  After #236 the maintainer confirmed filing integration works as expected.
  News sentiment, stock emotion and query intent now explicitly resolve Fast;
  health/generation share one model deadline and browser lifecycles announce
  identity/budgets without automatic replay. Sentiment/emotion caches hash Fast
  configuration; Deep-only changes do not invalidate them. Query rate limits use
  the authenticated owner. After #237 the maintainer confirmed the Fast slice
  worked as intended (2026-10-31). All twelve generation tasks are integrated
  and operationally accepted. Next: representative quality/latency evaluation
  and exit checks. `Briefing-Evaluation.md` records host acceptance separately
  from the remaining cross-task review; no measured timings are available yet.
  On 2026-10-29 the maintainer confirmed Deep routing works, but found briefings
  too descriptive. Approved quality follow-up: structured `hypotheses` now
  separate interpretations, conditional mechanisms, competing explanations and
  distinguishing evidence. Citations anchor observed inputs, not mechanisms;
  established causal attribution/recommendations remain excluded. Both validators
  and UI implement this contract; initial price/context budgets are 3,200/6,400 tokens
  under the same profile deadline. After merging #233 the maintainer confirmed
  the briefing works better, accepting the initial improvement. The scenario
  guide remains in `docs/wiki/Briefing-Evaluation.md`; do not claim an exhaustive
  audit or that tests certify reasoning quality.
- **v2.2.0 released — Grounded Comparison Briefing.** The agreed outcome is
  on-demand cited synthesis of a selected comparison, with observations, possible
  context, conflicts and unknowns kept distinct. No causal explanations, trade
  advice, automatic discovery or portfolio-wide context. The first API slice
  builds fingerprinted shared-UTC provider-close evidence on the server. Separate
  `/briefing` and `/briefing/stream` APIs now add on-demand synthesis with strict
  structure, snapshot identity and citation-reference checks, bounded health/
  generation/repair and cancellable progress streaming. Reference validity is
  not semantic fact-checking; preserve the fixed scope notice and original
  evidence/caveats. Optional panels, persistence and indexing remain excluded.
  The comparison browser now offers explicit generation, progress/cancellation,
  manual retries, plain-text results and citation-to-snapshot inspection. Draft
  or applied selection changes invalidate prior work; failed retries retain no
  old prose. No automatic stream replay or saving/indexing. The maintainer
  accepted the live briefing and confirmed the crypto quote fix after PR #221
  on 2026-10-21. Model capability may merit later work but is explicitly outside
  this milestone. The local gate passed with 74.90% backend coverage, 447 frontend
  tests and six Chrome smoke tests. PR #222 passed build-and-test, clean-install
  and PostgreSQL-contract CI and merged. With explicit maintainer authorization,
  the annotated tag and GitHub release were published from `039c395` on 2026-10-21.
- Latest published release: **v2.3.0**, tagged and published from `3fb7de3` on
  2026-10-28 after green release-prep CI and explicit maintainer authorization.
  Keep `backend/config/settings.py` and `frontend/package.json` in lockstep when
  releasing.
- **v2.0 shipped the bounded cross-market context feature**, alongside the
  completed time-aware Brain and Brain Log foundations. Release preparation
  and host acceptance are complete, including the final proxy-suggestion click
  fix. The broader fundamentals-vintage, macro-release, technical-session,
  automatic relationship, portfolio-context, and AI-interpretation ambitions
  are later v2.x candidates (or v3 validation work), not implicit pre-release
  PRs. See the explicit v2.0 gate in `TODO.md` and `docs/wiki/Roadmap.md`.
- **v2.1 shipped filing-grounded US fundamentals:** `POST /api/market-context/sec-filing-fact-check`
  checks one selected current Company Facts claim against an official,
  archive-listed XBRL instance. It requires exact issuer/concept/unit/duration
  evidence, returns source links and explicit failure/conflict states, and
  bounds document size, parser complexity and request duration. The comparison
  browser offers **Check source filing** below each fact and each same-period
  differing disclosure. Exact values, source links, dated results and manual
  retries are visible; the request has a 60-second browser timeout and cancels
  on unmount. Checks remain opt-in without focus/reconnect refetches.
  The maintainer confirmed the NVDA filing journey after PR #215 fixed SEC
  label markup and padded CIK formats. PR #216 passed all three CI jobs and
  merged; explicit maintainer authorization preceded the published tag/release.
  It does not claim a full historical
  vintage or make fundamentals explain past price moves. See `TODO.md` and
  `docs/wiki/Roadmap.md` for the bounded v2.1 scope.
- **v2 opens with time-aware private memory.** Semantic similarity alone must
  not flatten current and historical beliefs. Second Brain evidence carries
  effective, recorded, and updated timestamps; retrieval may give bounded weight
  to recency only inside a semantically relevant candidate set; synthesis treats
  newer conflicting evidence about the same subject as current while retaining
  the older view as cited history. Manual Notes capture can set or clear the
  effective time, and its loading, failure, and queued-indexing states are
  visible; manual Brain reindexing also reports progress and final chunk totals.
  The owner-scoped **Brain Log** storage/API foundation now saves completed
  answers as immutable research memos with dated citation/content snapshots and
  model provenance. Organization metadata is editable; answer/evidence snapshots
  are not. Memos stay out of retrieval by default. The browser Second Brain
  page now saves completed answers and exposes the Brain Log for reading and
  organizing them. A reviewed **Promote to Note** action creates a separate,
  editable Note with a link back to its source memo; only that Note becomes
  evidence. Opening a memo compares its cited chunk identities with live source
  records without depending on the embedding index, and distinguishes changed,
  unavailable, and unverifiable evidence. This is not fact-checking the answer.
  Theses and Journal remain
  canonical user-owned records. This is an iterative contract to evaluate
  against the growing Hermes corpus before cross-market synthesis relies on it.
  `docs/wiki/Brain-Retrieval-Evaluation.md` describes the read-only retrieval
  runner; no real Hermes case file is checked in, so tuning remains open.
- **v1.7.0 — multi-currency portfolio accounting** completed the v1 arc.
  It promotes the existing portfolio currency to an explicit reporting base,
  persists transaction/native currency semantics, and normalizes ledger and
  analytics results using traceable current and historical FX rates. Missing
  conversions must remain partial/degraded rather than produce false totals.
  Implementation has established the traceable current/historical FX resolver
  and explicit nullable holding, transaction, and fee currency evidence; legacy
  rows remain unknown. Portfolio list, detail, and Manager analytics now share a
  backend base-currency engine with native evidence and explicit
  complete/degraded/partial results, and Portfolio Manager renders that contract.
  Primary dashboard summaries, Home, Cockpit, Launchpad, current allocation, and
  position exports are aligned as well. Deep risk and benchmark history now use
  dated base-currency observations, while attribution separates security, FX,
  and interaction returns. The endpoints explicitly describe their current-open-
  holdings methodology and withhold unsupported history. Implementation and
  automated release preparation are complete through PR #146. Host testing then
  exposed an unactionable legacy-currency state; PR #147 added explicit,
  owner-scoped repair controls and passed functional host testing. PR #148 then
  moved those controls from crowded value cells to row actions and a focused
  dialog after UX feedback. The repeated host smoke, tag, and GitHub release are
  complete.
- **v1.3 — The second brain gets depth** shipped
  deterministic long-note chunking, source-aware retrieval, progressive answers,
  deliberate API-key note ingestion, and an explicit journal-gap review. Feature
  work, release verification, tag, and GitHub release are complete. The release
  gate recorded 817 backend tests and 296 frontend tests, plus compile, build,
  production-mock, and Compose checks.
- The v1 arc is **fork consolidation and accounting truth**: v1.4 audited and
  pruned the exposed surface, v1.5 made identity/defaults/contracts consistent,
  v1.6 established the stable baseline, and v1.7 closes trustworthy backend
  base-currency accounting. v2 cross-market intelligence is the next arc.
  The v1.4 inventory, stub decisions, initial orphan removal, and hidden
  compatibility hardening have landed; primary experimental destinations are
  now adjudicated. Watchlists and their reports/dividend views are owner-scoped;
  background workers receive only a symbol union, and the old flat global model,
  API, and table are gone. Duplicate backend mounts and frontend lab route trees
  are consolidated; intentional Backtest/Screener generations are recorded in
  the surface inventory. Limitations and user-facing configuration cues now
  match the retained surface, completing the v1.4 implementation sequence.
  Final user-test blockers extend the browser deadline beyond the backend LLM
  timeout and make direct public NSE scraping opt-in with a first-403 process
  circuit. PR #117 merged those reliability fixes; PR #118 made Journal and
  portfolio-thesis capture discoverable and corrected Brain citation routes.
  Live testing then exposed intermittent malformed JSON from a healthy local
  Gemma provider and ungrounded Home/Risk generation when their facts were
  absent; PR #119 added one bounded structured-output retry and factual input
  gates. The maintainer completed live verification, release PR #120 merged,
  and `v1.4.0` was tagged and published at `2999a42`. **v1.5 — Fork
  consistency** shipped in v1.5.0. PR #122 established canonical fork
  identity, package-derived frontend versioning, the documentation hierarchy,
  and current PostgreSQL-first setup/contribution contracts. PR #123 centralized
  US/NASDAQ as the fallback for generic screens, backtests, charts, reports,
  labs, and model tools while preserving selected NSE/BSE behavior. The current
  currency/locale pass makes provider instrument metadata authoritative, keeps
  native labels when FX is unavailable, confines Indian grouping to intentional
  India contexts, and identifies mixed-currency aggregates. The implementation
  and automated v1.5.0 release preparation completed in PR #125. Final user
  testing found ambiguous unlabelled holding-entry fields beside the newly
  visible portfolio thesis; PR #126 added persistent labels and a responsive
  layout. The maintainer verified the fix, and `v1.5.0` was tagged and published
  at `1d2f3ca`. **v1.6 — Stable baseline** implementation and automated
  verification completed through PR #137: deterministic browser journeys,
  resilient streamed insight jobs, cold-route reductions, PostgreSQL parity,
  the generated API contract, and a disposable clean-install gate. Automated
  release preparation landed in PR #138. Host/user testing then found the API-key
  list response mismatch; PR #139 fixed it without a migration and passed the
  full gate. Tag and GitHub release `v1.6.0` were published from `0dc86db`.
  **v1.7 — Multi-currency portfolio accounting** implementation completed
  through PR #145: explicit ledger currencies, traceable current/historical FX,
  shared current accounting, aligned consumers, base-currency history, and
  security-versus-FX attribution. Release preparation merged in PR #146. Host
  testing then found that conservatively unknown legacy currencies could not be
  repaired in the UI; PR #147 added per-record holding, transaction, and fee
  currency repair. Host testing confirmed the behavior but rejected the crowded
  inline UI; PR #148 moved repair into row actions and a focused dialog. The
  maintainer verified the result, and `v1.7.0` was tagged and published from
  `0473307` on 2026-09-15.
- General MCP tooling and automatic external market/news indexing remain
  deferred. The supported automation boundary is the authenticated, idempotent
  external-note endpoint intended for deliberate inputs such as Hermes YouTube
  summaries.
- The real Relative Strength engine and broader depth/coverage work remain
  separate backlog rather than v1.3 release gates.
- The old `.agents/TODO.md` snapshot stopped around PR #17. Its Ollama, EUR,
  crypto tick, and early frontend-audit tasks have all shipped and must not be
  treated as current work.
- See `TODO.md` for the current backlog. Before starting any backlog item, check
  `git log`, the implementation, and tests in case it landed without a doc edit.

The v1.3 collaboration retrospective was merged into `praderasblog` as PR #104,
series order 10: **“When a Second Brain Learns to Grow.”** The v1.4 retrospective
followed in PR #108, series order 11: **“The Release That Learned to Say No.”**
The bilingual v1.5 retrospective followed as `praderasblog` PR #109, series order
12: **“The Terminal Learns Where It Stands.”** The series continued through
v1.6/v1.7, the Second Brain goals essay and the published v2.0 retrospective,
series order 16: **“A Market Comparison That Knows Its Limits.”** New release
articles belong in the sibling `../praderasblog` repository under its own
authoring instructions; confirm its current series order before adding a post.
These are narrative context, not engineering sources of truth; deployment is
handled separately on the blog host after merge.

## Architecture at a glance

### Backend

- Python 3.11, FastAPI, Pydantic, SQLAlchemy, and Alembic.
- The app entry point is `backend/main.py`; router composition is in
  `backend/api/router.py`.
- Thin route handlers live mainly in `backend/api/routes/`; business logic lives
  in `backend/services/`, with additional domain packages such as `equity/`,
  `fno/`, `portfolio_lab/`, `risk_engine/`, and `screener/`.
- PostgreSQL 16 is the Docker default. SQLite remains the code-level fallback
  and is used by tests and dedicated sidecar caches.
- Redis provides optional caching, pub/sub, and quote distribution.
- Alembic migrations live in `backend/alembic/versions/`.

### Frontend

- React 18, TypeScript, Vite, Tailwind, TanStack Query, and Zustand.
- Pages live in `frontend/src/pages/`, API clients in `frontend/src/api/`, shared
  state in `frontend/src/store/`, and real-time subscriptions in
  `frontend/src/realtime/`.
- Charts use Lightweight Charts; other visualisations use Recharts, Nivo, and
  Three.js where appropriate.

### Market data and providers

- Search uses the `instrument_master` universe: US Nasdaq Trader data, EU
  `pytickersymbols`, crypto CoinGecko data, plus a live Yahoo fallback.
- US/EU quotes and charts use provider fallbacks including Yahoo, FMP, and
  Finnhub. Crypto uses CoinGecko/Binance/Yahoo as appropriate. India uses
  Kite/NSE providers where credentials are available.
- Live ticks are normalised and distributed through the quote hub and
  `/api/ws/quotes`. Binance supplies crypto spot ticks.
- External-client work must preserve retry/backoff, circuit-breaker, cache, and
  degraded-response behaviour. Never cache provider 429/5xx responses.

### AI and private research

- `backend/services/llm_client.py` is the provider-agnostic OpenAI-compatible
  client. Defaults point to Ollama; legacy LM Studio aliases remain supported.
- Structured-output support must work with providers that ignore
  `response_format`; the JSON schema is also carried in the prompt, and truncated
  structured calls can be retried with a larger budget.
- Notes and second-brain data are user-private. PostgreSQL uses pgvector when
  available; SQLite uses in-process cosine similarity. Do not weaken ownership
  checks or leak one user's notes/portfolio data to another.

## Engineering invariants

1. **No fake live data.** Use the shared degraded marker and frontend degraded
   banner. Keep `scripts/check_no_production_mocks.py` passing.
2. **Preserve SQLite and PostgreSQL portability.** Prefer SQLAlchemy/Alembic over
   raw SQL. When raw SQL is unavoidable, follow `postgres-notes.md` and use
   `backend/shared/sql_compat.py`.
3. **Keep Alembic revision IDs at most 32 characters.** PostgreSQL enforces the
   `alembic_version.version_num` width.
4. **Portfolios are per-user.** The legacy global `Holding`/`TaxLot` system was
   removed in v1.1. Use the owner-checked `/api/portfolios` system and the
   per-user primary portfolio.
   Watchlists follow the same rule: supported clients use `/api/watchlists`.
   Installation-wide workers may use only the shared symbol-union helper; do not
   recreate an ownerless watchlist model or API.
5. **Cash derives from the transaction ledger.** Do not introduce a competing
   mutable cash balance. Sells must update both the ledger and holdings.
6. **Currency must be instrument-aware.** A display-currency selection is not
   permission to relabel an unconverted value. If conversion is unavailable,
   show the native currency honestly.
7. **Provider failures are normal.** Missing keys, quotas, geoblocking, and
   unavailable feeds should degrade cleanly rather than crash or fabricate.
8. **Do not commit secrets or `.env`.** Document new settings in `.env.example`
   and the README.
9. **Do not revive retired global portfolio or tax-lot APIs** without an explicit
   new design decision. Tax-lot accounting is deliberately out of scope because
   jurisdiction-specific wrong answers are worse than no answer.

## Development and verification

The PR CI gate uses Python 3.11 and Node 22. It runs:

```bash
python -m compileall backend
python scripts/check_no_production_mocks.py
PYTHONPATH=. python scripts/check_surface_inventory.py
PYTHONPATH=. python scripts/generate_api_reference.py --check
PYTHONPATH=. pytest backend/tests -q --cov=backend --cov-fail-under=45
cd frontend && npm ci && npm run build && npx vitest run
```

For an existing checkout with dependencies installed, `make gate` runs the
mock/surface/API guards, backend compile/tests with coverage, frontend build and
Vitest. Browser smoke runs separately locally and in regular CI; CI also runs
disposable PostgreSQL contracts and a fresh-install job. Run focused tests during
development, then the broadest relevant checks before handing off.

The maintainer's macOS workstation has Chrome installed at
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` and exposes a
Chrome CDP endpoint at `http://127.0.0.1:9222` for interactive checks. For the
existing smoke runner, set `PLAYWRIGHT_EXECUTABLE_PATH` to the installed Chrome
binary; it uses an isolated temporary profile. Check this available browser
before downloading Playwright's bundled Chromium. See
`frontend/tests/e2e/README.md` for the local command. CI uses bundled Chromium.

The deterministic Playwright `@smoke` subset is part of every PR gate. The rest
of the browser suite remains manual and is classified in
`frontend/tests/e2e/README.md`; several specs predate the 1.0 integrity/de-India
changes and need rewriting. Do not assume a legacy E2E failure is a new product
regression without checking the fixture and expectation, and do not silently
ignore genuine failures either.

Documentation-only changes do not require the full application suite, but check
links, paths, commands, spelling, and the rendered diff.

## Working conventions for agents

- Start from a clean, current `main` and use a focused branch (`feat/`, `fix/`,
  or `docs/`). Do not modify or discard unrelated user changes.
- Inspect the relevant routes, services, frontend consumers, tests, and recent
  commits before changing behaviour. The repository is large and older plans can
  be stale.
- Add or update tests for behaviour changes. Prefer focused tests first.
- Keep PRs scoped and explain degraded/fallback semantics when provider-facing
  behaviour changes.
- Update `CHANGELOG.md` for user-visible changes and update `.agents/TODO.md`
  when a tracked item lands or priorities change.
- Follow `.forge/tasks/*.json` locks when Forge tasks are present; keep
  `auto_commit` disabled unless explicitly authorised.

## Useful file map

| Concern | Location |
|---|---|
| Application entry / lifespan | `backend/main.py` |
| API router composition | `backend/api/router.py` |
| Configuration | `backend/config/settings.py`, `.env.example` |
| Database engines/sessions | `backend/db/base.py`, `backend/db/session.py` |
| Alembic migrations | `backend/alembic/versions/` |
| SQL dialect helpers | `backend/shared/sql_compat.py` |
| Degraded response helper | `backend/shared/degraded.py` |
| HTTP resilience | `backend/shared/http_resilience.py` |
| Market classification | `backend/shared/market_classifier.py` |
| LLM client | `backend/services/llm_client.py` |
| Second brain | `backend/services/brain/` |
| External note ingestion | `backend/api/routes/external_notes.py` |
| Portfolio routes/services | `backend/api/routes/portfolios.py`, `backend/services/portfolio_*` |
| News ingestion/API | `backend/bg_services/news_ingestor.py`, `backend/api/routes/news.py` |
| Frontend API clients | `frontend/src/api/` |
| Frontend pages | `frontend/src/pages/` |
| Currency conversion/display | `frontend/src/lib/currency.ts`, `frontend/src/hooks/useDisplayCurrency.ts` |
| Realtime frontend | `frontend/src/realtime/` |
| CI definition | `.github/workflows/ci.yml` |
| Release procedure | `docs/wiki/Releasing.md` |
