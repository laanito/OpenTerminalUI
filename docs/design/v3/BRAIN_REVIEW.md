# Second Brain question and saved-research review

This slice follows maintainer-accepted comparison reading #298. It applies the
v3 standard of useful space and readable labels to populated Second Brain
answers, dated citations, captured technical evidence and Brain Log memos.

## Findings and changes

- Technical setup previously preceded the question. The labelled question now
  comes first, with a readable 14px input and responsive Ask/Cancel controls.
  Explicit private-source scope and optional technical selection remain nearby;
  the shortcut is visible. Empty questions cannot be submitted through Ask.
- The page has named Ask/saved-answer jump links. The unrelated global single-
  ticker loader is hidden on this route; global commands, market controls and
  explicit technical-symbol selection retain their behavior.
- Index counts and Reindex stay visible. Long backend/embedding metadata moves
  into an inspectable disclosure. A failed index-status request exposes a warning
  and unknown counts rather than implying the private record has zero sources.
- Answers/questions and citation titles are readable, source/date/score labels
  use at least 12px, and long titles/snippets wrap. Evidence effective-date
  precedence and score values are unchanged; a genuine zero score is displayable.
  Technical coverage, model identity and degradation warnings stay visible.
- Brain Log no longer reserves a list column beside an empty or much longer
  reader. Its bounded, keyboard-reachable list precedes a full-width memo. Open
  focuses/scrolls to the reader; Close returns to the selected list entry. Deep
  links outside the first page remain supported. Metadata updates/rechecks do not
  refocus the reader merely because the same memo's data was refreshed.
- Memo organization uses a native disclosure, with readable title/symbol/tags/
  annotation labels. Answers and evidence remain immutable. Update/deletion
  failures remain visible outside that disclosure. Evidence checks, source-change
  warnings, Recheck, reviewed promotion and explicitly confirmed deletion remain
  discoverable. Promotion's warnings, review checkbox and dates are unchanged.

## Validation and evidence

All 854 frontend tests / 141 files, production build and all 88 deterministic
installed-Chrome smoke journeys pass. Five new cases cover populated
1440/1024/390px views, index-status failure and actual native 200% zoom. They check
question order/size, explicit source/technical selection and keyboard submission,
long dated citations, saved-answer snapshots, bounded lists/full-width readers,
focus movement/return, metadata-only updates, stale/current rechecks and promotion
review gating. Existing interrupted-stream/cancellation, partial/unavailable and
technical-only answers, captured technical inspection, reviewed promotion,
comparison and Portfolio regressions continue to pass. Production-mock,
surface-inventory and whitespace guards pass.

Native zoom uses full Chromium and a disposable native-zoom profile, asserting
browser/CSS-width ratio 2 and visual viewport scale 1. Local verification uses
installed Chrome; Linux CI verification remains separate.

Synthetic screenshot evidence:

- [Desktop question](evidence/brain-question-1440.png)
- [Mobile question](evidence/brain-question-390.png)
- [Full-width saved memo](evidence/brain-saved-reader-1440.png)
- [Mobile captured technical evidence](evidence/brain-saved-evidence-390.png)
- [Native 200% zoom](evidence/brain-native-zoom.png)

Fixtures intercept API calls; no live private corpus, provider/model, deployment
or production database is exercised. No backend/API/schema/dependency, retrieval,
recency weighting, prompt, model selection, indexing, evidence recheck, memo
promotion or deletion contract changes. Saved market snapshots remain captured
observations; checking private source identities does not refresh market evidence
or establish that an answer is true. Notes/Journal and News/Workstation/Screener
remain open for populated hierarchy/readability review before v3 release prep.
