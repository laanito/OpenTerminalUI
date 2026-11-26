# Pair Trading: explicit runs and readable statistical evidence

Continues merged #324, which the maintainer confirms tested. Dedicated v3 work
now covers 35 render entries, including 28 of 32 tool destinations and three
shell-menu extras. Five ordinary destinations remain: MTA, DOM, Backtesting,
About and Account. Direct/auth/secondary/hidden presentation and wider v3
acceptance remain open. Pair Trading host acceptance is open. No release prep.

## Hierarchy and retained operations

Four wrapping, keyboard-operable analysis buttons lead to their effective labelled
inputs. Pair test uses the two symbols and period. Spread and Backtest additionally
show entry/exit thresholds and z-score observation window. Scan shows only period
and the existing fixed basket: VOO, SPY, KO, PEP, XOM, CVX, GLD, IAU. It does not
pretend the pair fields or thresholds configure that basket. The unrelated shared
ticker loader is hidden on this route; these forms determine the request scope.

Nothing runs on arrival or view selection. Explicit submission replaces automatic
tab-triggered requests, so users can review the scope first. Defaults remain VOO /
SPY, 2Y, entry 2, exit 0.5 and window 60; retained periods are 1Y/2Y/3Y/5Y. Payloads
still call `/pairs/test`, `/spread`, `/signals` and `/scan`; API defaults and backend
calculations are unchanged. Window bounds follow the API's integer 10–252 range.
Thresholds accept finite fractional values without adding restrictions absent
from the API. Symbols trim/uppercase at submission and must be distinct.

- Pair test shows the service verdict, full wrapping explanation, hedge ratio,
  p-values, half-life in observations, z-score and returned period dates. Alpha,
  ADF statistic and residual estimates remain available in a disclosed table.
- Spread and rolling z-score use separate, readable charts instead of competing
  axes. Positive/negative entry/exit lines use the returned response values,
  remain visible even outside the observed z-score range, and do not move when a
  draft changes. Returned thresholds display without a two-decimal rounding loss.
  Exact observations include both prices, hedged second price, spread and z-score.
- Backtest identifies its curve as a unitless model series, separate from portfolio
  value and recorded trades. Reported statistics and exact date/equity/position/
  z-score values are inspectable. Missing observations remain gaps instead of
  drawing a connected line through them.
- Scan preserves service ordering and shows all returned pairs in a named,
  focusable, bounded table. Row/column headers and keyboard horizontal/vertical
  scrolling keep wide numerical content local rather than widening the page.
  Empty results and unknown conclusions are distinct from a failed read or a
  literal zero coefficient/p-value. Omitted pairs do not establish failed tests.

Labels/axes are at least 12px, with readable values and wrapping prose. Inputs and
metric cards reflow instead of forcing six compressed columns. Initial/pending
states are compact notices, replacing the old large empty/loading spaces.

## Captured runs and failure states

Pair/period/threshold drafts remain shared across the related analyses, preserving
the prior setup convention. Each view retains its own captured run while mounted.
Only effective inputs enter that capture, so changing unused thresholds cannot
rename a Pair test or Scan. Editing effective inputs leaves completed results with
an explicit changed-input notice. Captured symbols and service-reported symbols
are separately labelled; the browser does not silently rewrite service output.

Submitted fields lock until that view's request settles. A synchronous guard
prevents duplicate submissions; switching views remains possible. Late inactive
completions keep their original scope and do not steal focus. Active completion
focuses the named result section; unmounted completions are ignored. A rerun
clears the previous result immediately. Failure keeps the draft, shows a generic
manual-retry message and exposes no raw provider text. Empty objects, empty scan
rows, partial statistics, explicit false and literal numeric zero have separate
presentations. No automatic retry or saved-analysis format is introduced.

## v5 functionality boundary

No model, provider, API, schema, dependency, saved format or execution capability
is added. This workspace never places live or paper orders. The model backtest
omits fees, slippage and financing costs; source prices/spreads lack currency
metadata, so display-currency conversion is not applied.

The v5 audit must verify native identity, adjusted/currency basis and exact-
timestamp cross-market joins. The loader drops dates across the available scan
basket before individual pair tests, and missing symbols/pairs can disappear;
review per-pair overlap, omissions and provenance. Review non-finite-to-zero
coercion and the 9999 half-life sentinel, full-sample fitting/lookahead,
calibration, return denominator, trade exit/win accounting and missing costs.
The scan cache sorts basket identity although OLS direction follows supplied order;
verify orientation/freshness. This is distinct from Correlation's already order-
preserving cache. Synthetic frontend checks do not certify models or provider
coverage. The separate non-smoke live-data journey is updated for explicit Run
buttons, but is not executed during this fixture-only frontend review.

## Verification

All 941 frontend tests / 155 files, production build and all 195 installed-Chrome
smoke journeys pass. Eight new unit cases cover explicit/default payloads, fixed
scan scope, shared drafts and captured runs, API validation, duplicate guards,
late inactive focus, returned thresholds, missing/zero and failed/empty reruns.
Six browser journeys cover all four analyses at 1440/1024/390px, 4× desktop CPU,
actual plotted paths and all five z-score reference lines, exact values, keyboard
table scrolling, partial/empty/failure states and native 200% Chrome zoom. After
final metric-row reflow, cleared-zero draft handling and native-zoom keyboard
checks, eight focused unit cases, six browser journeys and build pass again.
API-reference/surface/production-mock/source/whitespace guards and review links/
JSON pass. Thirteen final synthetic captures are linked below. API/model and
socket responses in browser checks are intercepted synthetic fixtures; no live
provider/model/private corpus, production DB, deployment or financial execution
is accessed. The backend suite is unchanged and not rerun for this frontend slice.
The source ledger is regenerated; the 39 original browser probes and baseline
screenshots stay unchanged. GitHub CI and maintainer acceptance are separate gates.

## Synthetic captures

Captures show the scrolling workspace at the reviewed section. Local table
scrolling is intentional; interaction checks cover content beyond the viewport.

| Workflow | Desktop | Narrow |
|---|---|---|
| Pair setup | [1440px](evidence/pairs-inputs-1440.png) | [390px](evidence/pairs-inputs-390.png) |
| Threshold setup | [1440px](evidence/pairs-thresholds-1440.png) | [390px](evidence/pairs-thresholds-390.png) |
| Pair test | [1440px](evidence/pairs-0-1440.png) | [390px](evidence/pairs-0-390.png) |
| Spread and z-score | [1440px](evidence/pairs-1-1440.png) | [390px](evidence/pairs-1-390.png) |
| Backtest | [1440px](evidence/pairs-2-1440.png) | [390px](evidence/pairs-2-390.png) |
| Fixed-basket scan | [1440px](evidence/pairs-3-1440.png) | [390px](evidence/pairs-3-390.png) |

[Native 200% Chrome zoom](evidence/pairs-native-zoom.png) uses Chrome surface
capture through CDP to avoid CSS-sized full-page clipping. The scan table is
focused; keyboard interactions check both scrolling directions and all four views.
