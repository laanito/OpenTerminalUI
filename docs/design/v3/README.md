# v3 discovery: a usable terminal, starting with Portfolio

Status: **discovery/design accepted through merged PR #286**, 2026-11-18.
The standalone HTML study remains isolated and synthetic. Production shell work
is tracked below; the study itself implements no APIs, schemas or accounting.

**Scope correction, 2026-11-20:** v3 is the frontend overhaul, not a Portfolio-only
release. Portfolio is a completed pilot; populated page hierarchy and readable
names/controls remain in v3.0. The maintainer's Equity feedback starts the next
slice, now accepted through #294. The [Home review](HOME_REVIEW.md) is accepted
through #296 and [Security Hub](SECURITY_REVIEW.md) through #297. The current
[comparison research review](COMPARISON_REVIEW.md), accepted through #298, keeps
long evidence reading full width. The [Brain review](BRAIN_REVIEW.md), accepted through #299, applies that reading
pattern to dated private/captured research. The [Notes and Journal
review](NOTES_JOURNAL_REVIEW.md), accepted through #300, extends readable capture,
editing and full-width entry review to the private record. The [News review](NEWS_REVIEW.md),
accepted through #301, puts headlines first, with readable source names, prose
and separately scoped sentiment/research context. The current [Workstation
review](WORKSTATION_REVIEW.md) keeps real plots visible and pane controls readable,
with disclosed workspace/chart tools and visual reflow that preserves saved layouts.
The [Screener review](SCREENER_REVIEW.md) gives results full width, discloses the
preset library and independent scan, labels query/formula fields and makes
company inspection available at every breakpoint; the maintainer accepted #305.
The subsequent [Watchlist review](WATCHLIST_REVIEW.md) addresses another retained-
page layout gap, followed by the [Saved Views review](SAVED_VIEWS_REVIEW.md) for a
readable all-scope hub and bounded shared workflow controls (#309 merged). The
[Alerts review](ALERTS_REVIEW.md) adds readable rules, labelled condition/delivery
forms and independent retrieval/action feedback; #310 is merged and maintainer-
tested. The [Settings review](SETTINGS_REVIEW.md) groups browser preferences,
automation access, data tools and host setup with readable labelled controls and
retained drafts; #311 is merged. The [Launchpad review](LAUNCHPAD_REVIEW.md)
reflows narrow panels without rewriting saved geometry, gives titles room and
uses bounded panel/template controls; #312 is merged and maintainer-accepted.
The [remaining-page audit](RETAINED_PAGE_AUDIT.md) reconciles 80 render entries,
keeps redirects/hidden routes distinct and records 39 initial browser probes.
The [Paper/Sizer review](PAPER_SIZING_REVIEW.md) implements the next two menu
destinations (#314 merged). The [macro/FX review](MACRO_FX_REVIEW.md) adds four
more (#315 merged, frontend maintainer-accepted). The [market-overview review](MARKET_OVERVIEW_REVIEW.md)
adds Heatmap, Rotation and ETF Analytics (#317 merged and maintainer-accepted).
The separate [Crypto review](CRYPTO_REVIEW.md) covers its eight modules; #318 is
merged and the frontend accepted. Reported non-live derivatives belong to v5.
The [Dividends review](DIVIDENDS_REVIEW.md) covers four retained income views
(#319/#320 merged; legacy income issue recorded for v5). The
[Risk review](RISK_REVIEW.md) covers overview/factors/stress and scoped reference
context (#321 merged and maintainer-accepted). The
[Correlation review](CORRELATION_REVIEW.md) adds the matrix, rolling-pair and
cluster workflows; #322/#323 are merged and maintainer-accepted. The
[Stat Lab review](STATLAB_REVIEW.md) covers seven retained analyses, captured runs
and exact-value inspection; #324 is merged and maintainer-tested. The
[Pair Trading review](PAIR_TRADING_REVIEW.md) adds four explicit captured-run
workflows, readable plots and exact tables (#325 merged). The
[MTA review](MTA_REVIEW.md) gives its four contexts real plot height, readable
controls, exact observations and independently scoped read states; #326 is merged
and maintainer-confirmed working. Home’s Launch Matrix links to MTA under Research
(#327 merged). The [DOM review](DOM_REVIEW.md) adds readable depth/tape inspection
and explicit retrieval/coverage states; #328 is merged, with the Home Markets
shortcut merged as #329. Host acceptance is open. The [Backtesting console review](BACKTESTING_REVIEW.md)
adds readable setup, captured runs and bounded result inspection (#330 merged).
The [direct research review](BACKTESTING_RESEARCH_REVIEW.md) adds Model Governance,
Algorithm Framework and Portfolio Optimizer (#331 merged). The
[Account/About/auth review](ACCOUNT_AUTH_REVIEW.md) adds six render entries,
including both About variants and three auth forms. Dedicated work covers 47
render entries, all 32 primary tools and four shell-menu extras. Ordinary menu
coverage is complete; other direct/secondary/hidden presentation, optional Mosaic
and wider acceptance remain. Prioritize the separately recorded recovery
hardening follow-up, then continue the remaining route review.
Broader populated/keyboard/zoom and maintainer acceptance
remain open; the icon-rail pass does not cover the entire tool menu.
See [current scope](SCOPE.md); do not propose release prep merely because
the pilot's automated acceptance checks pass.

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
  first complete page migration. The original proposal deferred other pages;
  the maintainer's corrected scope above brings retained-page usability into v3.0.

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

## One portfolio scope and a shorter analysis path

The maintainer accepted #290 and requested a coherent layout follow-up. The top
bar now owns selection, creation and settings; the former manager sidebar and
its duplicate summary/holdings/activity presentation are removed. Selection can
switch directly between accounts without returning through all-owned scope.
Creation preserves the chosen scope and selector focus returns after selection.

Expanded holdings have original-lot dense tables and position-research access.
One All movements table is collapsed by default and fetches the selected accounts'
activity only when opened. Currency repair remains available on the owning lot
or movement. Sector and current-value distribution pies share the holdings area,
using complete reporting-currency market values, excluding cash. Missing sector
coverage and missing valuation are separate states, never partial pie charts.

Advanced analysis follows the same single-account scope directly below the two
collapsed movement/evidence rows. All-owned scope does not silently analyze a
primary portfolio. Creation, mandate/settings, existing import/export and repairs
use focused dialogs; operations retain the reviewed #290 workflow and financial
contracts. This follow-up changes no backend API, schema, accounting or dependencies.
Unknown-basis/entry-valuation repair and complete release accessibility/zoom
acceptance remain open. The original discovery audit is preserved as baseline.

Validation: all 844 frontend tests / 138 files, production build and 57 installed-
Chrome smoke journeys pass. Desktop/mobile cases verify creation without changing
scope, direct account switches, selector focus, both rendered pies, collapsed
cross-account movements and visible single-account analysis. Unit tests cover
missing valuation/sector currency gaps, custom benchmarks, repair ownership and
late/failing movement reads. Current 1440px/390px screenshots reviewed. Whitespace
passes; no backend suite rerun for this frontend-only follow-up.

## Unknown opening basis and evidence repair

The maintainer confirmed #291 merged. Existing positions can now explicitly
retain unknown acquisition cost (SQL NULL, distinct from documented zero), while
current market value and cash remain independently available. The existing
per-symbol/per-account weighted-average pool keeps affected cost/unrealized P&L
and subsequent realized gains unavailable until evidence is repaired. No-sale
realized P&L stays zero. Closing a pool permits later known current basis without
erasing earlier unknown gains. Native documented lot amounts remain inspectable.

Opening evidence is reachable from a current lot and its All movements row,
including after full sale. Reviewed, owner-locked repairs use stable IDs and
expected revisions, preserve prior evidence, and change no quantity, observation
date, cash or fees. Contribution value remains independent of acquisition cost;
missing entry value can be repaired without another movement. Exact lots merged
with later buys refuse basis replacement pending reconciliation. Generic legacy
currency repair cannot bypass the opening audit. See the
[current contract](../../wiki/Portfolio-Reporting.md#unknown-basis-and-evidence-repair).

Migration `0022_unknown_opening_basis` drops the two cost-column NOT NULL
constraints without old-row rewrites. SQLite preserves data and constraints via
batch copy; rollback retains nullable evidence. Pre-unknown-basis binaries are
unsafe writers once such rows exist. No production DB was accessed.

Validation: full backend 1,969 passed / three PostgreSQL-only skipped, 77.39%
coverage; final 182-test Portfolio domain run includes four added edge cases.
All 847 frontend tests / 139 files, build and 59 installed-Chrome smoke journeys
pass. New desktop/mobile journeys cover unknown entry, independent contribution,
review/retry and lot/movement audit inspection; screenshots reviewed. Disposable
SQLite full-chain and preserving downgrade/re-upgrade checks, PostgreSQL DDL,
API/surface/mock/compile/whitespace guards pass. Actual migrated PostgreSQL repair
and concurrency tests run in the existing guarded operation CI lane.

Remaining v3.0 work is the complete populated keyboard/physical zoom/accessibility
and Portfolio acceptance review, then maintainer release approval. This slice
does not start another screen overhaul or bump the published v2.8.0.


## Portfolio acceptance pass

Following merged #292, the populated keyboard/zoom/layout review fixes configured
row heights, virtual row focus/scrolling, native control keys, keyboard column
options/resizing, revealable default-hidden evidence and theme/contrast/focus.
Disclosure summaries participate in modal focus wrapping; confirmed Portfolio
writes return focus to an announced result if refreshing removes their opener.
No backend/accounting/schema/dependency change. The
[acceptance report](ACCEPTANCE.md) records cases, limitations and scope mapping.
852 frontend tests, build and 65 Chrome smoke journeys pass, including native
200% zoom and Notes/Journal edit/save/cancel regression cases. Maintainer review
and CI still precede release prep; no additional screen redesign is started.


## Equity chart-first layout and shared label readability

Following #293, maintainer testing identified the remaining page-level gap.
Stock Detail now keeps its chart/controls first, with latest price, instrument/
market identity, cross-market context and active studies in a readable right
column at desktop/tablet widths. Narrow layouts keep the chart first and context
below it. Indicator search, configuration, favorites, templates and custom JS use
a wide hideable side drawer; templates/custom tools have a separate disclosure.
Parameters use a bounded nested dialog with independent Save/Cancel and focus.
Existing instance, pane/scale, template and persistence contracts remain intact.
The NFO-only futures search is retained for Indian instruments and no longer
clutters US/crypto context.

Shared panel headings wrap at 14px, descriptions at 12px, and action/badge labels
use readable 12px defaults without extreme tracking. This improves retained
screens but is not proof that every page has been overhauled. Chart quote/candle,
AI evidence, navigation and financial contracts remain unchanged. Continue with
populated Home/Market/Security, research (comparison, Brain, Notes/Journal),
News and Workstation/Screener page reviews, fixing real hierarchy/readability
issues rather than beginning new features. Release prep remains on hold.


Validation for this slice: 854 frontend tests / 141 files, production build and
69 installed-Chrome smoke journeys pass. Four new journeys cover BTC layout and
indicator operations at 1440/1024/390px plus populated AAPL chart/performance.
Existing candle hover, quote routing, evidence, Portfolio/native zoom and editing
regressions pass. No backend/API/accounting/schema/dependency change; unchanged
backend suite not rerun. API-reference/mock/surface/whitespace guards pass.

Reviewed synthetic captures: [chart-first desktop](evidence/equity-chart-first-1440.png),
[wide indicator library](evidence/equity-indicators-1440.png),
[mobile library](evidence/equity-indicators-390.png). These support the Equity
slice only; the broader page reviews remain open in the scope/backlog.
