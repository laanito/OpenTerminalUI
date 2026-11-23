# Saved Views library and shared workflow controls

This follows maintainer-confirmed merged/tested #308. Views was the next retained
page review; Alerts, Settings, Launchpad and broader acceptance remain separate.

## Findings and changes

The Views hub previously showed a description and two buttons, hiding its entries
behind a fixed 320px popup. It requested only workspace-scoped entries, so saved
Portfolio/Screener workflows were not part of the hub's list. Names truncated,
actions/dates were tiny, failed reads looked empty, and save/rename used native
prompts without persistent draft/error feedback.

- The hub now shows all owned workflow scopes directly, using the existing API's
  unfiltered read. Cards have full wrapping names/descriptions, destination scope/
  page, dated updates and visible Apply/Rename/Delete controls. Desktop uses two
  columns; narrow views stack. The page owns scrolling, and the unrelated global
  single-ticker loader is hidden on the hub.
- Shared controls on workflow pages retain their scope filter. Their library opens
  in the existing bounded TerminalModal, with Escape, keyboard trap and focus
  return, rather than a fixed-width popup. Nested name editors use that same modal
  stack. Saving/renaming uses a labelled 14px input; metadata/actions are at least
  12px and long content wraps.
- Loading, empty and failed reads differ. Failed refresh retains previous entries
  with an explicit unrefreshed message. Failed save/rename retains the name draft
  for manual correction/retry; writes are never automatically replayed. Confirmed
  creates remain in the local library if the following read fails. Delete still
  uses the existing explicit confirmation and reports an uncertain failure.
- Capture records the opening page, search, ticker, scope, storage whitelist and
  caller-supplied workflow fields. Rename changes only name. Apply preserves
  storage/preset/ticker restoration, the pending payload, route/search navigation,
  apply event and reload. Late reads/writes from an earlier scope cannot replace
  the current library. Confirmed rename/delete moves focus to the library.

This changes the presentation/read scope of the hub and failure feedback, not the
saved payload format, storage keys, owner checks or backend/API contracts. Existing
saved views are retained; no migration, dependency or production access is needed.
It does not certify every legacy workflow's restoration or provider behavior.

## Review evidence

All 869 frontend tests / 144 files, production build and all 124 installed-Chrome
smoke cases pass. The five Saved Views cases pass again after isolating write
completion from background refresh state. API-reference, surface-inventory,
production-mock and whitespace guards pass. The unchanged backend suite was not
rerun for this frontend-only change.

Synthetic browser journeys cover 1440/1024/390px, long names/descriptions,
cross-scope visibility, save/rename/delete, explicit retry, library focus/return,
shared scoped/nested dialogs, restore state and measured native 200% Chrome zoom.
Seven focused frontend tests cover opening-state capture, scoping, failed rename,
confirmed-write/failed-refresh separation, restoration, late-read isolation and
keeping a second pending write locked when an earlier refresh finishes.
All browser API responses are fixtures; no live corpus, provider or deployment is
accessed. This is not blanket accessibility or whole-release acceptance.

- [Desktop library](evidence/saved-views-library-1440.png)
- [Mobile library](evidence/saved-views-library-390.png)
- [Mobile failed-name draft](evidence/saved-views-editor-390.png)
- [Native 200% zoom](evidence/saved-views-native-zoom.png)

Continue with Alerts, Settings, Launchpad and the remaining retained-tool/host
checks. Release preparation remains gated on that work and maintainer acceptance.
