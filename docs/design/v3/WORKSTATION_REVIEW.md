# Workstation chart visibility and readable controls

This follows maintainer-accepted News #301. Workstation is a separate slice from
Screener because chart layout/persistence and result-table exploration have
different acceptance needs. Screener remains open.

## Findings and changes

- Workstation's large always-visible setup area displaced the charts. Workspace
  tabs, connection/loading/source state, active pane, visible/hidden counts and
  layout/maximize controls remain visible. A native Workspace tools disclosure
  contains the larger symbol/link, comparison, replay, template and persistence
  controls, plus shortcut help and multi-timeframe/custom presets. Its named
  scroll region is bounded; opening it is explicit and closing retains drafts.
- Controls and metadata use at least 12px, text inputs use 14px, long company and
  workspace names wrap, and layout buttons show their grid dimensions with usable
  targets. Tabs have a bounded wrapping group. Script library/editor metadata is
  readable and wraps, while code keeps its aligned monospace presentation.
- Panes have minimum plot height instead of compressing into thin strips. The
  shell owns page scrolling. Narrow widths stack occupied panes; medium widths
  cap wide matrices at two columns. This is visual reflow only: selected desktop
  grid/custom geometry, slot visibility/capacity and saved state are unchanged.
  Deliberately selecting a larger layout still reserves its desktop capacity.
- Pane tools occupy their own row. Existing chart replay/export/surface controls
  remain available in a bounded Chart tools disclosure, preventing overlapping
  overlay toolbars inside narrow plots. Market/session metadata stays inspectable
  in that disclosure, and selected-candle metadata clears the time-axis labels. The shared TradingChart defaults to its
  original layout elsewhere. Per-pane identity and candle/quote metadata wrap.
  OHLC labels stay with their values; the existing bar-change and received-quote
  calculations remain separate. No quote is substituted for a candle boundary.
- Clicking a pane's symbol field no longer forces focus back to the chart root.
  Search results show full company names; keyboard input and selecting a result
  keep their existing search/routing behavior. Chart-root focus still activates
  pane shortcuts, and plain keyboard navigation still operates across panes.
- Per-pane indicator management reuses the accepted wide manager and shared modal
  instead of a cramped 320px overlay inside the plot. It retains the selected
  pane's indicator instances, templates and alert callbacks. Modal focus/Escape
  behavior is shared; workstation shortcuts are suspended while a shared modal
  is open, avoiding pane changes while using an indicator editor.
- Loading, provider errors and an empty rendered history have explicit states.
  Fullscreen clears shell chrome so Exit remains reachable; shared indicator
  dialogs stay above it without remounting the chart.
  The unrelated global single-ticker loader is hidden on this route; each pane
  and the workspace controls retain their own symbol selection and global commands.

## Validation and evidence

All 854 frontend tests / 141 files, production build and all 104 installed-Chrome
smoke journeys pass. The final six Workstation cases pass again after action-row
spacing/formatting cleanup. Production-mock, API surface and whitespace guards
pass. The new browser journeys cover populated 1440/1024/390px views, real chart canvases, first-plot
placement and height, full names and readable OHLC, pane keyboard focus,
disclosed chart/price-scale controls, symbol search without focus theft, timeframe requests, comparisons, snapshots, per-pane
indicator isolation/focus return, fullscreen/shared-dialog layering, adding and
removing panes, and viewport-only reflow. Additional
cases cover six populated panes, explicit provider errors and measured native
200% Chrome zoom. Existing workspace toolbar tests enter the disclosure before
exercising the same callbacks/persistence/replay behaviors.

Native zoom uses full Chromium with a disposable profile, asserting browser/CSS
width ratio approximately 2 and visual viewport scale 1. Local browser verification
uses installed Chrome; Linux CI remains separate.

Synthetic evidence:

- [Desktop charts](evidence/workstation-charts-1440.png)
- [Tablet charts](evidence/workstation-charts-1024.png)
- [Mobile charts](evidence/workstation-charts-390.png)
- [Workspace tools](evidence/workstation-tools-1440.png)
- [Mobile per-pane indicator manager](evidence/workstation-indicators-390.png)
- [Native 200% zoom](evidence/workstation-native-zoom.png)

Fixture API responses do not exercise real providers, a production database,
shared account data or deployment. No backend/API/schema/dependency, indicator
calculation, quote/history acquisition, replay/link semantics or persistence
format changes. Screener, broader retained-page review and maintainer/host
acceptance remain before v3 release preparation.
