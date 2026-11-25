# Market overview: readable Heatmap, Rotation and ETF review

This continues merged #316 and the retained-page queue. It covers Market Heatmap,
Sector Rotation and ETF Analytics. Crypto's eight modules and shared panels remain
next in a separate PR; this split keeps their review coherent. The maintainer
confirmed #317 merged and working on 2026-11-25; the frontend is accepted. Existing
provider/data repair, including the maintainer's F&O and macro/FX
findings, remains assigned to v5. No release preparation.

## Heatmap

The scope bar names market, period, grouping and sizing. The existing US/India
choices and initial market preference remain. A named group selector makes
full group names and drill-down available by keyboard and on narrow screens.
Group and scope remain visible separately from the shared shell's market controls.

Wide views retain the existing leaf sizing values, colour thresholds and security
routes. Treemap aggregation counts leaf weights once: group values already
aggregate their children, and counting both reserved roughly half the plot as
blank parent area. This is a layout correction; API values and sizing inputs stay
unchanged. The browser check verifies populated tile coverage.
Tiles show readable symbols/changes only where they fit. Full company names and
metrics are available in a persistent inline inspection region on tile focus or
hover, and through an explicit List view. Native keyboard activation opens the
same security route as clicking. The list is automatic in narrow containers;
full names and unavailable observations wrap without a reserved 620px frame.
Resize is measured before paint without manufacturing a 320px minimum width.

Constituent counts and aggregate sizing values remain unavailable until data is
present. Loading, failed retrieval, empty results and non-live markers differ.
The previous first-eight “Top Movers” heading is now a disclosed constituent
preview; this does not introduce a ranking algorithm. Prices retain the existing
US/USD and India/INR convention, explicitly described without implying currency
conversion. The response does not provide an observation timestamp.

## Rotation

Benchmark, response timestamp, playback date and slider are readable. The square
plot sits beside dated values on wide pages, stacks on narrow pages and avoids
stretched empty margins. The plot has useful height and its guide is disclosed instead of pushing the chart down.
Quadrant/axis explanations and dated sector values live in normal HTML, avoiding
tiny or clipped SVG text. Sector cards highlight the corresponding trail on
pointer/focus and retain existing stock routes. The fixed 80–120 plot window is
explicit; out-of-window values remain inspectable in the cards. Missing trails
are not represented as zero observations.

The existing trail-index selection, coordinate mapping and quadrant thresholds
remain. Playback now owns a cleaned-up interval effect instead of starting timers
inside useMemo: one step per tick, a bounded stop, pause on slider changes and
reset on benchmark changes. The marker ID is instance-specific. This shared
component also fits and scrolls within the retained Launchpad/popout caller;
no workspace storage, linking or popout contract changes. The shared symbol
store now returns a stable unlinked snapshot to useSyncExternalStore; allocating a
new snapshot per read previously crashed an unlinked popout in a render loop.

## ETF

A labelled ETF form applies the ticker and preserves unrelated URL parameters;
typing does not issue partial-symbol requests. The comparison has its own labelled
form, draft and explicit applied tickers. Invalid one-symbol comparisons retain
and identify the previous applied result. Holdings and overlap lead; fund flows
remain available in a native disclosure. The old filler intelligence panel is
removed rather than reserving empty space.

A small shared read hook associates data and failures with their requested scope,
ignores late/unmounted responses and supplies explicit manual retries. Changing
scope hides previous data immediately; errors do not display raw provider details.
This uses the existing authenticated API client and routes. Empty responses,
loading, failures, actual zero flows and response-specific non-live markers differ.
Company names wrap, numerical tables scroll locally, and explicit sort values
retain the shared table's name/numerical sorting and keyboard/context controls.
Existing holding-weight, overlap-percent and flow formatting is unchanged.

These three pages hide the unrelated global ticker loader while keeping their
own scope visible. No backend/API/schema, dependency, saved format or provider
changes. No new analytical capability or trade execution is introduced.

## Validation and captures

All 903 frontend tests / 150 files and the full 159-case installed-Chrome smoke
suite pass, including the eight new affected journeys. Four focused ETF/shared-
context checks pass. Production build, API-reference, surface-inventory,
production-mock, source-artifact, review-link/JSON and whitespace checks pass.
The unchanged backend suite was not rerun.

Reviewed synthetic captures:

| Workflow | Desktop | Mobile |
|---|---|---|
| Heatmap full-name list | [1440px](evidence/market-heatmap-1440.png) | [390px](evidence/market-heatmap-390.png) |
| Rotation plot and dated values | [1440px](evidence/market-rotation-1440.png) | [390px](evidence/market-rotation-390.png) |
| ETF holdings, flows and overlap | [1440px](evidence/market-etf-1440.png) | [390px](evidence/market-etf-390.png) |

[Desktop map](evidence/market-map.png) and [actual 200% Chrome zoom](evidence/market-native-zoom.png).
These capture the visible scrolling workspace viewport; browser checks inspect
lower content and local table scrollers rather than claiming everything fits on
one screen. The browser journeys use intercepted API responses and closed sockets;
no real providers, private corpus, models, production DB or deployment are used.
They cover 1440/1024/390px, 4× desktop CPU throttling, actual 200% Chrome zoom,
keyboard group/tile/benchmark selection, long names, unavailable/empty results,
retained ETF drafts, late scope responses, bounded playback and a narrow shared
Rotation popout. Existing ETF unit coverage includes draft application and late
responses with scoped retry.

## Functional limits and next work

Layout acceptance and synthetic data do not establish live provider correctness.
v5 should verify Heatmap coverage, period/size semantics, native currency and
quote freshness; Rotation benchmark history, fixed-window/outlier behavior,
missing trails and its stock route; and ETF provider coverage, fund-flow units,
weight/overlap conventions and actual portfolio context. In particular the
existing HoldingsViewer divides weights by 100 before formatPercent, while the
overlap view passes weights directly; verify source contracts before changing
these transforms. This PR retains them and does not certify numerical accuracy.

Crypto follows in its [separate review](CRYPTO_REVIEW.md). Eleven ordinary menu
destinations remained at this report’s implementation point, plus the bounded
direct/compatibility reviews in the audit.
