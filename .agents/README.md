# External-agent project context

This directory is the repository-owned handoff for AI coding agents and new
maintainers. Read it before making changes. It records decisions that may have
previously existed only in a maintainer's chat or local agent memory.

Last audited: **2026-08-31**, against `main` at `bd44141` (PR #94), plus the
v1.2.0 release-prep changes on this branch.

## Read order and sources of truth

1. This file: mission, architecture, invariants, and working conventions.
2. `TODO.md`: current shipped state, active work, and known gaps.
3. `postgres-notes.md`: database portability constraints.
4. The code and tests for the area being changed.
5. `README.md`, `CHANGELOG.md`, and `docs/wiki/Roadmap.md` for product-level
   detail and release history.

The code and recent Git history win when prose disagrees. Some older wiki pages
and plans describe historical architecture. In particular,
`docs/wiki/Architecture.md` still contains pre-1.0 statements such as SQLite
being the default and PostgreSQL being optional. Do not copy those assumptions
without checking the current code, Docker Compose, and README.

There is no repository-level `AGENTS.md` or `CLAUDE.md` at this snapshot. Local
tool settings under `.claude/` are not a substitute for project documentation.

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

## Current release and development state

- Current release/version contract: **1.2.0** (tagged as `v1.2.0`). Keep
  `backend/config/settings.py` and `frontend/package.json` in lockstep when
  releasing.
- v1.2's completed scope is the adversarial Interrogate flow for stocks, crypto,
  and indices; semantic private-note grounding; asset-aware briefing facts;
  crypto/index/EU-aware news; and optional batched AI sentiment in the main News
  hub with a classical fallback. See `CHANGELOG.md` for the release inventory.
- The next planned milestone is **v1.3 — The second brain gets depth**:
  deterministic long-note chunking, source-aware retrieval, progressive answers,
  deliberate API-key note ingestion, and an explicit journal-gap review. Those
  feature slices are implemented; release-contract verification remains. General
  MCP tooling and automatic external market/news indexing remain deferred.
- The real Relative Strength engine and broader depth/coverage work remain
  separate backlog rather than v1.3 release gates.
- The old `.agents/TODO.md` snapshot stopped around PR #17. Its Ollama, EUR,
  crypto tick, and early frontend-audit tasks have all shipped and must not be
  treated as current work.
- See `TODO.md` for the current backlog. Before starting any backlog item, check
  `git log`, the implementation, and tests in case it landed without a doc edit.

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
PYTHONPATH=. pytest backend/tests -q --cov=backend --cov-fail-under=45
cd frontend && npm ci && npm run build && npx vitest run
```

For an existing checkout with dependencies installed, `make gate` runs backend
compile/tests and the frontend build. Run focused tests during development, then
the broadest relevant checks before handing off.

Playwright is currently **manual-only**, not part of every PR gate. Several E2E
specs predate the 1.0 integrity/de-India changes and need rewriting; do not assume
an E2E failure is a new product regression without checking the fixture and
expectation. Do not silently ignore genuine failures either.

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
