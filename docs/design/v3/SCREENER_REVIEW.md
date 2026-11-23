# Screener results and query readability review

Maintainer confirmed #305 merged and tested on 2026-11-23. This slice is accepted;
broader retained-page review continues separately.

This follows the accepted Workstation layout (#302) and maintainer-validated
Journal save follow-up (#304). The v3 standard remains useful space and readable
labels; the later functionality audit is a separate workstream.

## Findings and changes

The previous layout permanently reserved 260px for presets and 340px for company
details, even with no result selected. Stacked setup and AI analysis displaced
results, and company details were inaccessible between mobile and desktop
breakpoints. Query-builder controls had fixed narrow columns and no field labels.

- Results use the available width with intentional local table scrolling. Preset
  search/library and the independent multi-market scan have native disclosures.
  Current query and Run remain visible; AI analysis follows results and detail.
- Narrow screens use labelled source/view selectors; desktop retains readable
  buttons. Saved views still capture query, universe, preset, tab and view.
- Company detail follows results at every width. An explicit inspection link
  moves focus there; Close returns focus to results. No empty detail rail or
  fixed mobile overlay consumes space. Company names, rank explanation, sector,
  scores and actions wrap. Keyboard row selection and existing routes remain.
- Active filters and additional arithmetic tools are disclosed. Query-builder,
  scan filters, formula controls and screen-save fields have
  visible labels and reflow instead of squeezing into unreadable columns.
- Input/action text is 14px, small metadata at least 12px; result names and rank
  explanations wrap rather than relying on clipped text or hover titles. The
  unrelated global single-ticker loader is hidden on this collection route.
- Initial and no-match states differ. Failed runs label retained previous results
  as unrefreshed; an empty successful run clears the previous company selection.

This changes presentation and that stale-selection reset, not screening formulas,
scoring, market mapping, data acquisition, export formats, persistence or model
routing. The existing separate formula/scan workflows and their provider gaps
are not certified by these layout checks. No new import UI is introduced.

## Validation

All 858 frontend tests / 142 files, production build and all 111 installed-Chrome
smoke cases pass. The five Screener cases and three focused saved-screen/route
tests pass again after the final table-width/readable-header correction. Generated
API-reference, surface-inventory, production-mock and whitespace guards pass.

The deterministic browser journeys cover populated 1440/1024/390px layouts,
long preset/company/sector/explanation text, preset search by click, keyboard row
selection, selected-detail focus/return, query construction, formula controls,
independent scan requests, no matches, failed refresh and measured native 200%
Chrome zoom. Browser APIs are intercepted fixtures, not live provider or host
acceptance. Screenshots below are synthetic review evidence.

- [Desktop results](evidence/screener-results-1440.png)
- [Mobile query and source controls](evidence/screener-initial-390.png)
- [Mobile results](evidence/screener-results-390.png)
- [Company inspection](evidence/screener-company-1440.png)
- [Mobile query builder](evidence/screener-query-390.png)
- [Native 200% zoom](evidence/screener-native-zoom.png)

Broader retained-page and maintainer/host acceptance remain open before release
preparation. The Journal CSV import UI belongs to a later functionality release.
