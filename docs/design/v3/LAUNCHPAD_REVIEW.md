# Launchpad: readable panels and a responsive saved workspace

This follows merged #311 (Settings). Broader retained-tool and maintainer/host
acceptance remain open; finishing this named page review is not release preparation.

## Findings and changes

Launchpad still had crowded preset buttons, right-click-only layout management,
a fixed 192px panel picker, clipped title inputs and 8–11px embedded labels.
A twelve-column grid stayed dense on mobile; its general layout callback could
persist automatic packing. Panel titles and symbols also served as an implicit
popout serialization format, making presentation changes fragile.

- Layout selection is labelled and the full selected name wraps above it. Layout
  rename/delete and linking details are disclosed. Rename uses an explicit form;
  new layout and template actions remain visible. Names are no longer edited on
  blur or through a right-click prompt. Removing the final layout still restores
  defaults and now selects the first restored layout so it remains editable.
- The bounded picker supports readable panel search/results and an explicit empty
  result. Panel settings moves the former inline title/symbol controls into a
  labelled TerminalModal with the existing link groups. Titles wrap in readable
  headers; changing symbol/group retains the existing symbol broadcast behavior.
  Keyboard trap, Escape and feedback focus work in both dialogs. Ctrl/Cmd + 1–9
  still focuses panels and does not interfere with an open panel dialog.
- The grid measures its actual host. Below 1050px it stacks 480px panels and hides
  desktop drag handles. Wider hosts retain the twelve-column drag/resize surface
  with 64px rows and useful 3-column/4-row minimums. Page scrolling keeps controls
  and plots reachable even when browser zoom reduces usable height. Automatic
  packing and viewport changes do not write x/y/w/h; only a completed drag/resize
  gesture writes geometry. Existing grid coordinates/storage formats are retained.
- Embedded text no longer uses the smallest 8–11px labels in the Launchpad panel
  module. Headlines, sources, watchlist names and AI prose wrap; price/list rows
  have room, and research input/send controls have labels. Embedded option tables
  retain local scrolling. The watchlist heatmap measures its panel instead of
  retaining a fixed 300×200 canvas, with distinct unavailable/loading/empty list
  feedback. These are presentation changes, not changes
  to quote routing, AI profiles, calculations or evidence handling.
- Template names/descriptions wrap with readable fields and bounded gallery
  scrolling. Popout headings wrap and the body uses the remaining window height.
  Popout URLs read explicit panel ID/type/title/symbol metadata, retaining the old
  header fallback for other callers. This preserves aliases without depending on
  a tiny badge or the removed inline editor's DOM structure.

No backend/API/schema, dependencies or stored formats change. Existing layout
local/server synchronization, custom templates, group semantics, lazy/visibility
mounting and template-only placeholder panels remain. No embedded feature is
added to v3 simply because its slot now reads clearly.

## Validation and evidence

All 889 frontend tests / 147 files and production build pass. Eight focused unit
cases cover template apply/save/delete, context persistence, group isolation,
final-layout restoration, responsive geometry preservation, explicit grid gestures
and metadata-based popout identity. Five browser cases cover 1440/1024/390px and
measured native 200% Chrome zoom: real chart canvas, long headlines/sources,
keyboard/modal focus, panel editing/group fields, typed popout navigation, picker
search/empty/add, template capture and layout rename. A separate journey checks
viewport transitions preserve coordinates and an actual chart resize writes them.
All 139 installed-Chrome smoke cases pass. Final affected checks repeat the five
browser journeys and eight unit cases after hiding narrow-screen drag handles and
checking the measured embedded heatmap. API-reference, surface-inventory,
production-mock and whitespace guards pass.

- [Desktop panels](evidence/launchpad-panels-1440.png)
- [Mobile panels](evidence/launchpad-panels-390.png)
- [Mobile panel editor](evidence/launchpad-editor-390.png)
- [Mobile panel picker](evidence/launchpad-picker-390.png)
- [Desktop templates](evidence/launchpad-templates-1440.png)
- [Native 200% zoom](evidence/launchpad-native-zoom.png)

All API responses, layout writes, model/market/news inputs and popout requests use
local fixtures; no production data, providers, models or deployment are accessed.
Backend tests were not rerun for unchanged server code. This is not blanket
accessibility, live integration or whole-release acceptance.

## Existing functionality boundaries

The code still includes template-only slots and legacy embedded read paths.
Watchlist/heatmap quote lookups use a selected-market key; several quote/yield
views use zero fallbacks. Those need native-identity and missing-data audits in
the deferred functionality track. Hosted layout-sync failures are still silent;
real persistence, hydration races and actual detach/recall/return/link behavior
need integration verification. The browser journeys establish readable popout
navigation and preserved URL context, not the entire live window lifecycle.
These limits are recorded in the TODO rather than hidden by layout acceptance.

Continue with the broader retained-page inventory and maintainer acceptance.

## CI follow-up: initial measurement and lazy-panel inspection

The maintainer reported a desktop failure before the chart could be scrolled,
then a retry where the newly added heatmap's controls disappeared. The grid's
initial zero-width state could render a stacked tree and replace it after its
first desktop measurement. Also, the add-panel confirmation deliberately focuses
the status message; scrolling before that effect completed could be undone,
leaving the new panel outside the lazy mount's visible range.

Initial host measurement now runs before paint. Browser journeys wait for the
expected grid mode and add-panel confirmation focus. A bounded, retryable helper
re-resolves, focuses and reveals the current panel before inspecting lazy content;
only these reversible inspection actions retry. Panel creation, edits and other
writes are still performed once. Existing visibility pausing and saved geometry
behavior remain intact. The desktop journey also exercises 4× CPU throttling.

Validation: all five journeys pass six consecutive repetitions (30 runs); the
reported desktop case passes eight further repetitions at 4× Chrome CPU
throttling. All eight affected unit tests and the browser run's production build
pass. Whitespace checks pass. These focused stress runs supplement the earlier
full suite; the unrelated backend and browser suites were not repeated.
