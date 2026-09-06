# Contributing to OpenTerminalUI

Thank you for contributing.

## Development Setup

On macOS/Linux, the repository setup target creates `backend/.venv` and installs
the locked frontend dependencies:

```bash
make setup
```

Then copy the environment template and run the two development servers:

```bash
cp .env.example .env
PYTHONPATH=. backend/.venv/bin/python -m uvicorn backend.main:app --reload --port 8000
```

```bash
cd frontend
npm run dev
```

Windows contributors can create any Python 3.11 virtual environment, install
`backend/requirements.txt`, and run the equivalent commands. Node.js 22 is the
CI baseline.

## Branching and PRs

1. Create a feature branch: `feat/<scope>-<short-name>` or `fix/<scope>-<short-name>`
2. Keep PRs focused and small where possible.
3. Include tests for behavior changes.
4. Do not commit secrets or `.env`.

## Code Style

- Python: `black`, `isort`, type hints in service/provider layers
- TypeScript: ESLint + strict mode
- Avoid unsafe `eval()`/`exec()` on user-controlled input

## Required Checks

Run before opening a PR:

```bash
make gate
```

This runs the production-mock and surface-inventory guards, backend compile and
pytest coverage gate, frontend build, and Vitest.

If you run individual checks:

```bash
PYTHONPATH=. backend/.venv/bin/python -m pytest backend/tests -x -q --cov=backend --cov-fail-under=45
cd frontend && npm test
```

Playwright remains manual-only while its inherited fixtures are rehabilitated:

```bash
cd frontend && npm run test:e2e
```
