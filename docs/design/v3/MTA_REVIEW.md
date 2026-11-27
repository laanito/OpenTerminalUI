# MTA: readable chart contexts and independently scoped history

Continues merged #325; the maintainer clears continuation. MTA and DOM were
inspected together, but each
workspace has enough chart/depth state to warrant a separate implementation PR.
This slice implements MTA; DOM is next.

Dedicated v3 work now covers 36 render entries, including 29 of 32 tool destinations
and three shell-menu extras. Four ordinary destinations remain: DOM, Backtesting,
About and Account. Direct/auth/secondary/hidden presentation and broader host
acceptance remain open. MTA host acceptance is open. No release preparation.

## Chart-first hierarchy

The current symbol/request market and preset lead, with readable wrapping preset
buttons and crosshair-sync/manual-refresh controls. The retained symbol picker
shows full company names within a bounded local list; selected names wrap in the
scope line. The unrelated global ticker loader is hidden on this route. The
picker's US/IN context and NASDAQ/NSE request mapping remain existing behavior,
not a claim that other listings are unsupported by the shared search universe.

Four contexts retain their roles and default Swing stack. Each plot has a reliable
320px height instead of depending on a percentage height inside an indefinite
flex area. Charts use two columns at 1280px and wider, and stack below that so
controls and axes remain readable. Plot axes and primary labels are at least 12px.

| Preset | Long-term | Medium-term | Short-term | Execution |
|---|---|---|---|---|
| Position | M · 1mo/max | W · 1wk/5y | D · 1d/1y | 4H · 4h/6mo |
| Swing (default) | W · 1wk/5y | D · 1d/1y | 4H · 4h/6mo | 1H · 1h/3mo |
| Day Trade | D · 1d/1y | 1H · 1h/3mo | 15m · 15m/1mo | 5m · 5m/1mo |
| Scalp | 1H · 1h/3mo | 15m · 15m/1mo | 5m · 5m/1mo | 1m · 1m/5d |

Per-context Chart controls disclose labelled native selectors for Candles/Line
and EMA20/50/200. Their current settings stay visible in the disclosure summary.
Modes/overlays remain independent and do not refetch history. Each chart also
has a disclosed exact OHLCV/selected-EMA table, with UTC observation times,
row/column headers and a named focusable local scroller. Numeric zero stays
visible. No persistence format or new indicator is introduced.

## Scope, hover and reads

Each scope change immediately clears old visible history, price/hover and trend
values. Symbol, effective request market, preset and refresh revision form the
read identity. Old completions and unmounted reads are ignored. Four histories
still use the same `fetchChart` arguments, but each can finish independently;
a slow or failed context no longer delays successful ones. Failure and empty
history differ, raw provider text is hidden, and Refresh charts explicitly
reloads the four contexts. The existing history transport/fallback remains;
the page adds no automatic retry, polling or provider request path.

The active chart shows an inspected close/time while hovering and returns to
its latest observation on leave. A hovered value cannot survive a data-scope
change. Existing crosshair sync remains a nearest-available-bar visual guide,
not synchronized quotes; its toggle/default and per-role colours remain.

The trend summary is disclosed below the charts. It explicitly remains EMA20,
independent of each selected overlay. Incomplete/failed/loading histories now
report unavailable alignment and no directional arrow, rather than fabricating
a neutral/mixed conclusion. The original seeded EMA recurrence, ±0.5% trend
threshold and valid-data alignment rules remain unchanged.

## Functionality boundary and v5 findings

No backend, API contract, provider, dependency, schema, saved workspace/ticker
format, indicator calculation or execution capability changes. Existing preset
interval/range pairs and chart/EMA/crosshair math are retained.

v5 must verify legacy BSE→NSE and non-India→NASDAQ request mapping, the shared
picker's US/IN ranking context/non-US badges and search race/metadata behavior,
4h/intraday period availability, normalized/legacy history fallback, adjusted/
currency basis and malformed/missing/duplicate/sorted observations. This page
still does not consume returned currency metadata/warnings or convert prices to
the display currency. Source review and fixtures are not provider/indicator
validation. A nearest bar does not imply a simultaneous close across intervals.
DOM's inferred volume-at-price, market fallback and missing/stale quote/depth
presentation are also source observations for its later audit, not fixes here.

## Verification

All 949 frontend tests / 156 files, production build and all 201 installed-Chrome
smoke journeys pass. Eight new unit cases cover four default scopes, independent
completion, late preset rejection, refresh/failure/empty/zero, scoped hover labels,
independent style/EMA and unchanged summary basis, market mapping and exact values.
Six new browser journeys cover all four presets at 1440/1024/390px, 4× desktop CPU,
real candle-pixel rendering in every plot, real hover/leave, picker long names,
local keyboard tables, failure/empty/late completion and native 200% Chrome zoom.
The retained fixture journey also passes. After final disclosure containment and
hover-label refinements, all eight focused unit cases, seven affected browser
journeys and build pass again. API-reference/surface/mock/source/whitespace guards,
review links and JSON pass. Source comparison verifies unchanged preset/market
helpers, EMA/nearest-point/trend math and series conversions. Eleven final
synthetic captures are linked below. Browser history,
search and socket responses are synthetic and intercepted. No live provider/model,
private corpus, production DB, deployment or order execution is accessed. The
unchanged backend suite is not rerun. The original 39 browser probes and baseline
captures remain; the source ledger is regenerated. GitHub CI and maintainer host
acceptance are separate gates.

The retained MTA fixture journey is updated to the actual instrument-search
contract, normalized millisecond timestamps and intercepted background traffic.
Its chart selectors distinguish the named plot from the TradingView logo; tests
retain real chart rendering rather than replacing the canvas with a placeholder.

## Synthetic captures

Captures show the scrolling workspace at the reviewed section; interactions
check lower content and intentional local numerical scrolling.

| Surface | Desktop | Narrow |
|---|---|---|
| Scope and four contexts | [1440px](evidence/mta-scope-1440.png) | [390px](evidence/mta-scope-390.png) |
| Per-context controls | [1440px](evidence/mta-controls-1440.png) | [390px](evidence/mta-controls-390.png) |
| Exact observations | [1440px](evidence/mta-values-1440.png) | [390px](evidence/mta-values-390.png) |
| EMA20 summary | [1440px](evidence/mta-summary-1440.png) | [390px](evidence/mta-summary-390.png) |
| Long-name picker | [1440px](evidence/mta-search-1440.png) | [390px](evidence/mta-search-390.png) |

[Native 200% Chrome zoom](evidence/mta-native-zoom.png) uses a Chrome surface
capture through CDP to avoid CSS-sized clipping. It focuses the exact-value table;
keyboard checks cover both scroll directions and real plots keep useful height.
