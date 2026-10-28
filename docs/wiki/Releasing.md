# Releasing

How this fork prepares, validates, and cuts a tagged release. See the milestone
sections in [Roadmap](Roadmap.md) for the intended scope of each minor release.

## Philosophy

`1.0.0` was a **hardening** milestone, not a feature one: a coherent, honest,
installable product where every advertised feature works or is explicitly
labelled degraded. Integrity outranks feature count — no silent mock data, no
broken links, no wrong-currency numbers. Feature growth resumes in `1.1+`.

## Versioning

- **SemVer** from `1.0.0`: incompatible deployment/API contracts or a DB schema
  requiring manual migration demand a `MAJOR` bump. The roadmap also uses a
  major version for a reviewed product-generation milestone, such as the
  accepted v2.0 cross-market context release; that does not imply a breaking
  migration when none exists. `MINOR` adds features/surfaces within the current
  generation; `PATCH` fixes behavior.
- **Single source of truth.** Two values, kept in lockstep at the release
  version: backend `app_version` (`backend/config/settings.py`, overridable via
  `OPENTERMINALUI_APP_VERSION`) and `frontend/package.json`. The frontend derives
  its version *only* from `package.json` (Vite injects it as `__APP_VERSION__`) —
  don't reintroduce a hardcoded copy. Surfaced in the `/health` payload and the
  UI footer (`StatusBar`). On a bump, change both and grep for stragglers
  (README badge, `docs/site/index.html`).

## Pre-release checklist

Confirm the target milestone in [Roadmap](Roadmap.md) is complete, then:

1. **Version bump** — set `frontend/package.json` and backend `app_version` to the
   release version; grep for stragglers.
2. **CHANGELOG** — move `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`; start a fresh
   `[Unreleased]`. If release preparation and the tag fall on different days,
   confirm the dated heading at tag time.
3. **Docs** — README quickstart verified end-to-end; the out-of-the-box-vs-keys
   matrix, Limitations, and upgrade notes (e.g. the pgvector image swap) current
   in [Limitations](Limitations) (mirrored condensed in the README).
4. **Green CI** — `ci.yml` must pass: backend compile, mock-detection,
   surface-inventory, and generated API-reference guards, `pytest` + coverage
   gate, frontend build, Vitest, and the deterministic Chromium `@smoke` set.
   Broader pre-1.0 Playwright fixtures remain manual while rehabilitated.
5. **Smoke matrix** — manually verify the core flows on each combination:

   | DB | Keys | Must work |
   |----|------|-----------|
   | SQLite | none | app boots, search, charts (Yahoo keyless), portfolio, second brain (local embeddings), labelled degradation where keys are absent |
   | Postgres + pgvector | none | same, with pgvector ANN brain store |
   | Postgres + pgvector | FMP/Finnhub/FRED/LLM | live commodities, economic calendar + macro, LLM features |

   Confirm **no fabricated data looks live** in the no-keys runs (banners/labels
   present).

### v1.3.0 verification ledger

Release-prep automation covers the v1.3-specific contract independently of the
runtime matrix above:

| Contract | Evidence |
|---|---|
| Stable long-source chunks and incremental pruning | `backend/tests/test_brain.py` |
| Owner- and source-filtered SQLite/pgvector retrieval | `backend/tests/test_brain.py` |
| Complete fallback after provider/browser stream interruption | `backend/tests/test_brain.py`, `frontend/src/__tests__/brainStreaming.test.ts` |
| Visible source counts, filters, and progressive rendering | `frontend/src/__tests__/SecondBrainPanel.sourceFilters.test.tsx` |
| Write-scoped, owner-scoped external-note upserts | `backend/tests/test_external_note_ingest.py` |
| On-demand, owner-scoped journal gap review | `backend/tests/test_journal.py`, `frontend/src/__tests__/TradeJournalPage.gaps.test.tsx` |

The Docker Compose file resolves successfully during release prep. The three
runtime smoke rows still require confirmation on the deployment host after merge
and before tagging; a sandboxed coding agent without Docker-daemon access must
leave that step to the host operator rather than marking it passed.

### v1.4.0 verification ledger

Release-prep automation covers the v1.4 surface-truth contract independently of
the runtime matrix above:

| Contract | Evidence |
|---|---|
| Every public API family has an explicit product classification | `docs/surface-inventory.json`, `scripts/check_surface_inventory.py` |
| Duplicate mounts and operation IDs remain rejected | `backend/tests/test_api/test_router_smoke.py`, `scripts/check_surface_inventory.py` |
| Owner-scoped watchlist and compatibility-tool boundaries | `backend/tests/test_watchlist_routes.py`, `backend/tests/test_watchlist_service.py`, `backend/tests/test_oms_and_ops_routes.py`, `backend/tests/test_plugin_loader.py` |
| Primary navigation and configuration gates match the inventory | `frontend/src/__tests__/navigationSurface.test.ts` |
| Missing provider data remains explicit rather than fabricated | backend provider/degradation tests and `scripts/check_no_production_mocks.py` |
| Slow or malformed AI responses degrade within bounded deadlines | `backend/tests/test_llm_insights.py`, frontend AI timeout/card tests |

The maintainer completed the host/user verification, release PR #120 merged,
and tag/GitHub release `v1.4.0` were published from `2999a42` on 2026-09-04.
The broader LLM job, streaming, cancellation, and response-repair architecture
is intentionally deferred to the v1.6 stable-baseline work; the bounded v1.4
reliability fixes do not expand that release's scope.

### v1.5.0 verification ledger

Release-prep automation covers the v1.5 fork-consistency contract independently
of the runtime matrix above:

| Contract | Evidence |
|---|---|
| Canonical fork identity and package-derived frontend version | `frontend/src/__tests__/LoginPage.identity.test.tsx`, `frontend/src/__tests__/About.revamp.test.tsx` |
| Shared US/NASDAQ defaults with explicit India routing preserved | `backend/tests/test_market_defaults.py`, `backend/tests/test_chart_unified_route.py`, `backend/tests/test_model_lab_routes.py`, `backend/tests/test_portfolio_lab_routes.py`, `frontend/src/__tests__/marketDefaults.test.ts` |
| Instrument-aware native currency and honest FX fallback | `backend/tests/test_market_defaults.py`, `backend/tests/test_materialized_store_schema.py`, `backend/tests/test_portfolio_primary.py`, `frontend/src/__tests__/currency.test.ts` |
| Market context survives chart and screener navigation | `frontend/src/__tests__/ChartWorkstationPage.toolbar.test.tsx`, `frontend/src/__tests__/chartWorkstationPage.links.test.ts`, `frontend/src/__tests__/ScreenerResultsTable.routes.test.tsx` |
| Current documentation is separated from historical and partial references | `docs/README.md`, maintained wiki pages, and the release grep/checklist above |

The maintainer completed host/user verification, release PR #125 merged, and a
final Portfolio holding-entry clarity issue found during live use was fixed and
verified in PR #126. Tag/GitHub release `v1.5.0` were published from `1d2f3ca` on
2026-09-07. The v1.6 browser-smoke, shared LLM-job, performance, and expanded
high-risk coverage work remains deliberately outside this release.

### v1.6.0 verification ledger

Release-prep automation currently covers these stable-baseline contracts:

| Contract | Evidence |
|---|---|
| Deterministic authenticated browser shell and Backtesting result journey | `frontend/tests/e2e/auth-smoke.spec.ts`, `frontend/tests/e2e/critical-shell-smoke.spec.ts`, `frontend/tests/e2e/backtesting-tabs.spec.ts` |
| Shared cancellable, validated, streaming insight lifecycle | `backend/tests/test_insight_lifecycle.py`, `backend/tests/test_ai_insight_stream.py`, `frontend/src/__tests__/AiInsightCard.test.tsx` |
| Cold-route bundle boundaries | production Vite build plus lazy-loading component tests |
| Disposable PostgreSQL ownership and ingestion parity | CI `postgres-contract` job and guarded PostgreSQL tests |
| Complete generated API schemas, auth metadata, and family matrix | `docs/openapi.json`, `docs/API_REFERENCE.md`, `scripts/generate_api_reference.py --check` |
| Fresh default Docker Compose build, migration, boot, and endpoint smoke | CI `clean-install` job, `scripts/verify_clean_install.sh` |

Automated release preparation completed after PR #137 passed the full CI gate.
The clean-install job is intentionally restricted to GitHub-hosted Actions and
uses a run-ID-namespaced Compose project plus a CI-specific database, user,
ports, and disposable volumes. It refuses self-hosted runners and must not be
repurposed to tear down a deployment host. Release PR #138 merged. Host/user
verification then exposed an API-key list response mismatch, fixed without a
migration in PR #139; its complete CI gate passed. Tag and GitHub release
`v1.6.0` were published from `0dc86db` on 2026-09-10.

### v1.7.0 verification ledger (released)

Release-prep automation covers the final v1 accounting contracts:

| Contract | Evidence |
|---|---|
| Explicit portfolio, transaction, holding-cost, and fee currencies with conservative legacy handling | `backend/alembic/versions/0014_portfolio_ledger_currencies.py`, migration and portfolio route tests |
| Traceable current and dated FX with prior-close, freshness, cache, and unavailable semantics | `backend/tests/test_forex.py` |
| Shared base-currency cash, value, cost, income, fees, and realised/unrealised P&L | `backend/tests/test_portfolio_accounting.py`, `backend/tests/test_portfolio_accounting_routes.py` |
| Consumer agreement across primary summaries, Manager analytics, allocations, and reports | `backend/tests/test_portfolio_primary.py`, `backend/tests/test_portfolio_manager_analytics.py`, `backend/tests/test_watchlist_service.py` |
| Base-currency risk/benchmark history and exact security/FX/interaction attribution | `backend/tests/test_attribution.py`, `backend/tests/test_forex.py` |
| SQLite/PostgreSQL migration and ownership safety | regular backend suite plus CI `postgres-contract` job |
| Typed agent-facing accounting and historical analytics schemas | `docs/openapi.json`, `scripts/generate_api_reference.py --check` |

Implementation completed through PR #145. Historical analytics explicitly model
the current open basket from the date all retained positions existed; they do
not claim closed-position or cash-flow-adjusted ledger performance. Missing
price, denomination, or FX evidence produces partial output rather than a guessed
number. Release preparation merged in PR #146. Its host test exposed that the
honest unknown-currency state lacked a repair path; PR #147 added per-record,
owner-scoped controls and APIs for legacy holding costs, transaction amounts,
and nonzero fees. Host testing confirmed the repair but found the inline controls
too crowded, so PR #148 moved them to a rightmost row action and focused dialog.
The maintainer verified the final behavior; tag and GitHub release `v1.7.0` were
published from `0473307` on 2026-09-15.

### v2.0.0 verification ledger

The release gate is the **existing cross-market context feature**, not every
future v2 evidence or relationship idea. Automated release preparation must
re-run the regular CI checklist above; these feature-specific checks make the
host acceptance concrete:

| Contract | Evidence to verify |
|---|---|
| Authenticated comparison remains usable from equity, Security Hub, and crypto research | `backend/tests/test_market_context.py`, `frontend/src/__tests__/MarketContextPage.test.tsx`, host browser journey |
| US, cross-currency/EU, and crypto-versus-weekday proxy pairs show actual overlap, source dates, native quote units, and appropriate optional FX context | Deterministic backend/frontend tests plus maintainer host cases |
| UTC, exchange-local, Yahoo-adjusted, and own-date views stay separate; partial adjusted data cannot silently shorten a pair | `backend/tests/test_market_context.py`, host inspection of one representative pair |
| Provider errors, missing keys/timezones, stale or insufficient history, and optional-panel failures stay explicit without sample or invented values | Route/UI tests and a degraded host case |
| Completed time-aware Brain and Brain Log foundations remain functional | Regular backend/frontend suites and the general smoke matrix |

Release preparation merged in PR #211. Maintainer testing found that clicking
a proxy suggestion did not add it, although Enter worked; PR #212 corrected the
interaction and passed host verification. The tag and GitHub release `v2.0.0`
were published from `7e467df` on 2026-10-15. Unavailable optional-provider
coverage remains acceptable when the UI says so honestly.
Automatic relationship discovery, portfolio-wide context, grounded AI market
interpretation, and deeper historical evidence contracts are later milestones,
not v2.0 release gates.

### v2.1.0 verification ledger (released)

The bounded milestone checks selected current SEC Company Facts values against
their own filing's XBRL instance, with exact issuer, concept, unit and fiscal
duration. Retained historical vintages and inferred revision order remain later
work. This release requires no database migration or new provider setting;
existing `SEC_USER_AGENT` enables the on-demand requests.

| Contract | Evidence |
|---|---|
| Exact value matches; amendments, conflicting values, missing evidence and provider failures remain distinct | `backend/tests/test_sec_filing_verification.py`, `backend/tests/test_market_sec_facts.py` |
| Download/XML bounds, official source links and exact issuer matching survive live SEC formats | Same backend tests, including split accession-label markup and padded-string CIK regressions |
| Browser checks are opt-in, preserve full fact identity, expose exact values and links, support retries/cancellation and allow the backend deadline | `frontend/src/__tests__/SecFilingFactCheck.test.tsx`, `frontend/src/__tests__/secFilingFactCheckApi.test.ts`, `frontend/src/__tests__/MarketContextPage.test.tsx` |
| Configured US-equity filing journey works on the deployment host | Maintainer NVDA acceptance after PR #215 |

Implementation merged in PRs #213–#214. The first host check exposed real SEC
markup and CIK formats missing from the fixtures; PR #215 fixed both. A direct
live verification of NVDA accession `0001045810-26-000075` corroborated
Revenues/USD 96,221,000,000 for 2026-04-27 to 2026-07-26, with three matching
facts, source links and SEC-reported acceptance metadata. The maintainer then
merged and deployed the fix and confirmed the browser issue resolved.

Local release preparation on 2026-10-18 passed 1,074 backend tests (one skipped)
with 74.24% coverage, 389 frontend tests, the production build, three Chrome
smoke tests, Python compilation, mock/surface/API-reference guards and Compose
configuration validation. Local smoke used installed Chrome through
`PLAYWRIGHT_EXECUTABLE_PATH`; CI keeps the bundled Chromium gate. Clean-install
and disposable PostgreSQL contract verification remain CI jobs.

Release-prep PR #216 passed `build-and-test`, `clean-install` and
`postgres-contract`, then merged. After explicit maintainer release authorization,
the annotated tag and [GitHub release v2.1.0](https://github.com/laanito/OpenTerminalUI/releases/tag/v2.1.0)
were published from `a1efc0c` on 2026-10-18. Publication is complete; the broader
v2.x evidence backlog is not part of this release gate.

### v2.2.0 verification ledger (released)

Grounded Comparison Briefing is bounded to on-demand interpretation of fresh
shared-UTC native provider-close returns. It does not incorporate optional page
panels or private research, establish causation, recommend trades, persist/index
answers or require a database migration/new provider setting. The existing
OpenAI-compatible LLM configuration is used; model capability affects prose
quality, and model tuning is explicitly outside the accepted milestone.

| Contract | Evidence |
|---|---|
| Fresh server-only evidence, exact dates/metrics, packet-local IDs, provenance and explicit scope | `backend/tests/test_market_briefing_evidence.py` |
| Bounded preparation/model/repair, citation-reference coverage, typed unavailable results and cancellation | `backend/tests/test_comparison_briefing.py`, `backend/tests/test_comparison_briefing_routes.py` |
| No partial model prose, no automatic stream replay, fetch/reader deadlines and exact selection/reference validation | `frontend/src/__tests__/comparisonBriefing.test.ts` |
| Opt-in generation, plain-text output, mandatory caveats, snapshot inspection, cancellation and stale-result invalidation | `frontend/src/__tests__/ComparisonBriefingPanel.test.tsx`, `frontend/src/__tests__/MarketContextPage.test.tsx`, desktop/narrow Chrome smoke |
| Crypto chart/snapshot routing cannot turn unsupported Finnhub zero prices into live BTC quotes | `backend/tests/test_crypto_quote_routing.py`, `frontend/src/__tests__/StockDetail.cryptoQuotes.test.tsx`, `frontend/tests/e2e/crypto-stock-detail.spec.ts` |

Implementation merged in PRs #218–#220. Host testing exposed an independent
crypto stock-detail chart-routing regression; PR #221 fixed it. On 2026-10-21
the maintainer confirmed both the crypto fix and that the briefing worked as
intended, while explicitly keeping a smarter model outside this release.

Local release verification on 2026-10-21 passed `make gate`: compilation,
production mocks, API/surface contracts, the full backend coverage suite (1,182
collected, one skipped; 74.90% coverage against the 45% gate), the production frontend build
and 447 Vitest tests across 111 files. Six Chrome smoke tests and Compose
configuration validation also passed. Local Python was 3.12; CI uses 3.11.
PR #222 then passed all three CI jobs: build-and-test, clean-install and
postgres-contract. Disposable verification did not tear down or rebuild the
running deployment. The PR merged at `039c395`, and after explicit maintainer
authorization the annotated tag and
[GitHub release v2.2.0](https://github.com/laanito/OpenTerminalUI/releases/tag/v2.2.0)
were published on 2026-10-21. No further release gate remains open for v2.2.

### v2.3.0 verification ledger (released)

Context beyond price extends the selected comparison briefing with explicitly
included dated news and US/euro-area macro reference-period observations.
Price-only is still the default. Coverage, exact pair windows, current-vintage
semantics and failures remain inspectable; references are checked, not prose
truth or causation. No migration or new provider setting is required. FRED uses
the existing `FRED_API_KEY`; the existing single LLM configuration remains in use.
Fast/Deep task routing is approved for v2.4 and is not a v2.3 release gate.

| Contract | Evidence |
|---|---|
| Deterministic context envelope with exact windows, source times/links, values/flags/counts, local references and explicit omissions | `backend/tests/test_market_briefing_context_evidence.py` |
| Selected-source collection, bounded fan-out/deadlines, isolated source failure, exact source/pair citations and cancellation | `backend/tests/test_comparison_context_briefing.py` |
| Validator-derived reference requirements, sanitized reasons/repair feedback, no raw model replay and unchanged strict checks | `backend/tests/test_briefing_validation_feedback.py`, `backend/tests/test_comparison_briefing.py` |
| Selected-scope transport, context budget, closed references, safe URLs and no automatic inference replay | `frontend/src/__tests__/comparisonContextBriefing.test.ts`, `frontend/src/__tests__/comparisonBriefing.test.ts` |
| Independent opt-ins, scope invalidation, coverage/failures beside prose and exact citation focus | `frontend/src/__tests__/ComparisonBriefingPanel.test.tsx`, `frontend/src/__tests__/MarketContextPage.test.tsx` |
| Default/richer desktop and narrow-screen journeys, source inspection and missing-key degradation | `frontend/tests/e2e/comparison-briefing.spec.ts` |

Implementation merged in PRs #224–#227. On 2026-10-27 the maintainer confirmed
price-only worked and combined news+macro completed after its bounded repair.
The instrumented first attempt logged `context_source_pair`; that does not
diagnose the older uninstrumented failure. The fast model's shallow extraction
and reasoning remain a known limitation, not a claim of semantic verification.
The approved v2.4 scope is recorded in merged PR #228. Automated degraded cases
must not be described as a fully manual host matrix.

Local release verification on 2026-10-27 passed `make gate`: Python compilation,
production-mock/surface/API guards, 1,280 backend tests (one skipped) with 76.05%
coverage against the 45% gate, the production TypeScript/Vite build and 504
frontend tests across 112 files. Eight installed-Chrome smoke tests (including
desktop/narrow default and context journeys) and `docker compose config --quiet`
also passed. Local Python was 3.12; CI uses 3.11. Generated OpenAPI differs only
in its version, now 2.3.0; frontend/lock metadata agree.

Release-prep PR #229 passed CI `build-and-test`, `clean-install` and
`postgres-contract`, then merged at `3fb7de3`. Following explicit maintainer
authorization on 2026-10-28, the annotated tag and
[GitHub release v2.3.0](https://github.com/laanito/OpenTerminalUI/releases/tag/v2.3.0)
were published from that merge. The tagged changelog retains the October 27
preparation date; release notes state the October 28 publication date, reconciled
in the post-release changelog without moving the tag. No v2.3 release gate
remains open. Verification did not rebuild or tear down the running deployment.

## Cutting the release

```bash
# from an up-to-date main with the checklist done
git checkout main && git pull
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <(sed -n '/## \[X.Y.Z\]/,/## \[/p' CHANGELOG.md)
```

Then open the next milestone's tracking and start the `[Unreleased]` section.

## After release

- Patch releases (`X.Y.1`) for fixes; cut from `main`, same checklist (lighter).
- Keep `CHANGELOG.md` updated per PR so the next cut is cheap.

## Documentation site

The `Deploy GitHub Pages` workflow publishes `docs/site` after relevant changes
land on `main`, and it can also be run manually. Before its first successful run,
an administrator must select **GitHub Actions** as the Pages source in
**Settings → Pages → Build and deployment**.

That one-time repository setting is deliberately not automated by the workflow.
The normal `GITHUB_TOKEN` has permission to deploy to an existing Pages site but
does not have the repository-administration permission required to create or
enable one. Do not add `enablement: true` to `actions/configure-pages` unless the
workflow is also supplied a separate token with the documented administration
scope.
