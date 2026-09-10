# Contributing

The repository-root [`CONTRIBUTING.md`](../../CONTRIBUTING.md) is the canonical
contributor guide. This page summarizes the workflow and links to the active
engineering contracts.

## Setup

```bash
git clone https://github.com/laanito/OpenTerminalUI.git
cd OpenTerminalUI
make setup
cp .env.example .env
```

`make setup` creates `backend/.venv` and installs the frontend lockfile on
macOS/Linux. Windows contributors can create a Python 3.11 environment manually,
install `backend/requirements.txt`, and run `npm ci --prefix frontend`.

Run the backend and frontend development servers separately:

```bash
PYTHONPATH=. backend/.venv/bin/python -m uvicorn backend.main:app --reload --port 8000
npm run dev --prefix frontend
```

## Required PR gate

```bash
make gate
```

The gate matches the regular CI contract: production-mock, surface-inventory,
and generated API-reference guards, backend compile and pytest with the 45%
coverage floor, frontend build, Vitest, and the deterministic Chromium `@smoke`
set. Broader inherited Playwright journeys stay manual while their fixtures are
rewritten:

```bash
npm run test:e2e --prefix frontend
```

## Working rules

- Branch from current `main` and keep each PR coherent.
- Add focused tests for behavior changes.
- Never commit `.env`, credentials, or provider keys.
- Keep SQLite and PostgreSQL behavior portable; use Alembic for schema changes.
- Preserve owner isolation for portfolios, watchlists, notes, journal data, and
  Second Brain evidence.
- Never present fabricated market data as live. Preserve explicit degraded and
  sample states and keep `scripts/check_no_production_mocks.py` passing.
- Classify new public API families in `docs/surface-inventory.json`.
- Regenerate `docs/API_REFERENCE.md` and `docs/openapi.json` with
  `scripts/generate_api_reference.py` after route, schema, auth, or
  classification changes.
- Treat provider failure, quota exhaustion, and missing credentials as normal
  degraded conditions.

Before changing a surface or contract, read the
[documentation map](../README.md), [architecture](Architecture),
[limitations](Limitations), and [surface inventory](Surface-Inventory).

## Reporting issues

Open a [GitHub issue](https://github.com/laanito/OpenTerminalUI/issues) with the
expected behavior, actual behavior, minimal reproduction, environment, and
relevant logs. Do not put secrets or private portfolio/research data in an issue.
