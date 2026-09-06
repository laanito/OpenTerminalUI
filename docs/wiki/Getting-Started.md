# Getting Started

## Prerequisites

- Python 3.11+
- Node.js 22+
- Docker Desktop (recommended)

## Run with Docker

```bash
git clone https://github.com/laanito/OpenTerminalUI.git
cd OpenTerminalUI
cp .env.example .env
docker compose up --build
```

Use the repo-root `.env` as the canonical local config file. `backend/.env` is still read for backward compatibility, but root `.env` wins if both exist.

App/API are served from backend container:

- UI/API: `http://127.0.0.1:8000`

## Run Locally (without Docker)

### Backend

On macOS/Linux, run `make setup`, then:

```bash
PYTHONPATH=. backend/.venv/bin/python -m uvicorn backend.main:app --reload --port 8000
```

On Windows, create and activate a Python 3.11 virtual environment, install
`backend/requirements.txt`, and run `python -m uvicorn backend.main:app --reload
--port 8000` from the repository root.

### Frontend

```bash
npm ci --prefix frontend
npm run dev --prefix frontend
```

Frontend dev server:

- `http://127.0.0.1:5173`

## CI-equivalent Validation

```bash
python -m compileall backend
PYTHONPATH=. python scripts/check_no_production_mocks.py
PYTHONPATH=. python scripts/check_surface_inventory.py
PYTHONPATH=. pytest backend/tests -q --cov=backend --cov-fail-under=45
npm ci --prefix frontend
npm run build --prefix frontend
npm run test --prefix frontend
```

Playwright is currently a manual workflow, not part of each PR gate. See
[Contributing](Contributing) for the optional command and current rationale.
