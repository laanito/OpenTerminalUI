# Security Hub hierarchy and readability review

This slice follows maintainer-accepted Equity #294 and Home #296. It applies the
v3 standard of useful space and readable names to the retained Security Hub with
populated, synthetic research fixtures across every visible tab.

## Findings and changes

- Overview and its short price preview previously shared a stretched grid row,
  delaying catalysts and leaving unused panel space. Valuation/range and saved
  catalyst research now form one stack; price preview, analyst consensus and
  classification form an independent context stack. Narrow screens keep the
  primary research first. Classification is no longer duplicated in the header.
- The page's nested fixed-height scroller exposed reserved mobile bottom padding
  as a permanent blank strip. The shell now owns page scrolling. Intentional
  local table/headline scrolling stays named and keyboard reachable.
- Identity, quote metrics, section tabs and actions wrap within available width.
  Metrics are definition lists, names use at least 12px, values have room and long
  classification/source text wraps. Catalyst and sentiment labels follow the
  readable baseline while retaining extraction/model/failure provenance.
- The preview's blank rectangle becomes explicit loading, unavailable or empty
  text. Missing/blank metrics remain unavailable, rather than becoming zero;
  genuine reported zero values survive fallback-field selection in tables.
- Annual/quarterly statements, holders, insider transactions, recommendations,
  estimates, peers and ESG history have named sections and grids. Empty tables
  no longer reserve tall viewports; populated ones size to their row count up to
  their original bounds. Headers wrap at 12px in 44px header rows; numeric rows
  retain deliberate density. Long name columns have more initial room and are
  not oversized frozen panes. Persisted column preferences/IDs and table tools
  remain intact; wide data uses local horizontal scrolling.
- Arrow/Home/End tab selection now moves focus to the selected tab. The Hub names
  the tablist and connects its tabs to an actual named panel. Existing route/tab
  query parameters and compatibility-only tape/insider links remain supported.
- Chart comparison has a visible Add action and named remove controls, with
  wrapping controls and a viewport-bounded plot. Data and chart comparison
  calculations are unchanged.

## Validation and evidence

All 854 frontend tests / 141 files, production build and all 79 deterministic
installed-Chrome smoke journeys pass. Five new Hub cases cover populated
1440/1024/390px views, all visible tabs, query preservation, keyboard focus,
content-sized grids, missing versus genuine zero values, comparison add/remove,
empty preview/statements and real 200% browser zoom. Existing filing provenance,
lexical/model fallback, Home/Portfolio native zoom, Equity and research/evidence
regressions continue to pass. Production-mock, surface-inventory and whitespace
guards pass.

Native zoom uses full Chromium, a disposable profile and native zoom preference;
it asserts browser/CSS-width ratio 2 and visual viewport scale 1. This is not CSS
zoom or a resized viewport. Linux CI verification remains separate from the local
installed-Chrome run.

Synthetic screenshot evidence:

- [Desktop overview](evidence/security-overview-1440.png)
- [Mobile overview](evidence/security-overview-390.png)
- [Mobile financials](evidence/security-financials-390.png)
- [Native 200% zoom](evidence/security-native-zoom.png)

These are UI/regression checks, not live provider/model validation. No backend,
API, schema, accounting, dependency, provider/model or extraction algorithm changes;
no deployment or production database access. Comparison/Brain/Notes/Journal,
News and Workstation/Screener remain open for populated readability/hierarchy
review before v3 release prep. The maintainer's review remains the acceptance gate.
