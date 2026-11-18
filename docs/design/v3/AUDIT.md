# Frontend discovery audit

## Evidence and limits

Baseline: `f8d9049` (published v2.8.0 at `61599bc`, followed by documentation-only
reconciliation). Installed Chrome, 1440×1000, 1024×1000 and 390×1000; nine routes,
27 initial-view observations. See [raw measurements](evidence/audit.json),
[reproduction](README.md#reproduce-discovery) and the Portfolio screenshots.

Portfolio has two long-named portfolios, six lots across four instrument symbols,
recorded transactions, mixed USD/EUR source units and a long mandate. Notes and
Journal have long research text. Portfolio risk/benchmark/dividend/correlation
and attribution are deliberately unavailable. Home has a primary-portfolio
fixture but no usable historical reconstruction in this audit. Brain is an
indexed-but-unasked state; Market Context is a new comparison, not a generated
briefing. Security, News and Workstation include generic/empty provider results.
No model was run and no private/live account data was read.

All 27 observations completed without captured JavaScript runtime errors after
correcting an incomplete **audit fixture** for attribution. That fixture issue
is not reported as a product defect. This is an initial discovery sample, not
proof that populated charts, generated answers, modals, every theme or all routes
are responsive. Existing deterministic research browser journeys remain relevant
for deeper states; migrate their evidence inspection cases with the shell.

## Observed findings

| ID | Finding and evidence | Implication / owner |
|---|---|---|
| L1 | At 1024, the shared instrument/market toolbar has a 960px client width and 1197px content width. At 390 it has 390px client width and the same 1197px content width. The root document still reports the viewport width because the shell clips it. | Shared shell must wrap/collapse controls into an accessible menu. A root-width-only check is insufficient. |
| L2 | Portfolio's first holdings grid starts at y=958 on desktop, y=1503 at 1024, y=1908 at 390, before scrolling. Portfolio creation/management, mandate and Add holding precede it. | Reading positions must be the default; creation/management belongs in deliberate secondary flows. |
| L3 | Portfolio's main content scroll height is 2944/4036/5161px respectively. The long mandate is separately scrollable inside its textarea. | Organize by task; do not make every capability part of the initial reading path. |
| L4 | The 240px left portfolio column remains on wide screens and stacks before positions at smaller sizes. Screenshots show duplicate new-portfolio and edit controls. | A floating selector/drawer preserves space. Keep selected scope visible when closed. |
| L5 | Holdings and transaction grids use contained `overflow:auto` (e.g. 338px viewport vs 1092px holdings content at 390). | This is intentional table scrolling, not a page-level defect. Keep inspection/row actions reachable and offer concise position cards on narrow layouts. |
| L6 | The ticker strip overflows at all widths and is deliberately clipped/animated. Some subtitles truncate intentionally. Status/footer and workspace controls also exceed available width at 390. | Distinguish decorative/label truncation from clipped controls; required status and action text needs an alternative view. |
| L7 | Several full-width toolbars and 10–11px labels compete before the task content; desktop Portfolio has multiple shell/header bands. | One page title, one scope bar, one primary action. Review dense metadata sizes and move global secondary controls out of the task's reading path. |

The coordinates depend on fixture text, fonts, viewport and enabled shell rails;
they are discovery observations, not pixel-position acceptance thresholds.

## Route inventory and migration order

| Screen / route | State examined | Finding / follow-up | Planned boundary |
|---|---|---|---|
| Home `/` | Primary holdings; historical inputs absent | Shared narrow toolbar/status clipping; current history clearly unavailable. Preserve actual primary scope and honest history semantics. | Shell in v3.0; dashboard redesign later. |
| Portfolio `/equity/portfolio` | Populated lots/ledger/mandate; unavailable deep analytics | L1–L7; forms dominate; position grouping is absent. | Complete pilot in v3.0. |
| Market Context `/equity/market-context` | New selection, no generated comparison | Shared clipping; page already contains multiple inner `overflow:auto` regions in source. Saved runs and expanded evidence require dedicated migration cases. | Preserve in shared-shell gate; redesign later. |
| Security Hub `/equity/security/AAPL` | Initial overview with limited synthetic provider data | Shared clipping; dense tab/table layouts need populated financial/news/filing checks before page migration. | Later v3.x. |
| Brain `/equity/brain` | 118 indexed chunks; no answer/memo | Shared clipping and truncated panel subtitle. Long answer/citation and Brain Log journeys are not measured here. | Later v3.x, preserving existing answer/save/promotion contracts. |
| Notes `/equity/notes` | Six long notes with tags, dates and long source-like text | Shared clipping; keep effective/recorded dates, edit/delete and source context discoverable. | Later v3.x. |
| Journal `/equity/journal` | Six open synthetic entries with long strategy/rationale | Shared clipping; filters/review hierarchy needs separate design. Journal/Portfolio execution linking stays deferred. | Later v3.x. |
| News `/equity/news` | Synthetic provider envelope; initial controls | Shared clipping. Not a claim that every news mode rendered populated headlines; run each mode before migration. | Later v3.x. |
| Workstation `/equity/chart-workstation` | Workspace shell, provider history unavailable | Shared clipping; desktop workspace toolbar also reports overflowing content. No candle/data-quality judgment from this empty-history case. | Later v3.x. |

## Source-confirmed design constraints

- `frontend/src/components/layout/TerminalShell.tsx`: full-height outer shell,
  hidden overflow, inner scrolling content and optional context rail. Fix the
  constraint chain rather than adding another global `overflow:hidden`.
- `frontend/src/components/layout/IconRail.tsx` is the mounted icon navigation.
  `navigation.ts` and command routing expose a broader tool set. The older
  `Sidebar.tsx` is not evidence of what is currently mounted. Unify discoverability
  without accidentally deleting compatibility/configuration-gated destinations.
- `PortfolioManager.tsx`: fixed `xl:grid-cols-[240px_1fr]`, nested minimum widths,
  duplicated entry surfaces and a single component combining many tasks.
- Its **Performance vs Benchmark** `perfSeries` compounds current per-holding
  unrealized returns across array indices. It has no dated time axis and no
  benchmark series. This is a separate source-confirmed presentation defect from
  the already corrected Home history. Remove/replace it with a correctly scoped,
  dated source during Portfolio migration; do not carry it into the new layout.
- `DenseTable.tsx` already provides virtualization, column controls, frozen cells
  and keyboard selection. Reuse/contain it for detailed views; do not silently
  replace these capabilities with a plain overview table.
- `TerminalModal.tsx` already handles focus trapping, Escape and busy states.
  Extend the existing primitive for bounded scroll/focus restoration rather than
  introducing an incompatible overlay system. Native dialogs in the study are
  an isolated review mechanism, not a production component decision.
- `backend/api/routes/portfolios.py`: Add holding writes both a lot and a `buy`.
  Transaction types currently accept buy/sell/dividend/deposit/withdrawal, not a
  no-cash opening receipt. Consolidation and receipt accounting require backend
  design; moving the existing form cannot implement them.

## Follow-up validation before production migration

Use realistic populated/generated/failed states on the shared shell: comparison
citations and saved runs, Brain answers/Log/promotion, Notes edit dialogs, Journal
entry review, Stock Detail hourly candles and the full Workstation. Include long
symbols/URLs/titles, multiple currencies and unknown basis. Check 200% zoom,
keyboard-only use, focus restoration, screen-reader naming, right rail on/off,
loading/error transitions and direct/saved URLs. Do not mark the baseline's empty
or unasked states as substitutes for those journeys.
