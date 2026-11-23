# Features

This is a workflow overview for **v2.2.0**, not a promise that every inherited
route has live data. The [surface inventory](Surface-Inventory.md) defines
supported, gated, experimental and hidden areas; [Limitations](Limitations.md)
records provider gaps.

## Cross-market research

The contextual **Market context** page lets you choose an asset and market
proxies, then inspect actual shared-close paths, returns, coverage and source
metadata. It is separate from the chart Compare tool. Optional exchange-local,
Yahoo-adjusted and reporting-currency views preserve their own date/unit limits.

On-demand panels add dated news, descriptive technical measures, fundamentals,
economic-calendar and US/euro-area macro observations. They do not automatically
explain a move. v2.1 adds **Check source filing** for selected SEC facts, matching
the official filing instance's exact issuer, concept, unit and fiscal duration.
Conflicts, absent coverage and provider failures remain distinct.

v2.2 adds **Generate briefing** for an applied comparison. It fetches a fresh
shared-UTC native-quote return snapshot and produces observations, limitations
and unknowns with inspectable citations. Progress, cancellation and manual retries
are explicit; selection changes remove earlier work. Optional panels and private
research are excluded even if visible. Reference/structure checks are not semantic
fact-checking or investment advice. Nothing is automatically saved or indexed;
host acceptance, release verification and publication are complete.

Follow [Research Workflows](Research-Workflows.md) for entry points, source-check
outcomes and configuration. Cross-market context remains classified experimental;
it is not automatic relationship discovery or a full historical information set.

## Notes and private Second Brain

- Owner-scoped Notes, Journal, portfolio theses and position/transaction notes
  feed retrieval with source-type filters and dated citations.
- Effective dates distinguish when information applies from when it was recorded.
  Bounded recency weighting operates among semantically relevant candidates.
- Progressive synthesis, explicit fallback states and visible reindex progress
  keep model and indexing availability inspectable.
- **Brain Log** saves completed answers as immutable, cited memos with editable
  organization fields. Memos are not reindexed by default.
- **Promote to Note** creates a separately reviewed source; memo evidence checks
  report source changes without rewriting the saved answer.
- Scoped API keys support deliberate Hermes-style note upserts, not a general
  MCP server or automatic external-corpus ingestion.

## Portfolio and Journal

Portfolio Manager supplies per-user holdings and transactions, ledger-derived
cash, explicit native/cost/fee currencies and a reporting base currency. Shared
backend accounting uses dated FX evidence and marks dependent results partial
when denomination or rates are unavailable. Legacy unknown currencies can be
repaired through focused row actions.

Supported historical risk, benchmark and attribution views model the current
open basket. They are not complete closed-position or cash-flow-adjusted ledger
performance. Attribution separates security, FX and interaction returns.

Journal records rationale, setup, emotion, outcomes and an explicitly requested
gap review. It currently remains separate from Portfolio transactions; execution
linking/creation is planned, not shipped.

## Terminal shell and charts

GO bar, command palette, ticker tape, saved views and Launchpad panels organize
the terminal. Security Hub provides ticker-centric research; the chart workstation
supports linked panels, indicators, drawings and volume profile. Screens, quotes
and history follow selected markets and available providers.

The Views hub lists saved workflow setups across owned scopes, with their full
names, destination pages and update dates. Save view captures the current page's
supported filters/tabs/ticker and workspace state; Apply restores that setup.
Workflow-page controls keep their scope filter and open a keyboard-accessible
library dialog. Save/rename failures preserve the name draft for manual retry.

## Markets, news and alerts

US/EU equity and crypto workflows combine instrument search, charts, screening,
watchlists, news and alerts. Crypto fundamentals add CoinGecko supply/valuation
and DefiLlama usage evidence; Binance supplies available live spot ticks.

News retains classical sentiment and offers explicit model scoring of visible
headline batches with labelled fallback. Model-backed emotion and AI insight
cards require a compatible running service, local or hosted.

India F&O needs configured providers. Macro/yield and commodities have their own
key gates. Calendar coverage may remain unavailable even with keys; comparison
panels never substitute legacy sample events. ETF holdings/overlap are retained
while fund flows remain unavailable. Hidden compatibility feeds are not live
product promises.

## Backtesting and quantitative tools

Backtesting offers strategy jobs, result views and analytics over available
history. Pair Trading and Statistical Lab retain real-data computation contracts;
experimental factor/model tools keep their narrower classification. Historical
data availability, adjustments and execution assumptions constrain interpretation;
this is not a blanket guarantee of look-ahead-free fundamentals or broker fills.

## Platform and verification

FastAPI and React/Vite run in a combined Docker image with PostgreSQL/pgvector,
SQLite compatibility and Redis cache/quote distribution. OpenAI-compatible model
configuration supports local or hosted inference; only local chat and embedding
configuration keeps that inference on the operator's infrastructure.

CI checks backend compile/tests/coverage, integrity and generated-API guards,
frontend build/Vitest, deterministic browser smoke, disposable PostgreSQL
contracts and a fresh Compose installation. Locally, `make gate` and the separate
browser smoke command are documented in [Contributing](Contributing.md).

The backend serves Swagger UI at `/docs` and its schema at `/openapi.json`.
Use the [generated API reference](../API_REFERENCE.md) for per-operation
authentication and support state.
