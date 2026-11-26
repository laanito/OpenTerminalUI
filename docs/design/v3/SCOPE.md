# v3.0 scope and acceptance gate

Release sequence agreed 2026-11-25: this release remains the frontend overhaul.
v4 builds the curated OTUI MCP interface for external LLM agents; v5 verifies and
repairs retained functionality; new capabilities resume from v6. See the
[product generations](../../wiki/Roadmap.md#product-generations). Neither the MCP
nor the wider functionality audit expands this frontend gate.

Status: discovery accepted through #286, **scope corrected by maintainer feedback
on 2026-11-20**. The Portfolio pilot and its local acceptance report are completed
slices, not acceptance of the entire frontend overhaul. v3.0 remains open for
page-level hierarchy, usable controls and readable labels across retained screens.
The [Portfolio report](ACCEPTANCE.md) is historical evidence for that workflow.

After accepted #312, the [remaining-page audit](RETAINED_PAGE_AUDIT.md) reconciles
all route entries and documents concrete gaps in other retained tools. Twenty
ordinary menu destinations needed a dedicated page review at that baseline.
The [Paper/Sizer implementation](PAPER_SIZING_REVIEW.md) covers the first two and
#314 is merged. The [macro/FX implementation](MACRO_FX_REVIEW.md) adds four more
destinations; #315 is merged and the frontend is maintainer-accepted. The
[market-overview implementation](MARKET_OVERVIEW_REVIEW.md) adds Heatmap, Rotation
and ETF Analytics (#317 merged and maintainer-accepted). The separate
[Crypto implementation](CRYPTO_REVIEW.md) covers its eight modules (#318 merged,
frontend accepted). Non-live derivatives are recorded for v5. The
[Dividends implementation](DIVIDENDS_REVIEW.md) adds four income views;
work is merged as #319/#320; the reported income issue is on v5. The
[Risk implementation](RISK_REVIEW.md) adds overview/factors/stress (#321 merged
and accepted). The [Correlation implementation](CORRELATION_REVIEW.md) follows;
it is accepted through #322/#323. The [Stat Lab implementation](STATLAB_REVIEW.md)
adds seven retained analyses and captured-run inspection (#324 maintainer-tested).
The [Pair Trading implementation](PAIR_TRADING_REVIEW.md) adds four explicit runs,
readable plots and exact tables; host acceptance is open. Five ordinary
destinations remain, starting with MTA/DOM.
Initial probes and source hints do not replace the
populated, keyboard/zoom and maintainer checks below. Hidden compatibility and
configuration classifications remain unchanged; no new features are added.

## Release north star

**No wasted blank spaces and no unreadable labels.** The maintainer accepted
the Equity layout in merged #294 as the reference for the remaining v3 work.
Use available space to keep the primary task visible, place related context
together and disclose secondary controls when needed. Preserve intentional
spacing for readability; do not fill gaps with extra features or squeeze text
to fit more panels. Names and actions must remain readable with long content,
narrow screens and 200% browser zoom. Review populated layouts, not just empty
screens or navigation smoke tests.

## v3.0 delivers

- A shared responsive application shell and reusable layout/state patterns,
  applied without breaking existing routes, navigation, shortcuts or evidence
  journeys. Preserve the dark terminal identity and existing theme choices.
- A complete Portfolio pilot: consolidated positions, one/all scope with lot
  drill-down, floating selector, operations as the main entry, honest non-cash
  existing-position receipts and distinct homes for rationale/mandate/thesis.
- Backend accounting/consolidation work strictly required by that pilot, with
  owner boundaries, historical FX, unknown-basis and migration safety.
- Existing Portfolio capabilities organized into discoverable secondary sections,
  with the misleading per-holding “performance” curve removed/replaced.
- Equity/Stock Detail puts the chart first: quote/market/cross-market context in
  the price column, an active-study summary and a wide hideable indicator manager.
- Retained pages receive a populated hierarchy/readability pass. Small or clipped
  name labels, controls that overflow and secondary content obscuring the primary
  task are release issues, not automatically deferred because Portfolio passed.

No framework rewrite, new UI framework, broad dependency replacement or permanent
parallel old/new application is proposed. Reuse/evolve TerminalShell, TerminalPanel,
DenseTable, TerminalModal and existing tokens. Extract Portfolio responsibilities
by workflow rather than replacing the application with one new giant component.

## Shared patterns to establish

| Pattern | Contract |
|---|---|
| Page frame | One title, visible current scope, one primary action. Flexible children use `min-width:0`; content owns predictable vertical scrolling. |
| Scope bar | Distinguish instrument/market, portfolio selection, reporting currency and captured evidence scope. Do not let a global ticker silently retarget a Portfolio operation or saved research. |
| Navigation | Keep existing URLs and direct links. Group Home, Markets, Portfolio, Research and Workspace conceptually; preserve access to all retained tools via navigation/GO. Distinguish chart Compare from Market Context. Configuration-gated tools keep their disclosures. Final labels/mapping are reviewable, not route deletions. |
| Typography | Readable panel names (14px), descriptions and control/badge labels (12px or larger), with normal tracking/wrapping. Dense numerical tables can retain deliberate compact typography; primary names cannot depend on clipping or tooltips. Monospace for numbers/identities where useful; full text/dates remain available. Reuse theme tokens with verified contrast. |
| Adaptive data | Summary positions/cards on narrow screens; original lots use per-holding dense tables, with one collapsed All movements table for the selected accounts. Put intentional horizontal scrolling inside named, focusable table/chart regions. Preserve sort/filter/columns/export/keyboard behavior where supported. |
| Overlays | Drawer/modal fits available height, scrolls internally, has a name, close action, Escape policy, focus trap/restoration and busy/uncertain-state behavior. No permanently reserved portfolio column. |
| Progressive disclosure | Positions before data-entry forms. Keep detailed evidence, FX/basis issues and legacy diagnostics inspectable; active failures stay visible. |
| Async states | Distinct loading, empty, filtered-empty, partial, error, stale and unavailable. Scope changes cancel/ignore late responses. Missing is not zero; failed refresh must not leave apparently current old totals. |

The HTML study illustrates Portfolio hierarchy and local dialogs. Its static rail,
fixed USD reporting, illustrative secondary sections and native dialog implementation
are not a complete implementation of the common shell or accounting contracts.
Mobile navigation and global GO/search are intentionally not implemented in the
study and remain required in the shared-shell slice.

## Delivery sequence

| Slice | Reviewable outcome | Depends on |
|---|---|---|
| Discovery (this PR) | Audit evidence, standalone study, workflow/domain boundaries and release acceptance. | Published v2.8 baseline. |
| Shared foundation | Fix header/status constraint chains; responsive navigation/scope/actions; extend layout/overlay/table patterns. Demonstrate populated research and keyboard/zoom cases. | Accepted design. |
| Portfolio domain contracts | Owner-scoped consolidated reporting and auditable receipts/unknown basis; atomic and duplicate-safe operations; accounting/history/export consumer coverage and additive migration plan. | Accepted PORTFOLIO contract. |
| Position-first Portfolio | Consolidated overview, drawer, instrument→portfolio→lot detail, partial/empty/error states. | Shared foundation + reporting contract. |
| Operations and secondary sections | Reviewed Buy/Sell/receipt, retained cash operations, Research/Analytics/Manage paths, existing feature access and honest chart replacement. | Domain support + position drill-down. |
| Equity and retained-page usability | Chart-first Equity, split indicator summary/library, readable shared names; inspect Home, research, news, market and workspace layouts in populated states. | Shared foundation and completed Portfolio work. |
| Release acceptance | Populated responsive/keyboard workflows, accounting/migration/ownership parity, regression gates, user review and explicit release prep. | All above. |

These are delivery boundaries, not a mandatory PR count. Domain and shell work can
be reviewed independently where useful, but non-cash entry cannot ship before its
accounting/history support. Sequence the retained-page usability work into
reviewable PRs without adding new product features. The maintainer explicitly reopened it on
2026-11-20; complete those reviews before proposing release prep.

## Concrete release acceptance

1. At 1440, 1024 and 390px, global navigation/search, current scope, primary actions
   and status remain reachable. No required control is merely clipped by a hidden
   ancestor. Review 200% zoom and right-rail on/off; narrow behavior is deliberate.
2. A returning/direct-linked user sees the correct explicit portfolio scope.
   First visits offer all owned portfolios. Consolidated positions precede entry
   forms. Switching scope or closing a drawer does not lose visibility of scope.
3. The same instrument in two owned portfolios consolidates once and drills into
   both original lots. Distinct market/quote identities remain separate. Another
   user's portfolio IDs/data cannot be read, summed or mutated.
4. Native quote, cost and fee currencies remain explicit. Reporting changes use
   valid accounting/dated FX rather than relabelled totals. Partial conversion or
   basis affects the correct metric; zero, missing and known subtotals differ.
5. Buy/Sell review names the target portfolio, instrument, quantities, dates,
   currencies, fees, allocation and rationale. Server-side oversell checks prevent
   unintended shorts and partial writes. Existing cash operations remain usable.
6. An existing-position receipt creates no fictitious buy, cash deposit or gain.
   Known/unknown basis, as-of/acquisition dates and external capital-flow valuation
   are independent; subsequent sales/history preserve those distinctions.
7. Double clicks and uncertain responses cannot duplicate operations. Validation
   failure preserves input; an ambiguous acknowledgement offers reconciliation
   rather than automatic resubmission. Scope changes cannot retarget pending work.
8. Create/edit/delete portfolio, existing import/export and currency repairs remain
   discoverable. Old imports disclose their buy/cash effect. Existing direct links,
   saved views, GO/keyboard routes and primary-portfolio consumers still work.
9. Portfolio mandate, current position research and execution rationale retain
   their identities and existing Brain indexing behavior. No duplicate Journal
   execution, automatic memo promotion or destructive thesis migration occurs.
10. Risk/benchmark/correlation/dividend/attribution/event/backtesting and explicit
    AI technical-scope workflows remain accessible. New grouping does not imply
    consolidated historical analytics. Charts show actual dated methodology or
    unavailable states; remove the array-indexed pseudo-performance line.
11. Table inspection, local scrolling, filtering/sorting/export and lot actions work
    with many positions, long symbols/names/URLs, mixed currencies and fractional
    quantities. Narrow cards preserve detail access. No page-wide overflow fix
    may hide required information.
12. Keyboard users can open/close selectors, traverse tabs and review operations;
    focus order, trapping/return, labels, validation and announcements are checked.
    Verify contrast, reduced motion and meaningful screen-reader structure.
13. Shared-shell regression cases preserve populated Stock Detail candle inspection,
    comparison citations/saved runs, Brain answers/Log/promotion and Notes/Journal
    editing, including cancelled/late/failed async work. Inspect their own layout,
    label readability and primary-task hierarchy with populated data; passing
    shared-shell tests alone does not complete the frontend overhaul.
14. Relevant backend/frontend/browser gates pass; migrations/legacy preservation,
    ownership and currency/receipt parity pass disposable SQLite and guarded
    PostgreSQL/fresh-stack lanes. Do not touch production data during development.
15. Maintainer acceptance precedes release prep. Release documentation names the
    shipped scope and outstanding v3.x work; tag/publication follows authorization.

## Explicitly outside v3.0

A framework rewrite, new research algorithms or new product features are not
required to correct the retained frontend. Page/layout/readability improvements
for Home, Market/Security, comparison research, Brain/Notes/Journal, News and
Workstation are no longer categorically deferred to a later version.
Broader technical thesis validation, decision
model adoption, new market providers/instruments, broker execution, leverage/short
accounting, full internal transfer engine and Journal/transaction matching remain
separate priorities. No dates or mandatory additional minor releases are assigned.
