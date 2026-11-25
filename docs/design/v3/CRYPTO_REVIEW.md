# Crypto: active-module review and readable asset context

This continues maintainer-accepted #317. Crypto was split from Heatmap, Rotation
and ETF Analytics because its eight modules and shared panels merit a separate
review. This implements the remaining market-overview page; host acceptance is
open. Ten ordinary menu destinations remain, starting with income/risk/quant.
No release preparation or provider expansion.

## Hierarchy and scope

A compact labelled module selector replaces the large hero/navigation block. The
active module leads the DOM/reading order. Focus asset context sits beside it on
wide screens and follows it on narrow screens; keyboard jump links focus the
module or asset region explicitly. Market snapshot, radar/mover queue and sector
helpers use native disclosures rather than reserving a second stack of panels
before the primary task. The unrelated global ticker loader is hidden; the
workspace retains its own asset/filter/module scope and shared shell controls.

Market filters have visible labels and keep their existing query-driven behavior.
The board shows its existing first-28-row limit, full names wrap, and numerical
values/route labels remain intact within a named local scroller. Focusing an
asset survives ranking changes that still return it. While another scope loads,
old rows/focus are hidden. Selecting a mover/radar/component outside the current
board searches for that symbol through the existing market endpoint and clears
the sector filter, rather than silently focusing the first unrelated result.
Sector context selection clears the old search before applying the sector.

Focus shares are explicitly shares of the filtered board, not the global market.
Global cap comes from the dominance response and is unavailable when absent;
it no longer silently substitutes a filtered-board total. Breadth is unavailable
without rows and labels non-negative/negative counts accurately. Existing chart
symbol normalization, global ticker update, chart-workstation route and dated
market-context route remain. Requested controls remain distinct from verified
provider behavior; this is not a routing/provider certification.

## Eight retained modules

- **Markets:** named search/sector/sort/direction controls, applied board scope,
  focus selection and the existing 120-row request/28-row display limits.
- **Movers:** labelled metric, responsive full-name cards and coherent focus
  navigation back to the market board.
- **Index:** original index metrics and a clearly labelled filtered-board preview;
  the preview does not establish actual index membership.
- **Sectors:** readable current 24h basket names and existing component actions,
  without implying historical rotation.
- **Heatmap:** responsive full-name cards show returned cap/depth values; equal
  card sizes are not described as market-cap area sizing. Existing bucket colours
  and depth arithmetic remain. Response-specific non-live scope stays visible.
- **Derivatives:** totals and funding/OI/liquidation calculations retain their
  values; the numerical table has a named keyboard-focusable local scroller.
  Missing totals are unavailable rather than a client-created zero object.
- **DeFi:** market-cap/volume-derived TVL, DEX and borrowing proxies are explicitly
  labelled as modelled, not observed on-chain values. Protocol names wrap and
  basket dominance is identified as basket-local. No backend formula changes.
- **Correlation:** labelled history window and returned-window context, a named
  focusable/scalable table, and per-response degraded markers. Missing/non-finite
  cells are unavailable; an actual numerical zero still displays `0.00`.

## Read states and source limits

A common active-module region distinguishes loading, failed read, empty results,
failed refresh with retained/unrefreshed values, and non-live/partial responses.
Manual Refresh module retries the current request. Modules without data do not
receive a fabricated zero metric panel. True response zeros remain visible.
Existing React Query keys keep delayed search/window responses in their requested
scope; changing controls does not relabel old correlation data as a new window.

Advanced response timestamps and degraded markers are shown when supplied. Raw
scope/timestamp details are disclosed, while active failures/non-live markers
remain visible. Existing polling cadence, limits, query keys, transport and API
helpers remain; this PR does not add providers, API-key permissions or MCP tools.
Some basic API helpers return only arrays and discard response metadata, so their
observation time is explicitly unavailable here. No global “live market map” badge
claims freshness for the entire workspace.

## Validation and synthetic captures

All 907 frontend tests / 150 files and the complete 166-case installed-Chrome
smoke suite pass, including the seven new browser journeys. Seven focused unit
tests pass. Production build, API-reference, surface-inventory, production-mock,
source-artifact, review-link/JSON, retained-helper and whitespace checks pass.
The unchanged backend suite was not rerun.

Reviewed synthetic captures:

| Module | Desktop | Mobile |
|---|---|---|
| Market board | [1440px](evidence/crypto-markets-1440.png) | [390px](evidence/crypto-markets-390.png) |
| Full-name heatmap | [1440px](evidence/crypto-heatmap-1440.png) | [390px](evidence/crypto-heatmap-390.png) |
| Correlation | [1440px](evidence/crypto-correlation-1440.png) | [390px](evidence/crypto-correlation-390.png) |

[Mobile derivatives](evidence/crypto-derivatives-390.png),
[mobile DeFi proxies](evidence/crypto-defi-390.png) and
[actual 200% Chrome zoom](evidence/crypto-native-zoom.png). Captures show the
visible scrolling workspace viewport; lower content and local scrollers are
verified through interaction, not a claim that every panel fits on one screen.
Seven browser journeys cover every module at 1440/1024/390px, 4× desktop CPU
throttling, actual 200% Chrome zoom, named local keyboard scrolling, long names,
missing versus zero cells, failed/empty reads, retained failed refreshes, late
search/window responses and mover-to-focus navigation. Seven focused unit tests
cover the retained chart/context actions plus scope/error/zero handling and
selection preservation. All API reads/sockets are intercepted; no real provider,
model, private corpus, production DB or deployment is used. No backend/API/schema,
dependency or saved-format changes. The unchanged backend suite is not rerun.

## CI geometry-check follow-up

The reported GitHub run passed 165 cases but exhausted the desktop journey's
60-second budget inside the per-element geometry helper. Geometry is now read
in one browser-side snapshot per module, retaining document/main overflow,
visible non-table control and named-region bounds, with element names in failures.
Closed disclosures remain excluded from visibility checks. Application code and
the normal 4× throttle/60-second timeout are unchanged by this follow-up.

All seven affected journeys pass. Six desktop repeats with the test-only
`CRYPTO_LAYOUT_CPU_RATE=12` override pass at 2.9–3.3 seconds each locally. This
covers the same eight modules and assertions; the initial full local 166-case
suite and 907 frontend-test results above precede this test-only follow-up.
Application/backend suites were not rerun for it.

## v5 audit and next v3 work

These UI checks do not certify the underlying crypto tools or calculations.
Record for v5:

- Market sorting: the existing client sends `sortBy`/`sortOrder` while the server
  route declares `sort_by`/`sort_order`; verify and repair the adapter contract.
  This pass labels them requested order and leaves transport behavior unchanged.
- Quote/native identity, freshness, metadata propagation, provider coverage and
  the existing chart-symbol normalization/global market interaction.
- Index membership versus filtered-board rows; sector/breadth basket semantics;
  depth sources, estimates and bucket classification.
- Funding, OI and liquidation coverage, totals/zero-versus-unavailable semantics,
  timestamps and source-specific partial responses.
- DeFi's existing market-cap/volume proxy coefficients, provenance and their
  distinction from genuine on-chain fundamentals elsewhere in the application.
- Correlation return history/alignment and partial-history treatment. Preserve
  missing-data honesty and evaluate hidden-module polling load during that audit.

Next v3 batch: Dividends, Risk, Correlation, Stat Lab and Pair Trading, split into
reviewable areas if their existing implementations warrant it. The v4 MCP and v5
functionality audit remain separate from this frontend gate.
