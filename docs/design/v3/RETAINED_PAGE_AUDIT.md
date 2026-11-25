# Remaining retained-page audit after #312

Baseline: `4109cf2`, merged #312, which the maintainer confirms works as intended.
The main workflow reviews are complete. There are concrete page-level gaps in
other retained tools, so v3.0 still needs implementation work before final
acceptance. This makes the existing [scope](SCOPE.md) explicit; it adds no product
features, providers, algorithms or execution capabilities.

## Current implementation progress

The [Paper/Sizer review](PAPER_SIZING_REVIEW.md), merged as #314, implemented the
first batch after #313 and brought dedicated work to 22 render entries. The
[Macro/FX review](MACRO_FX_REVIEW.md) adds four destinations: dedicated work now
covers 26 render entries, including 19 of the 32
tool destinations and three shell-menu extras. Host acceptance for this new pass
is open; fourteen ordinary menu destinations remain. Market overview is next. The counts
and examples below describe the original audit baseline unless stated otherwise.
The source ledger tracks current entry files; the 39 original browser probes and
baseline screenshots stay unchanged.

## Route coverage

The reproducible [route ledger](RETAINED_ROUTE_LEDGER.md) and
[source JSON](evidence/retained-source-audit.json) enumerate the render leaves in
`App.tsx`, rather than treating every file in `pages/` as a shipped screen:

| Inventory | Count | Meaning |
|---|---:|---|
| Leaf render-route entries | 80 | 78 distinct entry files; `/` and `/home`, and the two Security Hub paths, share implementations. |
| Layout shells | 4 | Equity, F&O, Backtesting and Account. |
| Redirect entries | 27 | Bookmarks/aliases retain their existing destinations; these are not 27 new page redesigns. |
| `PRIMARY_NAV_ITEMS` destinations | 32 | Supported/configuration-gated tool list used by the navigation menu. |
| Shell-menu extras | 4 | Home, Notes, Saved views and Account, in addition to the 32 above. |
| Hidden compatibility render entries | 17 | Includes child routes under the hidden Portfolio/Model labs; not promoted by this audit. |

The mounted icon rail is a shorter, already reviewed workflow list. The full
navigation menu also exposes F&O and F&O heatmap links separately; their module
navigation is inside `FnoLayout`. Navigation metadata alone is not proof of
provider availability or page acceptance.

Twenty render entries have dedicated v3 page work: Home (`/` and `/home`), Stock
Detail, Security Hub (base and ticker), Portfolio, Screener, Watchlist, News,
Alerts, Journal, Brain, Notes, Settings, Workstation, Launchpad and its popout,
Chart Compare, Market Context and Saved views. Their evidence remains in the
individual reviews and Portfolio acceptance report. This covers 13 of the 32
listed tool destinations and three of the four shell-menu extras. A merged PR is
recorded as merged; host testing is claimed only where the maintainer supplied it.

The remaining **20 ordinary menu destinations** are the 19 listed below plus
Account. Other direct/compatibility pages receive a bounded review of their
retained UI and availability notices; they are not a reason to build dormant
features or advertise unclassified routes.

## Browser observations

[Raw browser measurements](evidence/retained-browser-audit.json) contain 39
initial-view probes: 13 routes at 1440/1024/390 × 1000. Fresh profiles, synthetic
JWTs and selected typed read fixtures are used. The probes inspect Forex,
Commodities, Economics, Dividends, Position Sizer, Paper, Risk, Backtesting, F&O,
Account, Login, Register and Forgot access.

Forex has synthetic cross rates, candles and long bank names; Dividends has three
calendar rows; Paper has a synthetic portfolio/position and empty order/trade
lists. Position Sizer uses its current calculator defaults. Other provider reads
are deliberately unavailable. Existing frontend fallback samples on Commodities
are the page's own labelled fallback, not successful provider fixtures.

No root document exceeded its viewport width. That does **not** establish that
content fits: the shell can clip a wider descendant. Selected observed examples:

| Surface/state | Observation | Required layout work |
|---|---|---|
| Forex at 390px | A visible page descendant has 717px content inside a 390px viewport; the cross-rate section has 704px content in 364px. The screenshot cuts off matrix columns. Matrix identities use 10px text and the instruction uses 11px. | Contain/name the matrix scroller or provide a narrow view; keep pair selection and full bank names readable. |
| Paper, synthetic portfolio | Ten visible inputs/selects have neither an associated label nor an accessible name. Create/order forms and the hotkey surface precede position review; several metadata labels use 10px. | Label scope, cash, quantity, prices and order options; group existing entry/review flows, retaining their simulation contracts. |
| Position Sizer at 390px | Primary field labels such as Account size and Entry price compute to 10px; long explanatory text is 11px. | Readable labels, units and result/input hierarchy across all existing sizing methods. Preserve formulas. |
| Backtesting at 390px | Asset/Market/Data TF/Start setup labels compute to 11px. This is an initial setup probe, not a completed run. | Readable setup and disclosed secondary controls, followed by populated run/result/error checks. |
| Login/Register/Forgot access | Login/register have small-label candidates and overflow candidates. Forgot access has three inputs without associated/accessibly named labels. | Review their actual shared auth components, wrapping and labelled entry/errors. Do not change authentication contracts. |
| Commodities/Economics/F&O/Risk/Account | Small-label candidates remain in their initial views. Unavailable services limit content examined. | Dedicated populated/configuration/error review before accepting each family. |

Small-text and overflow counts are inspection candidates. Dense numerical cells,
intentional local scrolling and decorative text need judgment; source utility
classes can be overridden. The source scan covers direct entry files only, so a
zero count does not clear descendant widgets (Login and Rotation illustrate why
that distinction matters).

All 39 probes completed without navigation/probe exceptions. The intentionally
503 API reads produced 30 `AxiosError` rejection events across authenticated
shell views; these are retained in the raw evidence, not presented as clean
functional runs or newly proved provider defects. No TypeError/ReferenceError
was observed in this sample. Fixed 1500ms observations can still contain loading
or retries. These are initial probes, not populated acceptance, interaction,
zoom, accessibility or live-provider certification.

- [Mobile Forex clipping](evidence/retained-forex-390.png)
- [Desktop Forex fixture](evidence/retained-forex-1440.png)
- [Desktop Paper forms and position](evidence/retained-paper-1440.png)
- [Mobile Paper](evidence/retained-paper-390.png)
- [Mobile Position Sizer labels](evidence/retained-position-sizer-390.png)
- [Mobile Backtesting setup](evidence/retained-backtesting-390.png)

## Remaining delivery batches

These are coherent review areas, not a promise of one PR per row. Split an area
when the existing components, fixtures or review size warrant it. **Paper and Position Sizer are implemented in the linked review; continue with
the market-overview batch after the implemented [macro/FX pass](MACRO_FX_REVIEW.md).** Their original audit confirms ambiguous entry controls and unreadable
primary labels.

| Order | Retained area/routes | Acceptance focus |
|---|---|---|
| 1 · implemented | Paper `/equity/paper`; Position Sizer `/equity/position-sizer` | Explicit account/symbol/unit/cash labels; readable existing calculator methods; scope and review before secondary setup; retained drafts and honest action outcomes. No new order types, sizing formulas or execution. |
| 2 · implemented | Forex, Commodities, Economics, Yield Curve | Matrix/chart containment, long names, dates, visible current scope and existing provider/fallback disclosures. No new feeds or FX accounting. |
| 3 | Market Heatmap, Rotation, Crypto, ETF Analytics | Responsive plots/tiles, readable filters/legends and actual existing context; populated/failure states. Provider breadth stays unchanged. |
| 4 | Dividends, Risk, Correlation, Stat Lab, Pair Trading | Group scope/setup, readable long labels and local numerical scrolling; review existing outputs and unavailable states without altering analytics. |
| 5 | MTA `/equity/mta`; DOM `/equity/dom` | Useful chart/depth space, readable instrument/interval controls, keyboard/zoom and configured versus unavailable markets. Preserve existing route/provider contracts. |
| 6 | Backtesting `/backtesting`; direct Model governance, Algorithm framework, Portfolio optimizer | Readable setup and dated run/results, bounded inspection, busy/error/draft states. Include direct subpages without expanding their capabilities or promoting experimental tools. |
| 7 | Account, About, Login/Register/Forgot access | Shared auth/account fields, long names, status/error text and keyboard/zoom. No broker/account/security-feature redesign. |
| 8 | Remaining secondary/direct and hidden compatibility routes | Confirm visibility classification, readable retained content or configuration/unavailable notices and bookmarks. Do not restore retired product promises. |

Rows 1–7 cover the 19 unreconciled `PRIMARY_NAV_ITEMS` entries plus Account.
The complete list of those 19 is: Commodities, Forex, About, Heatmap, Dividends,
Paper, Position Sizer, Risk, Correlation, Stat Lab, Pair Trading, MTA, DOM,
Yield Curve, Economics, Rotation, Crypto, ETF Analytics and Backtesting.

Outside the 36 ordinary menu destinations, the 23 unreviewed non-hidden direct
entries comprise auth (3), F&O modules (10), additional Backtesting pages (3),
Dashboard/Data quality/Factors/Intelligence timeline/Mutual funds (5), and Bond
analytics/Option Greeks calculators (2). Auth and additional Backtesting routes
are covered in rows 6–7. Row 8 includes the remaining direct tools and F&O module
pass, including its explicit market/provider notices. The other 17 entries are
already hidden compatibility routes listed with reasons in the ledger/JSON;
reviewing their presentation does not change that classification.

For every implementation slice: use realistic long/populated content, preserve
saved routes/state and existing calculation/write contracts, check 1440/1024/390
and actual 200% zoom, keyboard/focus, retained drafts and failed/late reads.
Table/chart numeric density can remain deliberate; names and required actions
must be readable. Keep functionality defects in the already deferred audit unless
a repair is necessary to preserve the UI being changed, and document that boundary.

## Reproduce and validation

No application source, dependency, API, schema or navigation changes in this PR.
Production build passes. Source extraction is syntax-aware and generated artifacts
pass `--check`; its 80 render leaves + 4 shells + 27 redirects reconcile with all
111 Route declarations in `App.tsx`. JSON parse, script syntax and whitespace
checks pass. Unchanged application unit/backend/full smoke suites were not rerun.
The browser audit is a disposable diagnostic, not a new CI acceptance lane.

```sh
node docs/design/v3/retained-source-audit.mjs
node docs/design/v3/retained-source-audit.mjs --check
VITE_API_BASE_URL=http://127.0.0.1:8010/api VITE_E2E_AUTO_LOGIN=0 npm --prefix frontend run build
npm --prefix frontend run preview -- --host 127.0.0.1 --port 4185 --strictPort
# In another terminal, use the path to an already installed Chrome executable:
AUDIT_APP_URL=http://127.0.0.1:4185 PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chrome node docs/design/v3/retained-browser-audit.mjs
```

The browser script only permits a local HTTP preview, intercepts every API request,
blocks writes/models/WebSockets and non-preview origins, and uses fresh contexts.
The only external origin attempted in this run was the existing flag image host,
which was blocked. No API writes were attempted or performed; browser storage
changes were confined to disposable synthetic profiles. No live providers,
models, account data or production/deployment access are used.

Release preparation still requires the remaining page work, broader acceptance
checks and maintainer approval under the existing scope.
