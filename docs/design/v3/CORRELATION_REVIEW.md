# Correlation: readable scopes and keyboard evidence review

Continues merged #321, which the maintainer confirms works as intended. This
covers the retained Correlation matrix, rolling-pair and cluster workflows before
Stat Lab and Pair Trading. Dedicated work now covers 33 render entries, including
26 tool destinations and three shell-menu extras. Seven ordinary destinations
remain; Correlation host acceptance and wider v3 acceptance are open. No release
preparation or provider/model expansion.

## Hierarchy and scope

The active view leads. Symbol management is disclosed instead of pushing the
matrix below a permanent search/preset block. Full removable names, a labelled
native-symbol form, explicit search context and full company/exchange suggestion
labels remain one click away. Click, Enter and the Add symbol button use the same
normalization/deduplication path. Adding a symbol returns focus to the entry;
removal focuses the next available control. Presets append unique symbols and the existing
20-symbol cap is explicit. They are static convenience baskets, not verified
current index rankings. Primary-portfolio symbols have distinct loading, empty,
failed and retry states rather than a mysteriously disabled action.

Search uses the existing catalogue endpoint with an explicit ranking context
instead of an invisible hardcoded NSE context. All markets is the default;
NASDAQ/NYSE/EU/Crypto/NSE contexts use existing backend ranking support. This is
not a market filter or new provider coverage. Late suggestions cannot reappear
after the query/context changes or selection clears the draft. Typed native
symbols retain their listing suffixes; unresolved provider identity is not repaired.

The matrix is a coloured HTML value table with row/column headers, sticky names
and a named local keyboard scroller, replacing the mouse-only SVG heatmap. Missing
cells are unavailable, rather than client-created zero. Every off-diagonal value
has a native keyboard-operable rolling-pair action, including unavailable values
whose longer history may still be worth checking. Pair actions transfer focus to
the active view. Returned names/dates and omitted requested symbols are explicit.

Rolling controls name both symbols, the observation window and requested history.
Invalid pairs are disabled/gated; removing symbols cannot leave stale results or
send fewer than two symbols. Current/average/minimum/maximum, full dated regime
rows and exact rolling values remain readable outside the plot. Gaps remain gaps;
the original coefficient scale, line style, reference bands and regime rules stay.

Clusters have full member names and readable within-group coefficients. The merge
tree is native expandable HTML with reported distances and leaves rather than a
small raw JSON block. The lowest-pair list retains ascending **signed** coefficient
ranking, excludes missing/non-finite cells and opens rolling pairs by keyboard.
Strong negative co-movement is not described as statistical independence.

## Read states and shared pattern

Current-view reads use the accepted Risk read/table pattern, now extracted to
`components/terminal/AnalyticsRead.tsx`. Risk's existing imports are preserved as
aliases through `risk/RiskRead.tsx`; its guarded lifecycle and rendering behavior
are unchanged. Tables keep named focusable local scrollers, bounded height and
row/column headers. Labels and axes are at least 12px; company names and native
symbols wrap without truncated tags.

Read generations/scope guards clear old results on a new symbol/period/window or
manual retry and ignore late completions. Fewer than two symbols yields an explicit
empty state with no previous analysis. Read failures expose a scoped manual retry
and never raw provider errors. Cluster retrieval and its supporting pair matrix
are independent, so one failure cannot erase the other. No automatic write,
financial operation, LLM call or saved-format change is added.

## Source limits recorded for v5

The existing endpoints compute daily price returns, align on complete shared dates
and can omit symbols without history. The frontend labels requested versus returned
scope; no adjusted-return basis, FX conversion, provider freshness or complete
cross-market calendar coverage is established. The backend itself fills undefined
matrix correlations with zero, which the UI cannot distinguish from a reported
literal zero. The matrix cache sorts its symbol identity while the returned order
can reflect an earlier request; this page respects the returned order.

Audit provider/native listing identity, history basis/coverage, zero sentinels,
cache/freshness behavior, rolling/regime semantics and hierarchical distance,
linkage and singleton averages in v5. Valid backend calculations, defaults,
period/window options, cluster requests and API payload contracts stay unchanged.
Deterministic frontend acceptance does not certify live financial correctness.

## Validation and synthetic captures

Six focused unit cases cover unavailable versus zero, keyboard pair scope/focus,
late search results, click/native entry/deduplication, primary-portfolio retry and
cap, fewer-than-two gating, late/failed rolling reads, independent cluster/matrix
failure and signed finite-pair ranking. The eight accepted Risk cases also pass
after the shared extraction. Six Chrome journeys cover every view at
1440/1024/390px, 4× desktop CPU, long names, local keyboard scrolling, suggestions,
manual entry, the 20-symbol cap/removal, late scopes and failures, merge inspection,
pair navigation and native 200% browser zoom. Geometry uses one DOM snapshot per
inspection; normal timeout/throttle settings remain unchanged.

All 925 frontend tests / 153 files, production build and all 183 installed-Chrome
smoke journeys pass. API-reference, surface-inventory, production-mock, source-
artifact and whitespace guards pass. Shared primitives are identical to the
accepted Risk implementation apart from names/import paths; its eight unit cases
and browser journeys pass in the regression run. Review links/JSON and nine
final captures are checked.
All API/socket reads use synthetic fixtures. No live provider/model/private corpus,
production DB or deployment access. No backend/API/schema/dependency changes; the
unchanged backend suite is not rerun. Current source artifacts are regenerated;
the original 39 browser probes and baseline captures remain unchanged.

| Workflow | Desktop | Mobile |
|---|---|---|
| Native symbol search | [1440px](evidence/correlation-scope-1440.png) | [390px](evidence/correlation-scope-390.png) |
| Keyboard matrix | [1440px](evidence/correlation-matrix-1440.png) | [390px](evidence/correlation-matrix-390.png) |
| Rolling values/regimes | [1440px](evidence/correlation-rolling-1440.png) | [390px](evidence/correlation-rolling-390.png) |
| Cluster/tree inspection | [1440px](evidence/correlation-clusters-1440.png) | [390px](evidence/correlation-clusters-390.png) |

[Native 200% Chrome zoom](evidence/correlation-native-zoom.png). Captures show the
scrolling workspace viewport at the reviewed section; lower content/local overflow
is verified by interaction rather than claimed to fit on one screen. Native zoom
uses Chrome surface capture through CDP to avoid CSS-sized clipping.
