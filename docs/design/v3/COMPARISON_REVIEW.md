# Comparison research hierarchy and saved-evidence review

This slice follows maintainer-accepted Equity #294, Home #296 and Security Hub
#297. It applies the v3 standard, “no wasted blank spaces and no unreadable labels,”
to populated cross-market comparisons, generated answers and saved evidence.

## Findings and changes

- Briefing setup previously preceded observed returns and paths. Observed
  comparisons now lead, with the first aligned path open by default. Other paths
  keep their show/hide controls; opening a plot makes no additional source/model
  call. Plot axes/tooltips use readable 12px type.
- Research uses a full-width reading flow. A side-by-side experiment left a wide
  empty price column beside long saved sources/model inputs, so that layout did
  not meet the release standard. Jump links make both observations and briefing/
  saved research reachable on narrow screens. The shell owns page scrolling.
- Proxy lookup/suggestions have a named native disclosure. Anchor, manual proxy
  entry, window, optional reporting currency and Apply stay visible. Mouse and
  keyboard symbol selection still edit inputs without running comparisons until
  Apply; pending selection changes keep generation disabled and cancel old work.
- Detailed source paths, quote units and exchange-date alignment are inspectable
  together after the primary plot. Freshness, close conflicts, native quote-unit
  identity/differences and mixed/unverified price-basis warnings remain visible.
  FX, adjusted/local-date paths, technical measures, news, macro and filing views
  retain separate identities and source-request triggers.
- Briefing scope/exclusions and selected-source warnings stay visible next to
  explicit opt-in controls. Only supporting method explanations are disclosed.
  Citation targets, mandatory caveats, coverage gaps and reference-only validation
  remain intact; model prose is not promoted to verified fact.
- Saved runs have a bounded, keyboard-reachable list, not twenty entries pushing
  the answer down the page. Opening a run focuses/scrolls to its full-width review;
  closing it returns focus to the selected list entry. Long text and model JSON
  wrap within their reading area. Saved follow-up explanations are inspectable;
  the distinction between frozen rerun and fresh collection, selected-sentiment
  behavior, active progress/failure and deletion confirmation stay visible.

## Validation and evidence

All 854 frontend tests / 141 files and production build pass. The 83-journey full
installed-Chrome smoke suite passes; after the final full-width adjustment, all
12 affected comparison/citation/saved-run journeys pass again. Four new cases
cover populated 1440/1024/390px views and real 200% browser zoom, including stale/
unavailable pairs, source disclosure, mouse-picked proxies, default path and
reading widths, original saved inputs, citation focus and close-focus return.
Existing retry/interrupted generation, source coverage, saved deletion, rerun/
refresh lineage and retained-sentiment behavior continue to pass. Focused unit
expectations now reflect the default-open first path and disclosed proxy tools;
they retain scope-warning and no-auto-Apply checks.

Native zoom selects full Chromium and asserts browser/CSS-width ratio 2 and
visual scale 1. This is not CSS zoom or a resized viewport. Local checks use
installed Chrome; Linux CI verification remains separate. Production-mock,
surface-inventory and whitespace guards pass.

Synthetic screenshot evidence:

- [Desktop overview](evidence/comparison-overview-1440.png)
- [Mobile overview](evidence/comparison-overview-390.png)
- [Saved evidence/model inputs](evidence/comparison-saved-evidence-1440.png)
- [Native 200% zoom](evidence/comparison-native-zoom.png)

Fixtures intercept all API calls. No live providers/models or production database
are exercised. No API, backend, schema, dependency, evidence calculation, prompt,
model-selection, retention or deletion behavior changes. Brain/Notes/Journal,
News and Workstation/Screener remain open for populated hierarchy/readability
review. Maintainer acceptance still precedes v3 release prep; deployment stays
with the host agent.
