# Notes and Trade Journal capture and reading review

This follows maintainer-accepted Brain work #299 and applies the v3 standard:
useful space and readable labels, including populated entries and editing flows.

## Findings and changes

- Notes now starts with labelled, full-width prose. Optional symbol and effective
  time share a row when space permits; mobile stacks them. Text and editing
  inputs use 14px, and source/date/action labels use at least 12px. Long bodies
  and metadata wrap. Edit/Save/Cancel/Delete have visible text, and compact notes
  retain their close control, contextual scope and embedded use.
- Effective time, fallback save time, local date input conversion, Brain Log
  source links and queued-index notices retain their existing behavior. Empty
  notes cannot be submitted. Load failures remain distinct from an empty list.
- Journal places Add Trade beside the page title rather than floating over
  content. Filters have visible labels, including both date bounds. Entries come
  before the secondary, disclosed completeness review; it still runs on demand.
- Each card has a native Review/Hide button with expanded state. Edit and Delete
  are separate controls, avoiding a clickable container with competing keyboard
  handlers. Expanded rationale uses the full card width, preserves newlines and
  wraps. Closing the editor returns focus to its opener through the shared modal.
- Form labels and values are readable; direction/emotion expose selected state,
  rating buttons are named, and existing/new strategy/setup inputs have distinct
  labels. Failed saves show an alert and retain the draft for a manual retry.
  Existing payloads, native required/numeric validation and clear-exit rules stay.
- Analytics uses independent history/strategy and calendar/day stacks, with
  explicit loading, empty and retrieval-failure states. An
  unavailable statistics request does not create a zero-valued dashboard. Long
  strategy names use wrapping rows with their existing average PnL/trade counts;
  the calendar has a named, keyboard-reachable bounded scroller starting at the
  recent rows, with month/day labels and explicit range/currency context. Charts
  render directly rather than animating their values into place. Empty/unavailable
  charts do not reserve a blank plotting area. Tag panels use full-width flows
  with named inputs, retaining their existing operations.
- Notes and Journal hide the unrelated global single-ticker loader. Their own
  symbol inputs, global command bar/navigation and market controls remain.

## Validation and evidence

Subsequent maintainer feedback exposed a separate Journal save defect: quantities
were integer-only in the API, database and CSV path. The follow-up widens that
contract with migration 0023, defaults new trades to cash divided by entry price,
keeps edits in asset units, labels monetary fields and separates fees. Fractional
values and field-specific validation feedback supersede the original form's
numeric behavior described above. Journal/Portfolio matching remains deferred.
Focused backend tests cover fractional create/update/import and migration data
preservation, including compiled PostgreSQL DDL; browser fixtures cover cash
conversion, decimal fees, invalid exits, retained 422 drafts and fractional edits
at desktop/mobile sizes. These do not validate a production database.

All 854 frontend tests / 141 files, production build and all 93 deterministic
installed-Chrome smoke journeys pass. The five new Notes/Journal cases pass again
with analytics captures and tag-control checks. Focused temporal-note and gap-
review tests also pass after the final label changes. Production-mock, API
surface-inventory and whitespace guards pass.

Populated checks cover 1440/1024/390px, long strategies/tags/rationale, note creation
with an effective date, cancellation, clearing an effective date on edit, source
memo navigation identity, keyboard entry expansion, failed journal save and
retry, unchanged financial payloads, modal focus return, on-demand completeness
review, analytics and tag controls. Separate failure checks distinguish retrieval
errors from empty lists/zero statistics. Existing shared-shell editing and the
broader Portfolio/Brain/comparison regression journeys continue to pass.

Native 200% zoom uses full Chromium with a disposable profile, asserts browser
width / CSS width approximately 2 and visual viewport scale 1, and checks both
pages plus the Journal editor and Escape/focus return. Local verification uses
installed Chrome; Linux CI remains separate.

Synthetic screenshot evidence:

- [Desktop Notes](evidence/notes-1440.png)
- [Mobile Notes](evidence/notes-390.png)
- [Full-width Journal reading](evidence/journal-1440.png)
- [Mobile Journal reading](evidence/journal-390.png)
- [Mobile Journal editor](evidence/journal-editor-390.png)
- [Journal analytics](evidence/journal-analytics-1440.png)
- [Native 200% zoom editor](evidence/notes-journal-native-zoom.png)

All API results in these browser cases are intercepted fixtures. They do not
exercise a live private corpus, provider/model, production database or deployment.
No backend/API/schema/accounting/model/dependency changes. This is an interface
review; Journal/Portfolio transaction matching and FX-normalized journal
analytics remain separate backlog items. News and Workstation/Screener review,
broader populated acceptance and maintainer/host verification remain before v3
release preparation.
