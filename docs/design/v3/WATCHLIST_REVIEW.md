# Watchlist scope, quotes and research readability

The maintainer confirmed #305 merged and tested. During broader retained-page
review, Watchlist still had a permanent sidebar, a crowded non-wrapping header,
a fixed 800px heatmap and research notes embedded inside the wide quote table.
This is the next bounded v3 layout slice, not whole-release acceptance.

## Changes

- A labelled list selector and full wrapping list name replace the permanent
  sidebar. Create is visible; names/deletion live in a native Manage lists
  disclosure. Long names, list counts and connection/market scope remain readable.
- Symbol search occupies its own labelled full-width row. Suggestions show full
  company names; mouse selection and Arrow/Enter/Escape work. Add to Watchlist
  moves focus into search. Late search results from an earlier query/market are
  ignored; failed search/read/write states are explicit. Adds retain the query
  until confirmation and failed creates retain the name, without automatic replay.
- The page owns vertical scrolling. Quote inspection scrolls horizontally in a
  named focusable region; complete headers, numbers and visible Notes/Actions/
  Remove labels remain intact. Row Enter/Space and context-menu shortcuts remain;
  nested buttons no longer trigger the parent row's navigation.
- Notes open below the table at the available width, move focus to their research
  section and provide a Close action returning to the opening row control.
- Heatmap tiles follow available width rather than overflowing or stretching an
  800px plot. Their visible text is at least 12px and only drawn when it fits;
  full symbols/change remain in accessible link names and native titles. Tiles
  support keyboard navigation to the existing chart route. Bright fills use dark
  text; the numeric table remains available for dense lists.
- Missing quote changes display unavailable rather than fabricated zero changes.
  Unquoted symbols are omitted from the heatmap with explicit coverage; an empty
  heatmap explains that no quotes have arrived. Existing quote values, currency
  units, subscription routing and equal tile weights are otherwise unchanged.
- Choosing a list clears a prior `?name=` deep-link scope while preserving other
  query parameters. A confirmed create enters the cache before selection to
  avoid a refetch race resetting the selected list. No API/schema change.

The global single-ticker loader is hidden on this collection route. Existing
search, export, notes and shared row-menu actions remain. Launchpad's HeatmapView
caller retains its fixed-size contract unless it opts into responsive sizing;
its shared tile labels/keyboard behavior receive the same accessibility changes.

## Verification and limits

All 858 frontend tests / 142 files, production build and all 116 installed-Chrome
smoke cases pass. The five Watchlist cases pass again after final search-failure
retry/keyboard, quote-label/heatmap-contrast and collection-toolbar refinements.
Generated API-reference, surface-inventory, production-mock and whitespace guards
pass. The manual mobile pull-refresh candidate uses the new stable content
selector; it remains outside the regular smoke gate.

Synthetic browser fixtures cover long list/company names, received/missing
quotes, deep-link selection followed by list switching, search/add confirmation,
failed writes/manual retry, keyboard notes focus/return, responsive heatmap,
empty lists, failed reads and actual measured native 200% Chrome zoom at
1440/1024/390px. WebSocket ticks and API responses are intercepted; no live account,
provider/model, deployment or production database is accessed.

- [Desktop quotes](evidence/watchlist-quotes-1440.png)
- [Mobile quotes](evidence/watchlist-quotes-390.png)
- [Full-width notes](evidence/watchlist-notes-390.png)
- [Mobile heatmap](evidence/watchlist-heatmap-390.png)
- [Native 200% zoom](evidence/watchlist-native-zoom.png)

Views, Alerts, Settings, Launchpad and broader retained-tool checks still need
explicit review. The later legacy functionality audit remains separate. This
slice does not authorize v3 release preparation.
