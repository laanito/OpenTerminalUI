# PostgreSQL support — what was broken and how it's fixed

Originally implemented on `feat/postgres-support`; merged into `main` and shipped
in v1.0.0. These are current portability invariants, not instructions to return
to the historical branch.

Upstream assumed SQLite. The original maintainer of this fork had a set of
in-place "hacky" edits in a separate working copy (`../orig_OpenTerminal`) that
made Postgres work but weren't dialect-safe (they hard-coded Postgres spellings,
which then break SQLite). The fork reimplemented those fixes so **the same code
runs on both SQLite and PostgreSQL**, driven by `DATABASE_URL`.

## Root causes & robust fixes

### 1. Boolean `server_default` in Alembic migrations
`backend/alembic/versions/0004_institutional_risk_ops.py` used
`server_default=sa.text("0")` / `sa.text("1")`. Postgres `BOOLEAN` columns reject
integer literals.
- **Hacky fix (orig):** `sa.text("True")` / `sa.text("False")` — Postgres-only spelling.
- **Robust fix (here):** `sa.false()` / `sa.true()`. SQLAlchemy renders these
  correctly per dialect (`0/1` on SQLite, `false/true` on Postgres).

### 2. Over-length Alembic revision id
`0008_pit_fundamentals_release_metadata` is 38 chars. Alembic's `alembic_version.version_num`
column is `VARCHAR(32)`, so applying it on Postgres fails. (SQLite doesn't enforce
`VARCHAR` length, so it silently worked there.)
- **Fix:** renamed revision id → `0008_pit_fundamentals_release` (29 chars) and the
  file to match. Updated `down_revision` reference in `0011_saved_views.py`.
- Safe because this is a fresh fork with no deployed DB carrying the old id.
- **Guard:** keep all future revision ids ≤ 32 chars.

### 3. Raw `CREATE TABLE ... id INTEGER PRIMARY KEY AUTOINCREMENT`
`AUTOINCREMENT` is SQLite-only; Postgres uses `SERIAL` (or `IDENTITY`). Affected
services that run raw DDL through the **shared SQLAlchemy engine**:
- `backend/fno/services/iv_engine.py`
- `backend/fno/services/pcr_tracker.py`
- `backend/nlp/filing_parser.py`
- **Robust fix:** new helper `backend/shared/sql_compat.py` →
  `autoincrement_pk(bind)` returns `SERIAL PRIMARY KEY` on Postgres,
  `INTEGER PRIMARY KEY AUTOINCREMENT` on SQLite. Call sites use an f-string and
  pass the live connection/`Session.get_bind()`.

> NOT changed: `backend/bg_services/instruments_loader.py` also uses
> `AUTOINCREMENT`, but it opens its **own dedicated `sqlite3` connection** to a
> file path — it is intentionally always SQLite, independent of `DATABASE_URL`.
> Leave it as-is (it's a sidecar cache, not part of the primary DB).

### 4. Raw `ALTER TABLE` type spellings in `backend/shared/db.py`
The `_ensure_*` functions are runtime "add missing column" safety nets. Two
SQLite-isms:
- `BOOLEAN NOT NULL DEFAULT 0` → use `bool_default(engine, False)` (renders
  `DEFAULT FALSE` on Postgres).
- `DATETIME` columns → use `timestamp_type(engine)` (`TIMESTAMP` on Postgres).
  (`REAL`, `TEXT`, `JSON`, `VARCHAR`, `INTEGER` are valid on both — left as-is.)

These ALTERs only fire when a column is genuinely missing. On a freshly migrated
Postgres DB (entrypoint runs `alembic upgrade head` before the app starts) the
columns already exist, so they're skipped — but they're now dialect-safe in case
of a partially-migrated DB.

## The shared helper

`backend/shared/sql_compat.py` — dialect-aware SQL fragments:
- `dialect_name(bind)`
- `autoincrement_pk(bind, column="id")`
- `bool_literal(bind, value)` / `bool_default(bind, value)`
- `timestamp_type(bind)`

Use these anywhere raw DDL/DML is unavoidable. Prefer SQLAlchemy Core / Alembic
for new tables — those are dialect-aware automatically.

## Driver / URL plumbing (already in place upstream)

`backend/db/base.py` rewrites `DATABASE_URL`:
- async path: `postgresql://` → `postgresql+asyncpg://`
- sync path:  `postgresql://` → `postgresql+psycopg://`

Drivers are in `backend/requirements.txt`: `asyncpg`, `psycopg[binary]`.

## docker-compose

`postgres` is now a **first-class default service** (no longer behind the
`profiles: ["postgres"]` gate):
- `postgres` has a `pg_isready` healthcheck.
- `backend` `depends_on` postgres `condition: service_healthy`.
- `backend` `DATABASE_URL` defaults to the Postgres DSN.
- Host ports are overridable: `APP_PORT` (8000), `POSTGRES_PORT` (5432).

To run on SQLite instead, set in `.env`:
`DATABASE_URL=sqlite+aiosqlite:////data/openterminal.db`

The **code-level** default (no `DATABASE_URL` set, e.g. local pytest) is still
SQLite via `settings.sqlite_url`, so the test suite is unaffected. Do not confuse
this with the deployment default: Docker Compose is PostgreSQL-first.

## Ongoing review checklist

For schema or persistence changes:

- Prefer SQLAlchemy models/Core and Alembic operations to handwritten DDL.
- Keep every Alembic revision identifier at most 32 characters.
- Review raw SQL for SQLite-only constructs (`AUTOINCREMENT`, `PRAGMA`, permissive
  typing) and PostgreSQL-only constructs (`SERIAL`, boolean literal spellings).
- Remember that some dedicated caches intentionally use `sqlite3` even when the
  application database is PostgreSQL; identify which engine/connection a call
  actually uses before changing it.
- Add focused SQLite tests and, when the change is dialect-sensitive, verify the
  PostgreSQL path or add a regression test that exercises dialect generation.
- Do not use `PRAGMA table_info` against the shared application engine. Use
  SQLAlchemy inspection; `backend/services/materialized_store.py` contains a
  post-v1.1 regression fix for this exact mistake.

## v2.4 filing provenance

The experimental filing service now creates `stock_conviction_provenance` lazily
alongside its existing report table. New DDL uses SQLAlchemy Core
`CreateTable(..., if_not_exists=True)` with a composite text primary key and a
text JSON metadata column. It does not ALTER `stock_conviction_records`, change
its primary key, rewrite old engine labels or change list-shaped catalyst JSON.
Report/provenance upserts use one transaction and portable `ON CONFLICT` syntax.
Legacy rows without provenance are left-joined and remain unknown; no backfill
from current model configuration is performed. Tests exercise SQLite writes,
legacy columns/rows, rollback on metadata failure and PostgreSQL DDL compilation.
No live production database is used by those tests. No Alembic revision is added:
this legacy service retains its existing create-on-use lifecycle.

## Verifying

```bash
# SQLite (fast, no services)
cd backend && . .venv/bin/activate
DATABASE_URL=sqlite:///./_smoke.db alembic -c alembic.ini upgrade head

# Postgres (needs the compose db, or any reachable instance)
docker compose up -d postgres
DATABASE_URL=postgresql://openterminalui:openterminalui@localhost:5432/openterminalui \
  alembic -c backend/alembic.ini upgrade head
```


## v2.6 saved Brain technical evidence

Alembic `0018_brain_technical_context` (down-revision
`0017_market_fund_captures`) adds nullable `JSON` `technical_context` to
`brain_memos` with SQLAlchemy inspection and portable `op.add_column`. There is
no default, data backfill, old-row rewrite, type conversion or runtime PostgreSQL
ALTER path. Existing memos keep NULL and their original answers/citations. Run
Alembic before the new app reads memos; Docker entrypoint already upgrades head.
Application rollback retains the evidence column deliberately; older code ignores
it, and re-upgrade checks for the existing column. No production DB is touched
by local verification. Isolated SQLite preservation/idempotence and PostgreSQL
DDL tests cover the migration; the disposable PostgreSQL CI lane now also checks
the migrated column and runs Brain memo persistence/ownership API contracts.
Actual PostgreSQL execution belongs to that CI lane, not the local DDL test.


## v2.8 news evidence foundation

Additive `0019_news_evidence` introduces `news_text_snapshots` and
`news_sentiment_assessments` with portable JSON and timezone-aware timestamps.
The snapshot `(user_id, id)` unique key is referenced by the assessment composite
foreign key, so database enforcement also rejects cross-owner links. Account
deletion cascades private evidence. No existing table/row is altered or backfilled;
downgrade retains the new research tables. SQLite fresh/legacy/idempotent upgrade
and rollback retention plus PostgreSQL DDL are checked locally. An actual migrated
PostgreSQL insert/read/owner-FK contract is included in the guarded disposable CI
lane; local DDL checks alone do not establish live PostgreSQL verification.


## v2.8 explicit comparison captures

`0020_comparison_captures` follows `0019_news_evidence` and creates only an
owner-scoped table with portable JSON/timestamps, a user FK with account cascade,
and an owner/time index. The entire evidence/result/input envelope is inline,
so it has no mutable external snapshot dependency. No prior rows are changed,
no backfill/cleanup runs, and downgrade retains research. Fresh/idempotent SQLite
DDL and retention on rollback are tested; a disposable full-chain upgrade kept
legacy news untouched. PostgreSQL DDL checks run locally and an actual migrated
JSON/owner-filter/delete contract is added to the guarded CI lane. No production
database is used.
