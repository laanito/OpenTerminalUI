# Macro and FX: readable scopes and inspectable context

This continues merged #314. It covers Forex, Commodities, Economics and Yield
Curve without adding feeds, indicators, accounting or analysis capabilities.
Host acceptance is open. The original remaining-page browser audit remains a
historical baseline; the source ledger is regenerated for the current entry files.

## Reading and scope

- Forex contains its numerical matrix in a named, focusable horizontal scroller.
  Cells announce their base/quote pair and selection; other URL parameters survive
  pair selection. Long bank names and dates wrap within a separate table scroller.
  Pair plots keep usable height and charts/summary values hide the previous pair
  while the new request is loading. Cancelled/late reads cannot replace a newer
  selection. Panel names, actions, metadata and chart labels use readable sizes.
- Existing sample fallbacks stay available but are identified as samples, including
  empty responses that previously silently selected a sample. The old claims about
  missing router registration and global “Backend live” status are removed.
  FX pair source/timestamps and cross-rate timestamps are shown when supplied.
  The backend central-bank monitor is a static reference, explicitly labelled as
  such. Currency levels retain the existing nominal-level calculation; the heading
  no longer implies these are measured currency-strength returns.
- Commodities keeps category selection, aliases, contract quotes, security links,
  curves and seasonality. Contract buttons are keyboard operable, selected state is
  announced and names wrap. The quote table scrolls locally; plots fit their own
  column. Term structure and seasonality share a chart row after quote review, avoiding
  a stretched empty quote panel. Curve/seasonality source and timestamps are visible; a backend
  `projected` curve is described as modelled, not observed futures quotes. The old
  contract's plots are hidden while selected-contract details load.
- Economics presents a monthly event agenda with full event names instead of tiny
  dot-only targets. Month navigation, impact filters and calendar/macro URL views
  remain. Impact checkboxes are visible and keyboard operable. Event selection
  focuses a named details region; changing month, impacts or retrieved calendar data clears old selection.
  Actual zero remains zero, missing values are unavailable, and supplied times are
  explicitly not converted. Empty, filtered-empty, loading, failed refresh and
  sample states differ. Regional macro names, dates and sparklines remain readable.
- Yield Curve preserves its plotted observations, inversion comparison and spread
  calculations. Date comparison is visibly labelled, captures the requested date,
  prevents concurrent/duplicate submission and retains the date after a failed
  read with an explicit manual retry message. Historical non-live markers survive
  comparison. Remove controls are named. Current-curve and spread failures appear
  independently; absent spread/inversion data no longer masquerades as zero or
  “no inversion.” The spread value is labelled in percentage points and table
  changes in basis points, matching the existing transforms. Details scroll locally.
- These four pages hide the unrelated global ticker loader, keeping their own
  selected pair/contract/month/US-Treasury scope visible. Existing shell market
  controls, context rail and routes remain available.

## Release sequence

The maintainer assigned v4 to a curated OTUI MCP for external LLM agents, v5 to
retained-functionality audit and repair, and new features to v6 onward. The
[roadmap](../../wiki/Roadmap.md#product-generations) records the direction and
future discovery boundaries. Existing integration contracts remain supported;
this PR does not implement MCP or grant API-key access to more endpoints.

## Validation

All six affected Chrome journeys pass, including native zoom and retained
comparison failure/retry with disabled controls while pending. Production build
passes. All 901 frontend tests / 150 files and the full 151-case Chrome smoke
suite pass. After the final calendar-refresh selection fix, all six affected
browser journeys, the two existing page unit checks and production build pass
again. API-reference, surface-inventory, production-mock, current source-artifact,
review-link/JSON and whitespace checks pass. The unchanged backend suite was
not rerun.

Reviewed synthetic captures:

| Page | Desktop | Mobile |
|---|---|---|
| Forex | [1440px](evidence/macro-forex-1440.png) | [390px](evidence/macro-forex-390.png) |
| Commodities | [1440px](evidence/macro-commodities-1440.png) | [390px](evidence/macro-commodities-390.png) |
| Economics | [1440px](evidence/macro-economics-1440.png) | [390px](evidence/macro-economics-390.png) |
| Yield Curve | [1440px](evidence/macro-yield-1440.png) | [390px](evidence/macro-yield-390.png) |

[Actual 200% Chrome zoom](evidence/macro-native-zoom.png) (browser/CSS width ratio
2, visual viewport scale 1). Captures show the visible viewport of the scrolling
workspace; browser checks inspect/focus lower content rather than claiming that
every panel fits on one screen.
The browser journeys use intercepted API responses and closed WebSockets, including
long names, samples/projections, unavailable reads, actual zeros, late pair reads,
comparison failure/retry, keyboard selection, 1440/1024/390px and native 200% zoom.
No live provider/model, private corpus, real orders, production DB or deployment
is used. No backend/API/schema/dependency or persistence-format changes.

## Functional limits and next work

This is presentation and local request-state acceptance, not certification of the
legacy macro/FX tools or provider accuracy. The frontend retains its synthetic FX
and commodity fallbacks, nominal currency-level score and commodity normalization;
central-bank snapshot freshness and commodity model/contract fidelity need the v5
functionality audit. Macro values retain the existing percentage convention;
provider units, country coverage, calendar timezone semantics and engine correctness
also need that audit. Verify authenticated retrieval too: the existing Forex and
Commodities helpers use page-local raw `fetch`, rather than the shared API client
that supplies bearer authentication; the backend middleware protects these paths.
A resulting auth failure can select the now-labelled sample fallback. Reproduce
with configured auth during v5; these intercepted fixtures do not validate it.
No new live-source promise or forecast is introduced.

Next retained-page batch: Market Heatmap, Rotation, Crypto and ETF Analytics.
