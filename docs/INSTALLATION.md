# OpenTerminalUI Installation (Docker, Fresh Clone)

This guide is for a new machine starting from a public git clone.
Only Docker Desktop/Engine + Docker Compose are required; local Python/Node are not needed for this path.

## 1) Clone

```bash
git clone https://github.com/laanito/OpenTerminalUI.git
cd OpenTerminalUI
```

## 2) Configure and start

```bash
cp .env.example .env
docker compose up --build
```

The default stack starts the application, Redis, and PostgreSQL 16 with
pgvector. Provider keys are optional; unavailable integrations degrade
explicitly. The copied template leaves provider credentials empty, so a fresh
install does not mistake example strings for configured keys. Its empty
`LLM_BASE_URL` lets Compose use `host.docker.internal` for a host Ollama/LM
Studio server; set an explicit URL when using a hosted provider.

Every pull request boots this exact stack on a GitHub-hosted runner under a
run-ID-namespaced Compose project,
runs Alembic against a new PostgreSQL volume, and checks the application,
Swagger, OpenAPI, health, and a register/login round trip through the new
database. CI always destroys that disposable volume afterward; it never targets
a deployment database.

The platform-specific helper scripts provide the same local bootstrap:

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\docker-up.ps1
```

macOS/Linux:

```bash
sh ./scripts/docker-up.sh
```

## 3) Open

- App: `http://127.0.0.1:8000`
- API docs: `http://127.0.0.1:8000/docs`
- Health: `http://127.0.0.1:8000/health`

## SQLite opt-in

Set this in the root `.env` before starting Compose:

```dotenv
DATABASE_URL=sqlite+aiosqlite:////data/openterminal.db
```

PostgreSQL remains part of the default Compose stack; the setting changes the
application's primary database. For a custom host port, set `APP_PORT=8010` in
`.env` or use the helper script's `--port 8010` / `-Port 8010` option.

## Common issues

- Docker not running: start Docker Desktop and wait until engine is ready.
- `docker compose` not found: install/update Docker Desktop (Compose v2 required).
- Missing provider credentials: update root `.env` with your own API keys.
- Port `8000` already in use: use `-Port 8010` or `--port 8010`.
