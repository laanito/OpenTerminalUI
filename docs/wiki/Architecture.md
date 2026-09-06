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
classification.

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

`backend/services/llm_client.py` talks to OpenAI-compatible endpoints. The
default is local Ollama; LM Studio and hosted providers can be selected through
configuration. Notes, journal entries, portfolio theses, holding notes, and
transaction notes feed owner-scoped Second Brain indexing. PostgreSQL uses
pgvector when available, while SQLite uses an in-process cosine fallback.

External systems can deliberately upsert notes through the authenticated,
idempotent `PUT /api/v1/notes/external` contract. A general MCP surface and
automatic external-corpus ingestion are not part of the current architecture.

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
| Frontend routes | `frontend/src/App.tsx` |
| Primary navigation | `frontend/src/components/layout/` |
| Surface contract | `docs/surface-inventory.json` |
