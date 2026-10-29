# OpenTerminalUI

<p align="center">
  <img src="assets/logo.png" alt="OpenTerminalUI logo" width="560" />
</p>

<p align="center">
  <strong>A self-hosted financial research terminal with private memory and inspectable market evidence.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.3.0-0f172a" alt="Version 2.3.0" />
  <img src="https://img.shields.io/badge/python-3.11-3776AB?logo=python&logoColor=white" alt="Python 3.11" />
  <img src="https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white" alt="Node 22" />
  <img src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React 18" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

<p align="center">
  <a href="https://laanito.github.io/OpenTerminalUI/">Website</a> |
  <a href="#quick-start">Quick Start</a> |
  <a href="#features">Features</a> |
  <a href="docs/wiki/Research-Workflows.md">Research Guide</a> |
  <a href="docs/API_REFERENCE.md">API</a> |
  <a href="docs/wiki/Roadmap.md">Roadmap</a>
</p>

OpenTerminalUI combines US/EU equity and crypto research, charting, screening,
portfolio accounting, news, alerts and backtesting in a terminal-style browser
workspace. This fork is PostgreSQL-first, retains SQLite compatibility and
intentional provider-gated India NSE/BSE F&O support, and lets you choose local
or hosted OpenAI-compatible models.

The north star is a private, AI-friendly, multi-asset decision terminal: a place
to cross-check market context, fundamentals, technicals, sentiment and your own
research. Today it supplies research tools, not automatic causal explanations,
investment recommendations or broker execution.

**Integrity over feature count:** missing data, unsupported coverage and provider
failures must be visible. A route existing does not make it a supported product;
the [surface inventory](docs/wiki/Surface-Inventory.md) and
[limitations](docs/wiki/Limitations.md) define the retained contracts.

## Current release

[v2.3.0 — Context beyond price](https://github.com/laanito/OpenTerminalUI/releases/tag/v2.3.0)
was published on **2026-10-28** from `3fb7de3` after release PR #229 passed all
three CI jobs and the maintainer authorized publication.
In Cross-market context, the comparison briefing still defaults to price-only.
Explicitly opt into dated news, US macro (FRED) and/or euro-area macro
(Eurostat/ECB) for possible context alongside observed movement, limitations and
unknowns. Coverage and failures remain visible; citations open exact evidence
with source links, dates, units, flags and original counts. Changing scope
cancels and clears old work. Current feeds are incomplete archives; macro
reference dates are not publication dates or proof of past investor knowledge.
Neither reference checks nor temporal overlap verify prose or establish causes.
No saving/indexing, new provider setting or migration is introduced. Existing
`FRED_API_KEY` and LLM settings apply; missing keys/providers degrade explicitly.
The maintainer confirmed combined-context completion after repair. The fast
model's reasoning quality remains limited; Fast/Deep profiles are approved for
v2.4 and are not part of published v2.3. The full local release gate and eight Chrome smoke
journeys passed. Publication is complete; deployment is managed separately.

Release reflection: [Why more context is not enough](https://blog.praderas.org/blog/en/openterminalui-more-context-is-not-enough)
([Español](https://blog.praderas.org/blog/openterminalui-mas-contexto-no-basta)).

Previous release:

[v2.2.0 — Grounded Comparison Briefing](https://github.com/laanito/OpenTerminalUI/releases/tag/v2.2.0)
was published on **2026-10-21**. On
Cross-market context, apply a comparison and choose **Generate briefing** for
observations, limitations and unknowns with citations into an inspectable fresh
snapshot. Only shared-UTC native-quote returns are included, not optional page
panels or private research. Reference checks are **not semantic fact-checking**,
causal explanation or investment advice. Progress, cancellation and manual
retries are explicit; changing a selection clears old work. Nothing is saved or
indexed. Host acceptance and all release-prep CI checks passed.
There is **no database migration or new provider setting**. The existing
OpenAI-compatible LLM configuration is used; model capability can affect prose
quality and is not guaranteed by reference validation.

The preceding release,
[v2.1.0 — Filing-grounded US fundamentals](https://github.com/laanito/OpenTerminalUI/releases/tag/v2.1.0),
was published on **2026-10-18**. From a cross-market comparison, request SEC filed
facts and choose **Check source filing** under a selected value. The terminal
checks that claim against the official filing's listed XBRL instance for the
same company, concept, unit and exact fiscal period. Results distinguish
corroboration, differing or ambiguous values, missing coverage and provider
failures, with exact values, dates and source links.

SEC requests require the existing `SEC_USER_AGENT` setting. This release requires
**no database migration or new provider setting**. It does not reconstruct a
complete historical information set or infer which disclosure supersedes another.

v2.0 introduced the bounded cross-market context journey alongside time-aware
Second Brain and Brain Log foundations. v1 completed fork consolidation and
base-currency portfolio accounting. See the [changelog](CHANGELOG.md) for release
history and the [roadmap](docs/wiki/Roadmap.md) for bounded v2.3 scope and the
in-progress v2.4 model-profile milestone.

## Quick Start

### Docker recommended

Install Docker with Compose v2, then:

```bash
git clone https://github.com/laanito/OpenTerminalUI.git
cd OpenTerminalUI
cp .env.example .env
docker compose up --build
```

Open `http://localhost:8000`. The image serves both the UI and API. Compose starts
the backend, Redis and pgvector-enabled PostgreSQL 16; it applies application
migrations before starting the server. Change `APP_PORT` or `POSTGRES_PORT` in
`.env` if the host ports are occupied.

Use the repository-root `.env` for configuration. Review database credentials
and deployment security before exposing the service beyond your machine;
the example values are not production secrets. See
[installation](docs/INSTALLATION.md) for the full deployment procedure.

For SQLite instead of PostgreSQL application storage, set:

```dotenv
DATABASE_URL=sqlite+aiosqlite:////data/openterminal.db
```

SQLite is also used for some provider sidecar caches even when the primary
application database is PostgreSQL.

### Local development

Use Python 3.11 and Node.js 22 to match CI. On macOS/Linux:

```bash
make setup
cp .env.example .env
```

The example database URL names the Compose service `postgres`. For a direct
host process, use a reachable PostgreSQL URL or a writable SQLite URL, for example
`DATABASE_URL=sqlite+aiosqlite:///./openterminal.db`.

In separate terminals:

```bash
PYTHONPATH=. backend/.venv/bin/python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
npm run dev --prefix frontend
```

The API runs at `http://127.0.0.1:8000`, Vite at `http://127.0.0.1:5173`.
Windows users can create a Python environment manually, install
`backend/requirements.txt`, and run `npm ci --prefix frontend`.
See [CONTRIBUTING.md](CONTRIBUTING.md) for contributor setup and checks.

## Features

### Cross-market context and source checks

Open **Market context** from equity research, the Security Hub or crypto detail.
Choose an anchor, add market proxies using symbol suggestions and inspect a
one-, three- or six-month comparison.

- Dated shared-close paths, native-quote returns and explicit overlap,
  freshness, source and price-basis disclosures.
- Separately labelled Yahoo exchange-local and adjusted-close views when the
  required metadata and coverage exist.
- Optional reporting-currency returns and full paths, with dated FX evidence;
  endpoint attribution separates price, currency and their interaction.
- On-demand news, descriptive technical measures, fundamentals, economic
  calendar and US/euro-area macro evidence. Each panel has its own coverage
  and failure state.
- Selected US SEC facts can be checked against their own filing, not just an
  aggregate feed or submissions-index entry.

This contextual surface remains classified experimental. Shared dates are not
proof of simultaneous sessions, co-movement is not causation, and current or
revised provider data is not a complete historical vintage.
[Research guide](docs/wiki/Research-Workflows.md#cross-market-context) ·
[Detailed limitations](docs/wiki/Limitations.md)

### Private Second Brain and Brain Log

Notes, trade-journal entries, portfolio theses and position/transaction notes
feed owner-scoped retrieval. Questions receive dated citations back to that
private evidence, with source-type filters and progressive synthesis.

Effective dates distinguish when information applies from when it was recorded.
A bounded recency signal operates among relevant notes; older conflicting views
remain available as history. Notes and reindexing expose loading and indexing
progress rather than silently treating a queued write as searchable evidence.

**Save answer** preserves a completed synthesis in the **Brain Log**, with
citation snapshots and model provenance. Saved memos are not automatically
reindexed as facts. **Promote to Note** creates a separate, reviewed, editable
source; opening a memo also reports changed or missing cited records.

An external agent such as Hermes can deliberately ingest summaries through the
API-key-authenticated notes endpoint. This is not automatic web/news indexing
or a general MCP server.
[Research and ingestion guide](docs/wiki/Research-Workflows.md)

### Portfolio and Journal

Per-user portfolios combine holdings, transaction-derived cash, explicit
transaction/cost/fee currencies and a reporting base currency. Backend accounting
normalizes supported value, cost, income and realised/unrealised P&L with
traceable current or dated FX. Missing denomination or rates produce partial
results, not guessed totals. Portfolio Manager offers a focused currency-repair
dialog for legacy records.

Risk, benchmark and attribution history describes the **current open basket**,
not full closed-position or cash-flow-adjusted ledger performance. Supported
attribution separates security, FX and interaction returns.

Portfolio theses and holding notes record your reasoning. **Journal** captures
trade rationale, setup, emotions and review, with an on-demand completeness
check. Journal trades and Portfolio transactions are currently separate; linking
existing executions or creating missing ones from Journal is planned, not shipped.

### Markets and workspaces

- GO bar (`Ctrl+G`), command palette (`Ctrl+K`), ticker tape, saved views,
  Launchpad panels and a linked chart workstation.
- Security Hub research, multi-market screening, watchlists, alerts and
  backtesting with explicit provider/history limits.
- Crypto markets and fundamentals, including CoinGecko supply/valuation data
  and DefiLlama usage measures; Binance provides available live spot ticks.
- News with classical sentiment, explicit on-demand AI scoring of visible
  headline batches, and a model-backed emotion view.
- Provider-gated India F&O, macro and commodities; retained partial products
  identify unavailable panels rather than filling them with plausible data.

Hidden compatibility tools, experimental factor/model workflows and unavailable
feeds are not a promise of live coverage. See the
[feature guide](docs/wiki/Features.md) and [surface inventory](docs/wiki/Surface-Inventory.md).

## Screenshots

These snapshots illustrate the interface, not current provider availability or
every navigation entry. The application and surface inventory remain authoritative.

<p align="center">
  <img src="assets/screenshots/home.png" alt="Home market and portfolio workspace" width="900" />
</p>

<p align="center">
  <img src="assets/screenshots/chart-workstation.png" alt="Linked chart workstation" width="900" />
</p>

<p align="center">
  <img src="assets/screenshots/portfolio.png" alt="Portfolio workspace snapshot" width="900" />
</p>

## Configuration and data availability

"Keyless" means no provider API key is required, not guaranteed data availability.
AI still needs a running model service. Hosted model configurations send the
selected prompts and evidence to that provider; keep both chat and embeddings
local if they must stay on your infrastructure.

| Setting | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL by default in Compose; SQLite remains supported |
| `FMP_API_KEY` | Extends selected fundamentals, earnings, commodities and other provider-backed data |
| `FINNHUB_API_KEY` | US live ticks and selected REST/calendar/FX fallback paths, subject to access |
| `FRED_API_KEY` | FRED macro/yield data and optional US comparison observations |
| `SEC_USER_AGENT` | SEC Company Facts and filing checks; identify the app/operator and a real contact email, e.g. `OpenTerminalUI operator@example.com` |
| `COINGECKO_API_KEY` | Optional demo key for crypto provider access |
| `KITE_API_KEY`, `KITE_API_SECRET`, `KITE_ACCESS_TOKEN` | Intentional India/Kite workflows |
| `OPENTERMINALUI_NSE_PUBLIC_ENABLED` | Direct NSE scraping is off by default; first opted-in 403 opens a process circuit |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | OpenAI-compatible chat provider; hosted keys are separate from terminal automation keys |
| `SMTP_*` | Optional scheduled-report email delivery |

Provider settings belong on the host, not in browser API-key management.
The [environment template](.env.example), [provider guide](docs/wiki/Data-Providers.md)
and [limitations matrix](docs/wiki/Limitations.md) describe the configuration
boundary. Restart/recreate the backend after changing its runtime configuration.

Charts/search have keyless paths through Yahoo, CoinGecko and Binance.
Euro-area comparison context uses bounded keyless Eurostat/ECB sources. SEC
needs identification but not an API key. FRED, commodities and India/Kite data
are gated. Calendar coverage remains unreliable even with keys; comparison
panels never substitute legacy sample events.

Portfolio FX uses Yahoo daily history with a configured Finnhub fallback.
Unavailable conversion is partial, not parity. Unsupported US/EU Level-2,
ETF flows and other provider gaps remain explicitly unavailable.

### Local models and embeddings

For the default Ollama setup, obtain a chat model and the embedding model:

```bash
ollama pull llama3.1
ollama pull nomic-embed-text
```

Local Python defaults to `http://localhost:11434/v1`. Compose defaults to
`http://host.docker.internal:11434/v1`; ensure that address reaches the host's
model service in your Docker environment. A different OpenAI-compatible service
can use the same settings.

| Variable | Default | Meaning |
|---|---|---|
| `LLM_ENABLED` | `true` | Enable model analysis |
| `LLM_MODEL` | `llama3.1` | Served chat model identifier |
| `LLM_TIMEOUT_SECONDS` | `240` | Shared insight operation deadline |
| `LLM_STRUCTURED_OUTPUT` | `auto` | Structured-output mode: `auto`, `json_schema`, `json`, `none` |
| `LLM_EMBED_MODEL` | `nomic-embed-text` | Embedding model |
| `BRAIN_EMBED_DIM` | `768` | pgvector dimension hint; keep compatible with the embedding model |
| `BRAIN_EMBED_FALLBACK` | `true` | Allow installed local sentence-transformers fallback |

PostgreSQL uses pgvector when available; SQLite uses in-process cosine search.
Model/provider failure is labelled, not a licence to fabricate an answer.

#### v2.4 development — model-profile foundation

Comparison briefings, both price-only and with selected news/macro context, now
use the Deep profile for health, generation and bounded repair. Their browser
deadline follows the selected model's timeout, and the result shows the model
and resolved profile. With Deep unset, they retain the existing `LLM_*` model
and show “Default profile (Deep not configured)”. A configured Deep failure is
explicit; it never retries Fast. Brain and shared insight cards still use the
legacy model pending their integration. Embedding configuration and indexing
are unchanged.

| Variable | Meaning |
|---|---|
| `LLM_DEEP_MODEL` | Optional served Deep model; required if any other Deep override is set |
| `LLM_DEEP_BASE_URL` | Optional independent HTTP(S) endpoint; omitted means use `LLM_BASE_URL` |
| `LLM_DEEP_API_KEY` | Independent credential; only an omitted Deep URL may inherit `LLM_API_KEY` |
| `LLM_DEEP_TIMEOUT_SECONDS` | Positive finite deadline; omitted inherits `LLM_TIMEOUT_SECONDS` |
| `LLM_DEEP_STRUCTURED_OUTPUT` | `auto`, `json_schema`, `json` or `none`; configured Deep defaults to `auto` |

An explicit Deep URL never inherits Fast credentials, even when both URLs name
the same endpoint. Set the Deep key explicitly when needed. Empty Deep settings
keep single-model behavior; partial configurations are rejected instead of
silently ignored. The settings loader also accepts `OPENTERMINALUI_LLM_DEEP_*`
aliases and equivalent `app.llm_deep_*` YAML keys. Compose forwards the plain
environment variables. See [Architecture](docs/wiki/Architecture.md#model-profiles-and-task-routing-v24-foundation)
for the audited task map and remaining integration work. No stronger model is
downloaded, selected or deployed by these settings.
Shared AI insight jobs support bounded retries, cancellation and streaming;
Brain synthesis has its own streaming and fallback contract.

The default per-article sentiment engine prefers optional FinBERT, then
TextBlob, then a finance lexicon. **AI sentiment** on News deliberately requests
model scoring for visible batches and identifies fallback results. Optional ML
dependencies can be installed from `backend/requirements-ml.txt`; first model
use may download weights.

## API and external agents

The running backend exposes Swagger UI at `/docs` and the full schema at
`/openapi.json`. The checked-in [API reference](docs/API_REFERENCE.md) lists
authentication and support state; [OpenAPI JSON](docs/openapi.json) is suitable
for agents without a running terminal.

Browser APIs generally require a user JWT. Automation API keys are a distinct,
scoped boundary, not interchangeable JWTs. For deliberate external notes, create
a key in **Settings → API Keys** with **Read + external notes**
(`read_write`) permission and call `PUT /api/v1/notes/external`.
Stable source/external IDs make retries update the same owner-scoped record.
Supply `effective_at` when source time differs from ingestion time.

See the [ingestion example and limits](docs/wiki/Research-Workflows.md#external-note-ingestion).
Brain Log and source-filing endpoints retain their documented JWT boundary;
a notes-ingestion key does not grant arbitrary access to every research API.
General MCP and autonomous execution remain later work.

## Architecture

React/TypeScript/Vite uses TanStack Query and Zustand for the browser shell.
FastAPI composes owner-checked route modules and domain services. PostgreSQL 16
is the primary Compose store, SQLite supports local/test and sidecar uses, and
Redis supplies shared cache/pub-sub/quote distribution. Market adapters and the
OpenAI-compatible model client preserve labelled degradation on failure.

See the [architecture guide](docs/wiki/Architecture.md) for request flow,
persistence and key files, and the [documentation map](docs/README.md) for
current versus historical references.

## Testing and contributing

```bash
make gate
```

This runs integrity/API guards, backend compile and coverage tests, frontend
build and Vitest. The deterministic browser smoke set runs separately locally:

```bash
npm run test:e2e:smoke --prefix frontend
```

Use an installed Chrome with `PLAYWRIGHT_EXECUTABLE_PATH`, or install the
Playwright Chromium browser if none is available. The
[browser test guide](frontend/tests/e2e/README.md) documents local options and
legacy fixtures. CI runs smoke tests on every PR, plus disposable PostgreSQL
contracts and a fresh-install check. The clean-install teardown script is
CI-only: do not run it against a deployment host.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution requirements and
[Releasing](docs/wiki/Releasing.md) for release gates.

## License

[MIT](LICENSE).
