# v3 discovery: a usable terminal, starting with Portfolio

Status: **discovery/design accepted through merged PR #286**, 2026-11-18.
The standalone HTML study remains isolated and synthetic. Production shell work
is tracked below; the study itself implements no APIs, schemas or accounting.

The accepted v3.0 gate is **a shared frontend foundation plus a complete Portfolio
workflow**. Other screen redesigns belong to explicit v3.x scopes. The shared
shell must keep those screens reachable and functional during the transition.

## Review the proposal

1. Read the [observed audit](AUDIT.md), including its fixture limitations.
2. Open the [interactive Portfolio study](portfolio.html) locally, or use the
   screenshots below. GitHub source views do not execute HTML.
3. Read the [workflow and accounting boundaries](PORTFOLIO.md).
4. Review the [v3.0 scope, delivery order and acceptance gate](SCOPE.md).

From the repository root, serve **only this design directory**:

```sh
python3 -m http.server 4186 --bind 127.0.0.1 --directory docs/design/v3
```

Open `http://127.0.0.1:4186/portfolio.html`. No dependencies or backend are needed
for the study. Its scripts make no network requests or persistence writes. The
navigation rail is an information-hierarchy sketch, not live application links.
Activity, Research, Analytics and Manage illustrate section organization; their
sample contents are labelled and do not implement existing production features.
The drawer and position/operation interactions are functional locally.

Try these journeys:

- Switch between all portfolios, Core and Europe. Open AAPL to inspect its two
  lots, then start a sell in its actual portfolio.
- Record a buy. All-portfolios scope requires choosing the target portfolio.
  Review separate trade and fee currency legs; confirm to see the explicit
  **nothing saved** result.
- Try selling more than the fixture holds. Add an existing position with unknown
  cost basis and inspect its no-cash review.
- Select missing FX/basis, empty and retrieval-failure scenarios. Missing values
  remain distinct from zero; a failed load is distinct from an empty portfolio.
- Use keyboard Tab/Escape through native dialogs, then repeat at a narrow width.

## Screenshots

All amounts, dates, people/accounts and research text in these captures are
synthetic. Baseline captures use the actual v2.8 frontend with intercepted API
responses; proposed captures use the standalone study.

| Width | Current Portfolio | Proposed overview | Proposed operation |
|---|---|---|---|
| 1440 | [Before](evidence/portfolio-before-1440.jpg) | [Overview](evidence/portfolio-proposed-1440.jpg) | [Unknown-basis receipt](evidence/operation-proposed-1440.jpg) |
| 1024 | [Before](evidence/portfolio-before-1024.jpg) | [Overview](evidence/portfolio-proposed-1024.jpg) | [Unknown-basis receipt](evidence/operation-proposed-1024.jpg) |
| 390 | [Before](evidence/portfolio-before-390.jpg) | [Overview](evidence/portfolio-proposed-390.jpg) | [Unknown-basis receipt](evidence/operation-proposed-390.jpg) |

## Reproduce discovery

Use the existing installed Chrome; do not install another browser for this PR.
The scripts import the repository's existing Playwright dependency. The macOS
Chrome path is the default; other hosts can set `PLAYWRIGHT_EXECUTABLE_PATH`.

For the baseline, build the current frontend in the same fixture-enabled mode
as existing browser smoke checks, then start the preview in another terminal:

```sh
VITE_E2E_AUTO_LOGIN=1 npm --prefix frontend run build
npm --prefix frontend run preview -- --host 127.0.0.1 --port 4185 --strictPort
node docs/design/v3/audit.mjs
```

`audit.mjs` accepts only a localhost `AUDIT_APP_URL` (default port 4185), supplies
fake browser authentication, blocks writes/model calls and external requests,
and intercepts API reads. It never launches a backend or opens a database. The
JSON records generic fallback paths rather than presenting them as fully
populated provider states. Intentional ticker/table scrolling also appears in
its overflow candidates; interpret them with [AUDIT.md](AUDIT.md).

For the proposed study, keep the design server on port 4186 running:

```sh
node docs/design/v3/verify-prototype.mjs
```

This runs the documented interaction checklist at 1440, 1024 and 390 pixels and
updates its screenshots/[review record](evidence/prototype-review.json). It is
not a production regression suite, inference benchmark, financial validation or
full accessibility audit. No new CI lane is introduced for this disposable study.

## Decisions proposed for this review

- Keep the terminal's dark identity and orange accent; improve hierarchy and
  reading sizes. Reuse existing components rather than choosing a new framework.
- Start with a consolidated all-portfolios overview; retain the selected scope
  explicitly and support portfolio/lot drill-down before an execution.
- Make Buy/Sell the primary entry. Existing-position/external-receipt entry is a
  distinct no-cash flow with explicit accounting support, not a relabelled buy.
- Establish the common shell across existing routes, then use Portfolio as the
  first complete page migration. Keep other screen redesigns outside v3.0.

These defaults were reviewed in PR #286. Any later changes should explicitly
update the scope and acceptance gate; a mockup is not evidence that
its proposed backend contracts already exist.

## First implementation slice: responsive shared shell

Discovery PR #286 is merged. The first production slice implements a grouped
**Menu** in the GO bar at every width, collapsible market/workspace controls below
1280px, bounded shared dialogs and an accessible status-detail view. Existing
icon navigation, GO commands, bookmarks and configuration-gated disclosures
remain available. Contextual/experimental surfaces are not promoted into primary
navigation by this slice.

The shell now reserves bottom-navigation space on mobile. The status summary
keeps UTC, quote connection and alert count visible, with market sessions on
wider screens. **Status details** exposes all clocks/sessions and labels loop
lag/heap as browser diagnostics; missing session reports remain unavailable.
This does not add provider data, new health measurements or system CPU telemetry.

Shared dialogs are portalled above the shell, bounded to the viewport, scroll
internally, retain focus during callback/busy updates and return focus on close.
Only the top shared dialog handles Escape/Tab. Navigation/GO/trading shortcuts do
not escape an active shared dialog. This is not a complete accessibility audit.

Validation: 834 frontend tests and production build pass. All 45 installed-Chrome
smoke journeys pass, including six shell cases at 1920×1000, 1440×1000,
1024×768, 390×800, 320×700 and 720×500. These are CSS viewport checks, not a claim
that physical 200% browser zoom or all mobile keyboards were independently tested.
Existing generated/captured research and candle inspection cases remain green.

Remaining foundation work includes common page/scope/data-state primitives,
fuller zoom/accessibility review and any further shared layout changes justified
by page migration. Consolidated reporting, non-cash receipts and the Portfolio
page redesign are not implemented by this shell slice. Discovery evidence stays
as its original baseline rather than being regenerated to hide the old findings.

## Portfolio page, scope and read states

Shared-shell PR #287 is merged. The next slice introduces reusable page headings,
wrapping actions, explicit scope facts and data-state presentation. Portfolio's
equity and mutual-fund modes use the page pattern while preserving mode URLs and
saved-view filters. The equity manager displays its selected portfolio, persisted
currency and benchmark, independently of global market controls.

Loading and failed reads hide prior details and actions. Retry reloads the selected
scope; late abandoned responses cannot replace current data. A disappeared requested
portfolio is reported as unavailable rather than silently substituted. A successful
empty portfolio list, zero holdings and partial backend accounting are distinct
states; mutation failures do not erase successfully loaded data.

Validation: all 838 frontend tests, production build and 47 installed-Chrome smoke
journeys pass. New 1440px/390px journeys exercise pending/failed/retried switches,
empty holdings with zero cash, partial accounting, mode URL restoration and overflow.
This is frontend state/layout work: consolidated reporting, receipts, operation
contracts and the position-first workflow remain upcoming. Physical zoom and full
accessibility review remain release checks; existing audit evidence is unchanged.

## Read-only consolidated Portfolio reporting

Page/scope/state PR #288 is merged. The next backend slice adds bearer-authenticated
`GET /api/portfolios/report`: all owned portfolios or explicitly selected owned
IDs, with a required supported reporting currency. It reads only and does not
create a primary portfolio, change bases or write holdings/ledger rows.

Native holding/transaction/fee inputs are recalculated in reporting currency,
with dated FX and each portfolio's ledger replay kept separate. Original lots,
portfolio membership, accounting methods and FX evidence remain inspectable.
Complete totals and known subtotals are distinct per metric. Exact stored
symbol/exchange/supported-unit grouping is conservative; unresolved identity
keeps lots separate and currency/listing variants are not merged. Foreign
starting cash uses an explicitly disclosed creation-date recording boundary,
not an invented verified deposit date. See the [reporting contract](../../wiki/Portfolio-Reporting.md).

There is no schema, dependency or UI change. Non-cash receipts, explicit unknown
basis, atomic/duplicate-safe operations and the full position-first Portfolio
workflow remain separate implementation slices within the accepted gate.

Validation: full backend run 1,934 passed / three PostgreSQL-only skipped at
78.69% coverage. The final focused reporting run passes all 22 cases, including
two additional UTC-boundary/historical-FX cases after final read-path hardening.
Compilation, surface inventory, mock guard and generated API-reference checks
pass. No frontend/browser rerun for this backend-only slice; #288 remains the
last frontend regression baseline.

## Consolidated screen and reviewed operations

Reporting PR #289 is merged. The screen now consumes its one/all-owner report,
with a floating selector, explicit currency, expandable original lots and reviewed
Buy/Sell/cash entry. Existing positions use a separate modal and non-cash `opening`
ledger event. This first entry path requires documented basis/acquisition date;
unknown basis is still an open gate. Contribution market value is separate from
cost and missing entry value does not become a guessed capital flow.

Stable UUIDs freeze each submitted target/body and support manual replay/lookup
without automatic retry. Portfolio locks serialize SQL-only writes, oversells
fail before mutation, and the original ledger/holding changes commit together.
Existing management, activity, repair, research, import/export and single-account
analytics remain reachable in a secondary disclosure. The misleading per-holding
pseudo-performance chart is removed. This is still an incremental migration:
fuller secondary navigation, unknown basis and final accessibility/zoom/release
acceptance remain. See the [current contract](../../wiki/Portfolio-Reporting.md)
and additive migration `0021_portfolio_operations`.

Validation: full backend run 1,955 passed / three PostgreSQL-only skipped at
77.40% coverage, followed by all 166 Portfolio tests after final date/P&L changes.
All 838 frontend tests, production build and 55 Chrome smoke journeys pass.
Migration checks cover a disposable full-chain SQLite upgrade, legacy/NULL
preservation, retained metadata on rollback, idempotence and PostgreSQL DDL.
Actual migrated PostgreSQL operation/concurrency coverage belongs to the guarded
CI lane. API/surface/mock/compile/whitespace guards pass. Original design audit
evidence is unchanged; current 1440px/390px workflow screenshots were reviewed.
