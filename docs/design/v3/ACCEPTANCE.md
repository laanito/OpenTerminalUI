# Portfolio pilot acceptance

Local review: 2026-11-19, after merged #292 (`fa91c7f`). This closes the planned
local keyboard/zoom/layout audit for Portfolio. **Scope correction, 2026-11-20:**
this is not acceptance of the whole frontend overhaul. Retained-page usability
work remains in [v3.0 scope](SCOPE.md) before maintainer release acceptance. Published version remains 2.8.0.

## Method and limits

The deterministic browser fixture contains 25 instrument groups, 80 original
AAPL lots, fractional quantities, two owned accounts, long account/listing names,
long research/source URLs and 80 movements per account. It uses synthetic responses,
blocks financial/model writes, and accesses no deployment or production data.
Existing separate browser journeys continue to cover operation/evidence writes,
failures, private research and their existing API contracts.

Review uses installed Chrome at 1440×1000, 1024×1000 and 390×1000, with the context
rail both open and closed on desktop. Actual browser zoom uses a disposable
profile's native 200% zoom preference: the 1440px window has a 720px CSS viewport,
with visual viewport scale 1. This is not a CSS transform, mobile pinch or a claim
based only on resizing the viewport. The test asserts those measured bounds.

Automated checks inspect DOM focus, ARIA names/indices, disclosure traversal,
local scroll visibility, CSV contents, layout bounds, console exceptions and
computed sRGB text contrast for the pilot's sampled labels/actions/table cells.
Terminal Noir, Light Desk and Classic Bloomberg pass the sampled 4.5:1 text
threshold; light labels/accent/warning colours and visible focus rings were
adjusted. Reduced-motion styles suppress shared-shell/modal CSS motion. These
checks are not a screen-reader user study or a blanket accessibility certification
for every legacy page, chart, custom colour or browser.

Retained evidence: [desktop Light Desk](evidence/acceptance-1440-light.png),
[mobile Light Desk](evidence/acceptance-390-light.png),
[native 200% zoom](evidence/acceptance-zoom-200.png) and
[measured run metadata](evidence/acceptance.json). Sampled minimum label/action
contrast is approximately 5.01:1 in Noir and 5.38:1 in Light Desk.

## Findings corrected

| Finding | Result |
|---|---|
| DenseTable hard-coded 26px rows despite Portfolio requesting 40/44px | Rendered rows/cells honor their configured height; lot actions fit and virtual scrolling uses the same geometry. |
| Grid keys intercepted inputs/buttons; navigation could leave the selected row offscreen | Interactive controls retain native keys/clicks. Arrow, Home/End and Page keys select, scroll and focus the target virtual row. Sorted ARIA row indices describe the visual order. |
| Column controls lacked a complete keyboard path | Resize separators support Left/Right and report width. Column options expose expanded state and close with Escape, returning focus. |
| Default-hidden evidence columns could never be shown | Show Hidden includes default-hidden columns and persists explicit visibility, preserving prior order/width/hide preferences. Revealed research survives CSV export. Full scalar text remains available as cell descriptions/tooltips. |
| Dark table constants overrode theme surfaces | Table surfaces/text/borders follow existing tokens. Light-theme labels and accent/warning text have stronger contrast. |
| Disclosure summaries were absent from the modal focus trap | Summaries participate in Tab wrapping; closed disclosure contents and inert/hidden controls are skipped. Busy/topmost modal rules remain. |
| Refresh could remove an operation/repair's opening control | Confirmed saves announce success and focus the confirmation near Portfolio's main actions; cancelled dialogs return to their surviving opener. |
| Long content and narrow selector placement | Listing summaries wrap, account choices remain inside the narrow viewport, and tall allocation legends can be keyboard-scrolled. Intentional lot/activity horizontal scrolling remains local. |

The context rail's chart resize observer settles asynchronously; checks wait for
that reflow rather than accepting the previous wide chart dimensions. No clipping
rule is added to conceal an overflowing required control.

## Acceptance map

| Scope criteria | Evidence |
|---|---|
| 1, 11, 12: populated responsive, real zoom, keyboard, long content, focus, contrast and motion | `portfolio-acceptance.spec.ts`, `DenseTable.accessibility.test.tsx`, `TerminalModal.focus.test.tsx`; reviewed desktop/mobile/zoom screenshots. |
| 2–4, 8, 10: one/all/direct scope, grouping/coverage, creation/settings, analysis and original lots | Existing consolidated-workflow, unified-layout, page-states and technical browser journeys; reporting/ownership/accounting contracts from #289–292. |
| 5–7: reviewed atomic operations, known/unknown openings, repair and retry | Existing consolidated-workflow/opening-evidence browser journeys and #292's 182-test Portfolio domain run. No financial code changes in this follow-up. |
| 9, 13: retain research identities/editing and shared-shell journeys | New Notes/Journal edit/save/cancel and shortcut cases at desktop/mobile; existing Brain/Log/promotion, saved comparison/citations, Stock Detail and BTC candle smoke journeys. |
| 14: backend/migration parity and regression gate | Carry forward #292's disposable SQLite/full-chain/retaining downgrade checks, PostgreSQL DDL and guarded migrated PostgreSQL lane. This frontend-only follow-up reruns frontend/build/browser checks, not production DB operations or the unchanged backend suite. |
| 15: maintainer acceptance before release | Portfolio slice merged as #293; broader retained-page usability review remains before release prep, version bump, tag and article. |

All 852 frontend tests (140 files), production build and 65 Chrome smoke journeys
pass locally. No new dependency, backend API, schema, provider or accounting change.
CI is left for the maintainer's normal review; the coding agent does not monitor
or deploy it.
