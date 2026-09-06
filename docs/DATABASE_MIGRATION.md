# Database Migration

This is the current database setup and schema-migration contract. Historical
architecture documents under `docs/` are not migration instructions.

## Runtime selection

- Docker Compose defaults to PostgreSQL 16 with pgvector:
  `postgresql://openterminalui:openterminalui@postgres:5432/openterminalui`.
- A local backend without `DATABASE_URL` falls back to the configured SQLite
  URL under `data/`.
- To run the container with SQLite, set an explicit container-visible URL such
  as `DATABASE_URL=sqlite+aiosqlite:////data/openterminal.db`.

The primary database URL is normalized by `backend/db/base.py`. Dedicated
SQLite provider caches may still exist alongside a PostgreSQL application
database and do not change the primary-store selection.

## Schema files

- Alembic configuration: `backend/alembic.ini`
- Migration environment: `backend/alembic/env.py`
- Versioned migrations: `backend/alembic/versions/`
- ORM models: `backend/models/` and `backend/db/models.py`
- Portability notes: [`.agents/postgres-notes.md`](../.agents/postgres-notes.md)

Alembic revision identifiers must remain at most 32 characters because the
PostgreSQL `alembic_version.version_num` column enforces that width.

## Apply migrations

From the repository root with backend dependencies installed:

```bash
PYTHONPATH=. backend/.venv/bin/python -m alembic -c backend/alembic.ini upgrade head
```

Container startup runs that command automatically through
`backend/entrypoint.sh` before Uvicorn starts. To inspect pending state:

```bash
PYTHONPATH=. backend/.venv/bin/python -m alembic -c backend/alembic.ini current
PYTHONPATH=. backend/.venv/bin/python -m alembic -c backend/alembic.ini heads
```

## Switching database engines

Changing `DATABASE_URL` selects a different database; it does **not** copy data
between SQLite and PostgreSQL. Back up the source, provision the target, apply
Alembic migrations, and use an explicit reviewed data-migration process when
existing records must move. Do not copy SQLite files into PostgreSQL volumes or
assume application startup transfers rows.
