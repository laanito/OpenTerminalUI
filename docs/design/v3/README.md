# v3 discovery: a usable terminal, starting with Portfolio

Status: **design proposal for review**, 2026-11-18. Production remains v2.8.0.
This PR changes documentation and adds an isolated, synthetic HTML study. It does
not change application routes, components, APIs, database schemas or accounting.

The v3.0 proposal is **a shared frontend foundation plus a complete Portfolio
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

These defaults are reviewable in this PR. Any changes should update the scope
and acceptance gate before implementation starts; a mockup is not evidence that
its proposed backend contracts already exist.
