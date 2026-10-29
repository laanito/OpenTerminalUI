# Architecture

This page describes the current application architecture. For product-surface
status, use [Surface Inventory](Surface-Inventory); for deployment gaps and
provider requirements, use [Limitations](Limitations). Historical design specs
under `docs/` explain how individual areas were built, but are not current
system contracts.

## System overview

```text
Browser
  React 18 + TypeScript + Vite
  TanStack Query + Zustand
  REST and /api/ws/quotes
          |
          v
FastAPI application (backend/main.py)
  CORS + JWT authentication middleware
  API routers (backend/api/router.py and domain packages)
  services, provider adapters, schedulers, quote hub
       |                  |                    |
       v                  v                    v
PostgreSQL 16         Redis              External providers
(Docker default)      cache/pub-sub      Yahoo, FMP, Finnhub,
                                          CoinGecko, Binance,
SQLite                                    Kite and optional NSE
(local/test fallback
and sidecar caches)
```

The production Docker image serves both the built frontend and FastAPI from port
`8000`. Local development normally runs FastAPI on `8000` and Vite on `5173`.

## Persistence

Docker Compose is **PostgreSQL-first** and uses the pgvector-enabled PostgreSQL
16 image. The backend runs `alembic -c backend/alembic.ini upgrade head` before
starting Uvicorn. Application migrations live in
`backend/alembic/versions/`.

SQLite remains supported for local development, tests, and explicitly selected
single-process installations. Some provider caches are deliberately SQLite
sidecars even when the application database is PostgreSQL; do not confuse those
caches with the primary application store. Redis supplies optional shared
caching, pub/sub, and quote distribution.

Database access currently contains both the main synchronous ORM path in
`backend/shared/db.py` and async SQLAlchemy helpers in `backend/db/`. New work
must preserve SQLite/PostgreSQL portability and use Alembic for schema changes.
See [Database Migration](../DATABASE_MIGRATION.md) and
[PostgreSQL portability notes](../../.agents/postgres-notes.md) for the
operative constraints.

## Backend request flow

`backend/main.py` creates the FastAPI application, installs CORS and auth
middleware, owns startup/shutdown services, mounts `backend/api/router.py`, and
serves the built SPA. The API router composes route modules from
`backend/api/routes/` and domain packages such as `equity/`, `fno/`,
`risk_engine/`, `screener/`, and `portfolio_backtests/`.

Route handlers should stay thin. Domain computation and provider orchestration
belong in services or domain packages. Public API families and their supported,
gated, experimental, or hidden state are checked against
`docs/surface-inventory.json`; adding a new OpenAPI tag requires an explicit
classification. `backend/openapi_contract.py` adds the effective middleware and
API-key security boundary that FastAPI cannot infer, while
`scripts/generate_api_reference.py` produces the checked-in human and JSON
contracts and fails CI when they drift.

## Authentication and ownership

JWT access tokens protect `/api` through `backend/auth/middleware.py`, with
route dependencies in `backend/auth/deps.py` enforcing user and role checks.
Login, refresh, health, documentation, and deliberately API-key-authenticated
public-v1 routes have explicit exemptions.

Portfolios, watchlists, notes, journal entries, and Second Brain evidence are
owner-scoped. Background jobs that need a market-data universe may receive a
deduplicated symbol set, never another user's private records. Automation keys
are separate from browser JWTs and provider credentials.

## Market data and realtime flow

Instrument search is backed by the `instrument_master` universe, seeded from US,
EU, and crypto sources with a Yahoo long-tail fallback. Provider selection is
instrument-aware: US/EU equities, crypto, and India workflows use different
adapters and configuration gates.

Finnhub, Binance, and Kite streams feed normalized quotes into the shared market
data hub when available. The hub fans updates out through `/api/ws/quotes`; the
frontend subscription layer updates stores and live charts. REST providers and
caches supply snapshots and historical candles. Provider failure is expected:
callers must preserve retry/backoff, circuit behavior, and explicit degraded
responses rather than fabricate values.

## AI and private research

The [research workflow guide](Research-Workflows.md) documents the browser entry
points and how source records, derived memos and external ingestion differ.

`backend/services/llm_client.py` talks to OpenAI-compatible endpoints. The
default is local Ollama; LM Studio and hosted providers can be selected through
configuration. Notes, journal entries, portfolio theses, holding notes, and
transaction notes feed owner-scoped Second Brain indexing. PostgreSQL uses
pgvector when available, while SQLite uses an in-process cosine fallback.

External systems can deliberately upsert notes through the authenticated,
idempotent `PUT /api/v1/notes/external` contract. A general MCP surface and
automatic external-corpus ingestion are not part of the current architecture.
External notes may supply an `effective_at` timestamp distinct from ingestion
time. The Second Brain carries effective, recorded, and updated timestamps into
retrieval and citations so later conflicting evidence can be treated as the
current view without erasing the older view from history.

### Model profiles and task routing (v2.4 foundation)

`llm_profiles.py` defines an immutable explicit task map and pure profile
resolution. `get_llm_client(task=...)` can build a client from that resolution;
no-argument construction remains the legacy path, including embeddings. There
is no automatic model router, inference during resolution or model escalation.
Global `LLM_ENABLED` applies to both generation profiles. Resolution reports the
requested and effective profiles, resolved model and deadline; callers must use
that one resolution for health, gating, generation, repair and displayed identity.

Workflow migration is incremental. Comparison briefings are integrated; other
audited application call sites below still use the legacy factory. Subsequent
integration must update model metadata, caches, progress deadlines and browser
budgets alongside the client call, not switch the model in isolation.

Price-only and selected-context comparison briefings resolve once before evidence
collection. The same immutable profile supplies health, client transport, model,
structured-output mode, whole health/generation/repair deadline and stream start
budget. `get_llm_client(profile=...)` accepts this snapshot without resolving the
task again. The browser already derives its deadline from the announced budget.
Results include additive nullable `model_profile` identity (requested/effective
profile and model), including unavailable results: this identifies the selected
configuration, not proof that inference ran. The UI distinguishes configured
Deep from the default single-model path. Endpoints and keys are never in this
metadata. Comparisons have no prose cache; every request collects fresh evidence.
Citation validation, one bounded repair and cancellation remain unchanged, with
no Fast retry after configured Deep failure. Shared insight lifecycle/cache
integration follows separately; its older stream/fallback path must be updated
together with model selection.

| Generation task | Intended profile | Current caller |
|---|---|---|
| `news_sentiment` | Fast | `services/llm_sentiment.py` |
| `stock_emotion` | Fast | `services/stock_emotion.py` |
| `query_intent` | Fast | `services/ai_service.py` intent/filter extraction |
| `filing_analysis` | Deep | `nlp/filing_parser.py`, bounded multi-document catalyst/summary extraction |
| `brain_answer` | Deep | `services/brain/brain_service.py` completion/stream/fallback |
| `comparison_briefing` | Deep | **Integrated:** `comparison_briefing.py` shared price/context runner |
| `stock_briefing` | Deep | `llm_insights.py` via asset-aware briefing routes |
| `interrogate` | Deep | `llm_insights.py` via adversarial research routes |
| `market_outlook` | Deep | `llm_insights.py` via collection/current-market facts |
| `portfolio_risk` | Deep | `llm_insights.py` via risk routes |
| `backtest_explanation` | Deep | `llm_insights.py` via backtest routes |
| `collection_briefing` | Deep | `llm_insights.py` via collection routes |

Fast/default retains existing `LLM_*` and legacy LM Studio settings. If Deep is
unset, a requested Deep task resolves honestly to Fast rather than claiming a
stronger model answered. A configured Deep model never falls back to Fast after
failure. `LLM_DEEP_MODEL` is required when other Deep overrides are provided.
Deep timeout inherits the legacy timeout unless explicit; resolved deadlines
must be positive and finite. Configured Deep structured-output mode defaults
to `auto` unless overridden.

If the Deep URL is omitted, its endpoint and (unless explicitly overridden) key
are inherited from Fast. Any explicitly configured Deep URL has independent
credentials, even if identical to Fast's URL; no key and no Authorization header
is valid for a local server. Deep URLs reject embedded credentials, queries,
fragments, malformed ports and non-HTTP(S) schemes. Resolved profile repr and
public identity omit endpoint/keys; settings errors hide input values and the
new Deep key is excluded from settings repr/serialization. Host secrets must
remain outside public Settings APIs and logs.

The embedding service remains on the legacy endpoint/model/key and is not a
generation task. No reindex, dimension change or embedding-model migration is
introduced. Tests cover legacy and opt-in resolution, task choices, model
failure isolation, credential boundaries, environment/YAML precedence and
unchanged embedding requests. Live model-quality evaluation is still pending.

Explicitly saved answers use the separate `brain_memos` store behind
`/api/brain/memos`. A memo is an immutable snapshot of the question, answer,
evidence scope, dated citations/content identities, generation time, and model
provenance; only owner-managed organization fields can change. This table is not
an indexing source. An explicitly reviewed promotion can create a Note, but saving a
memo alone never feeds derived model prose back into retrieval. The browser's
reviewed **Promote to Note** action now implements that transition; memo
`/evidence-status` checks compare cited identities against current records without
requiring the embedding index or rewriting the historical answer.

## Cross-market evidence

`backend/api/routes/market_context.py` composes the selected comparison, with
separate evidence routes such as `market_sec_facts.py`. Price paths and optional
news, technical, fundamentals and macro panels retain distinct dates, units and
coverage. They are not automatically indexed into private Brain retrieval.

The v2.1 SEC filing check is a JWT-authenticated, opt-in request. It revalidates
the current selected Company Facts claim and exact issuer, then
`sec_filing_verification.py` coordinates official index/instance retrieval and
`sec_filing_evidence.py` parses exact concept/unit/fiscal-context evidence.
`sec_edgar_client.py` enforces SEC identification and request pacing. Document
size, XML complexity and a 45-second operation deadline bound the work.
`SecFilingFactCheck.tsx` exposes the result with source links, a 60-second browser
deadline, cancellation and manual retries. No filing-check persistence, new
database migration or complete historical-vintage archive is introduced.

## Comparison briefing generation (v2.2)

`comparison_briefing.py` adds bounded completion-based synthesis to the selected
shared-UTC evidence packet. It validates structure, snapshot identity, reference
existence and pair coverage, not semantic truth. Every response preserves the
exact packet/caveats when available and labels this distinction explicitly.
The model receives no optional-provider or private-research context.

`POST /api/market-context/briefing` returns the typed result; `/briefing/stream`
reuses `insight_lifecycle.py` for cancellable progress and final-result delivery.
No raw provider tokens are published before validation. Preparation is bounded
to 45 seconds; health, completion and one repair share `LLM_TIMEOUT_SECONDS`.
No provider token-stream capability, persistence, migration or Brain indexing is
required. `ComparisonBriefingPanel.tsx` exposes explicit generation, cancellation,
plain-text output, mandatory caveats and snapshot-local citation inspection.
Its separate `comparisonBriefing.ts` client checks the transport envelope and
reference identities, bounds fetch/reader stalls using announced stage budgets,
and never automatically replays a failed stream. Selection changes remount and
abort the panel; generation guards ignore late completions. Configured host
acceptance and v2.2.0 publication are complete.

### Selected comparison context (v2.3)

Separate `/briefing-context-evidence`, `/briefing-context` and
`/briefing-context/stream` endpoints preserve the price-only contract while
collecting explicitly selected current-feed news and US/euro-area macro data.
`market_briefing_context_evidence.py` projects a separately fingerprinted envelope
around the original price packet. `market_briefing_context_collection.py` bounds
collection to 40 seconds, 12 per source job and three concurrent jobs, skipping
missing price windows and sharing only identical macro region/window requests
within the operation. Failed or malformed sources do not discard usable prices.

`comparison_context_briefing.py` separates observations, possible context,
limitations and unknowns; source/pair links, required coverage and material
caveats are checked, not prose truth. Validator-derived requirements and safe
failure feedback inform the single bounded repair. The entire envelope remains
available on model failure. `ComparisonBriefingPanel.tsx` defaults to price-only,
offers independent news/US/euro-area choices and clears work on scope changes.
`comparisonContextBriefing.ts` validates the selected scope and source references
and adds the context stage budget to the shared NDJSON reader deadline.
`BriefingContextEvidence.tsx` renders exact section/group/headline/series targets,
safe source links, coverage counts and macro flags. Current vintages do not
establish past knowledge; there is no implicit private indexing or persistence.

## Frontend structure

- `frontend/src/pages/` contains route-level screens.
- `frontend/src/components/` contains shared UI and domain components.
- `frontend/src/api/` contains typed API clients.
- `frontend/src/store/` contains Zustand state.
- `frontend/src/realtime/` contains WebSocket subscriptions.
- `frontend/src/App.tsx` owns route composition and compatibility redirects.

Primary navigation is intentionally narrower than the route tree. Hidden or
experimental compatibility pages must not be advertised as supported merely
because a direct route still exists.

## Key files

| Concern | Location |
|---|---|
| Application lifecycle | `backend/main.py` |
| API composition | `backend/api/router.py` |
| Runtime settings | `backend/config/settings.py`, `.env.example` |
| Authentication | `backend/auth/` |
| ORM and sessions | `backend/shared/db.py`, `backend/db/` |
| Alembic migrations | `backend/alembic/versions/` |
| Provider resilience | `backend/shared/http_resilience.py` |
| Quote hub | `backend/services/marketdata_hub.py` |
| LLM client | `backend/services/llm_client.py` |
| Second Brain | `backend/services/brain/` |
| Brain Log persistence | `backend/models/brain_memo.py`, `backend/api/routes/brain_memos.py` |
| Cross-market comparison | `backend/api/routes/market_context.py`, `frontend/src/pages/MarketContextPage.tsx` |
| SEC filing checks | `backend/services/sec_filing_verification.py`, `backend/services/sec_filing_evidence.py` |
| Frontend routes | `frontend/src/App.tsx` |
| Primary navigation | `frontend/src/components/layout/` |
| Surface contract | `docs/surface-inventory.json`, `docs/openapi.json`, `docs/API_REFERENCE.md` |
