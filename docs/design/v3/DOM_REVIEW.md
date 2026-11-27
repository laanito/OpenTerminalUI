# DOM: readable book/tape inspection and explicit coverage

Continues merged #327. MTA is maintainer-confirmed working and its Home Research
shortcut is merged. This slice implements the DOM workspace, including its
shared TimeAndSales component. Security Hub and the direct Tape route receive
that component update; their wrapper pages are not new dedicated reviews.

Dedicated v3 work now covers 37 render entries, including 30 of 32 tool destinations
and three shell-menu extras. Three ordinary destinations remain: Backtesting,
About and Account. Direct/auth/secondary/hidden presentation and broader host
acceptance remain open. DOM host acceptance is open. No release preparation.

## Primary reading flow

Applied instrument/selector context and the labelled Load symbol form share a
compact header. Draft edits do not rename results; loading trims/normalizes the
symbol and rejects a blank input while preserving the current scope. The unrelated
global ticker loader is hidden. Desktop book/tape panels sit side by side and
stack below 1280px. Their height follows content instead of reserving 920px each.
Labels are at least 12px, long provider names wrap and numerical scrolling stays
inside named, focusable regions.

The ladder shows the reported book reference and spread. Snapshot metrics are
disclosed, alongside a separate exact returned-level table with side, price,
quantity, orders and cumulative quantity. The reference is not labelled a last
trade: the current wire helper derives it from the book. Provider, reported
symbol and snapshot time remain visible, with explicit coverage notices.

## Depth state and controls

- Existing level choices 10/20/40 and 1/2/5-second retrieval settings remain;
  defaults are 20 and 2 seconds. Native labelled selectors replace small button
  clusters. Cumulative and Auto-center have pressed states; manual refresh is
  available. Fetching is described as a request, not a live-feed certification.
- Empty bids/asks do not generate a zero-centred price ladder or neutral 50/50
  shares. Loading, failed reads, empty coverage and a returned degraded marker
  have separate presentations. A failed refresh hides the previous book. A
  populated book can retain its dated snapshot during the next polling request.
- Query functions no longer mutate previous-snapshot state. Observed query data
  and request scope drive comparisons, so late old-symbol/level requests cannot
  corrupt the new view's flash state or callback. Existing request-market mapping
  to IN/CRYPTO/US remains, including its legacy non-India/non-crypto fallback.
- Auto-center changes only the ladder's own scroll position, rather than scrolling
  the page on every update. It pauses while the ladder is hovered/focused. The
  bounded grid has row/column semantics and keyboard scrolling; returned levels
  remain available when a usable projection reference is absent.
- The existing grid construction, tick fallback, cumulative quantities and
  comparison math remain. The UI identifies a missing tick and its 0.01 display
  assumption. Quantity formatting preserves up to eight fractional digits rather
  than rounding fractional sizes to integers. Inferred yellow price shading is
  removed; relative quantity bars are not described as executed volume at price.

## Shared tape behavior

The endpoints, default limit 500, five-second retrieval cadence, 2,000-row local
buffer, timestamp/price/quantity/side identity, sorting and above-twice-average
large-trade rule remain. The summary is a separate window request, not an
aggregation of the rendered buffer. Both retain independent failure/coverage
states; degraded empty summaries do not masquerade as healthy zero statistics.
Healthy numerical zero remains visible.

The tape has a labelled native filter and whole-unit minimum-size draft. Invalid
minimum sizes retain the draft with a field-level explanation. Empty feed, no
filter matches and request failure differ. Failed reads hide buffered rows;
empty responses, including degraded unavailable feeds, clear them. Symbol/limit changes immediately hide
the previous buffer. Filter changes reset virtual inspection to avoid landing
beyond the smaller filtered list.

Rows retain bounded virtualization with 40px display height, 18 visible rows and
8 overscan rows, plus table/row-count semantics. Side appears as text beside time,
so colour is not the only indication and the side stays visible before numerical
columns scroll. Trade times remain browser-local, with the full timestamp on
hover. Auto-follow is explicit and pauses during inspection; retrieval continues.
Manual refresh/retry does not pretend to pause or stream a provider feed.

The separate quote context is disclosed below the book/tape. It uses the existing
`fetchStock(symbol, selectedMarket)` operation with scope/generation guards rather
than reading a potentially stale global stock. The valid derived price-change
formula remains. The formerly incidental, unused chart fetch is removed. Quote,
book reference and tape are not presented as one synchronized observation.

## Functionality boundary and v5 work

No backend, provider, schema, dependency, persistence format or order execution
capability changes. The frontend depth type now includes the backend's already
returned optional nullable degraded marker; no API contract expansion is added.
Polling settings remain; query-level automatic retries are disabled in favour
of the existing polling cadence and explicit refresh. Transport/auth behavior
is unchanged.

v5 must audit real US/EU L2 availability, native identity and market mapping;
missing tick metadata (the wire helper can emit zero), 0.01/four-decimal grid
assumptions, book-midpoint reference semantics, unmatched returned levels and
relative bar normalization. The retained display-weight computation still
influences bar scaling; removal of its yellow overlay is not model calibration.
Returned levels provide the exact inspection path while those issues remain.

Tape requires independent exchange/default routing, integer quantity coercion,
two-decimal provider-price rounding, inferred sides, timestamp fallback, local
identity collisions and ISO-string ordering review. Verify buffered versus
summary windows, currency, native precision and freshness/provenance. No model
or provider accuracy is inferred from synthetic frontend acceptance.

## Verification

All 961 frontend tests / 157 files, production build and all 207 installed-Chrome
smoke journeys pass. Twelve new unit cases cover applied/scoped instruments,
empty/degraded/failed depth, real zero/fractional values, cumulative quantities,
late depth/quote reads, independent tape/summary failures, virtual filter reset,
minimum-size drafts, deduplication and the 2,000-row cap. Six new browser journeys
cover 1440/1024/390px, 4× desktop CPU, native 200% Chrome zoom, local keyboard
scrolling/centering, cumulative values, exact levels, virtual tape filtering and
failed/empty/late states. Scrolling checks follow actual overflow, including when
the narrowed tape table fits at native zoom. The retained ladder fixture also
passes with explicit symbol loading and isolated background traffic.

After final visible toggle styling, all twelve focused unit cases, seven affected
browser journeys and production build pass again. API-reference/surface/mock/
source/whitespace guards and review links/JSON pass. Source comparison verifies
unchanged market/tick/grid, tape-time, identity and large-trade helpers. Twelve
final synthetic captures are linked below. Browser depth,
quote, tape and socket responses are synthetic/intercepted. No live provider,
model, private corpus, production DB, deployment or financial execution is used.
The unchanged backend suite is not rerun. The source ledger is regenerated; the
39 original browser probes and baseline screenshots remain unchanged. GitHub CI
and maintainer host acceptance are separate gates.

## Synthetic captures

Captures show the reviewed viewport inside the scrolling workspace. Local
numerical scrolling is intentional; interactions check content beyond the frame.

| Surface | Desktop | Narrow |
|---|---|---|
| Book and tape | [1440px](evidence/dom-overview-1440.png) | [390px](evidence/dom-overview-390.png) |
| Ladder controls/inspection | [1440px](evidence/dom-ladder-1440.png) | [390px](evidence/dom-ladder-390.png) |
| Returned provider levels | [1440px](evidence/dom-returned-1440.png) | [390px](evidence/dom-returned-390.png) |
| Virtual tape | [1440px](evidence/dom-tape-1440.png) | [390px](evidence/dom-tape-390.png) |
| Independent summary | [1440px](evidence/dom-summary-1440.png) | [390px](evidence/dom-summary-390.png) |

[Unavailable coverage](evidence/dom-unavailable.png) and
[native 200% Chrome zoom](evidence/dom-native-zoom.png). Native zoom captures
Chrome's actual surface through CDP to avoid CSS-sized clipping.

## Home discovery follow-up

#328 is merged. Home → Launch Matrix → Markets → **Depth of Market** now opens
`/equity/dom`, using the full name and the shared launcher’s keyboard/responsive
behavior. Menu → Markets → DOM remains available. This adds a shortcut to the
existing workspace; dedicated review counts and the next Backtesting slice remain.

Navigation follow-up validation: 19 existing Home/widget tests, five Home browser
journeys (1440/1024/390px, Quant and native 200% zoom), production build, source
audit and whitespace checks pass. Broader application/backend suites were not
repeated for this single launcher item; the full DOM validation above is historical.
