# Backtesting console: readable setup and submitted-run inspection

Continues merged #329 (Home's Depth of Market shortcut). This slice reviews
`/backtesting` and its shared shell context. Direct Model Governance, Algorithm
Framework and Portfolio Optimizer workflows remain next; shell text changes do
not count as dedicated reviews of those pages. Hidden Model Lab classifications
and navigation are unchanged. The default console is reviewed here. The optional
`VITE_BACKTEST_PRO_WORKSPACE` Mosaic branch keeps its existing command/layout
contract; its dedicated feature-flagged acceptance remains open.

Dedicated v3 work covers 38 render entries, including 31 of 32 primary tools
and three shell-menu extras. About and Account are the two ordinary destinations
left. Auth/direct/secondary/hidden presentation, wider acceptance and Backtesting
host acceptance remain open. This is not release preparation.

## Reading flow

- A compact header includes Saved Views and links to the existing direct research
  tools. The unrelated global ticker loader is hidden on the console only;
  shared market controls and the existing shell preferences remain.
- Setup uses labelled 44px symbol/market/data-interval/date/model/capital fields,
  wrapping selected-model context and readable search results. Data version,
  adjusted/raw series and six execution settings are disclosed together. Basis
  points are explained, with complete commission/slippage/impact/volume labels.
- Before submission there are no zero-valued performance, integrity or trade
  panels. In-flight runs describe the pending result; failed submissions keep
  the setup and show an error with no old performance attached to the new run.
- Submitted symbol, market, dates, interval, strategy and starting capital remain
  visible. Editing the setup prepares another run without renaming/re-denominating
  the current result, changing its reference strategy or resubmitting auxiliary
  validation against different inputs. The AI description also uses the submitted
  strategy rather than a hardcoded provider/model name.
- Completed performance uses wrapping metric cards; the selected chart follows
  ahead of AI commentary. Chart controls have accessible labels and pressed
  states. Indicator management is a full-width disclosure rather than a narrow
  permanent side column. Its toolbar toggle and disclosure share one state and
  start closed; the default strategy overlays remain applied. Chart overlays and
  sensitivity/validation labels are at least 12px. Numerical chart/summary
  calculations remain.
- Exact chart OHLC/inferred-volume rows and equity/cash rows live in named,
  focusable, locally scrolling tables. Monthly and comparison tables also scroll
  locally. The blotter retains fractional units, labels price currency and shares
  a separate disclosure with bounded, wrapping execution logs. No sticky half-
  height panels fight the page scroll.
- Costs/checks/validation and extended projections are separate disclosures.
  Their lazy chart components mount when opened after a completed result;
  no chart workspace loads before the first result. Unknown/insufficient-data
  plots use compact notices rather than large empty areas.

## Request and state boundaries

Submission/job-status/result endpoints, polling cadence, valid request payloads,
strategy catalogue/defaults, data-version handling and saved-view payload format
remain. Restored drafts use the router's page path and survive shared-context
initialization, including React Strict Mode; later shared-symbol changes still
update the next-run draft. Missing/invalid setup is prevented before submission; fees must be finite
and nonnegative, and the volume cap stays within the existing 0.1–100% range.
Main submission and comparison no longer overlap. Comparison retains its own
submitted scope/currency and disables changing the strategy selection during a run.

Server analytics has independent loading/failure/retry feedback. Failure leaves
locally derived equity/trade analytics visible and identified. Generation and
cleanup guards prevent a delayed old-run response from replacing newer analytics.
Auxiliary validation reads also follow the captured main submission and discard
old completions. Retry does not submit another strategy job.

The right rail describes its ticker as shared workspace context rather than the
console's run identity, and replaces implementation notes with workflow guidance.
No backend/API/schema, dependencies, persisted format, provider expansion,
production database or order execution changes.

## Functionality boundaries for v5

This review exposed existing model/provenance limitations; they are recorded in
TODO and the roadmap, with short notices where the UI could otherwise mislead:

- Returned equity-curve rows can supply equity as the chart price when OHLC is
  absent. Chart volume is derived from position, not observed traded volume.
- The transaction-cost display uses a fixed 10-bps estimate independently of the
  submitted execution settings. Data integrity is a local heuristic.
- An empty optimizer result produces an illustrative sensitivity grid; its values
  are not optimization evidence. Parameter, regime, liquidity and implied-volatility
  surfaces are exploratory projections. Order-book/IV surfaces are not observed
  books or options data. Monte Carlo is unseeded; remounting the page can change it.
- Audit native instrument/currency/market/interval coverage, data versions and
  adjustments, strategy/custom-script contracts, cost consistency, local fallback
  analytics, walk-forward/optimization semantics, date alignment and lookahead.
  The comparison request's existing omission of timeframe also needs review.

The frontend does not certify any model, provider or simulated investment result.
Strategy catalogue, indicator/date/bar/marker helpers, polyline/ORB math, local
fallback analytics and derived surface/Monte Carlo calculations match merged main.
Only their scope bindings/presentation change here.

## Verification

All 969 frontend tests / 158 files and the production build pass. The full
installed-Chrome smoke run passed all 212 journeys before final Saved View and
chart-control refinements. All seven affected journeys pass again on the final
source, including the additional Saved View case (the available matrix is now
213 journeys). The unrelated backend suite was not rerun.

Eight new unit cases cover idle loading boundaries, unchanged default/custom
payloads, captured result identity/currency and AI label, failed resubmission,
independent analytics retry, delayed old-run analytics, invalid execution settings
and Saved View restoration under Strict Mode with later shared-symbol changes.
The existing cold-result module boundary test remains passing.

Six new browser journeys plus the retained deterministic job fixture cover
1440/1024/390px, 4× CPU throttling at 1024px, actual native 200% Chrome zoom,
readable setup/execution/metrics, indicator-manager state, local table focus and
scrolling, fractional trade quantities, failed submission/analytics retry and
Saved View restoration. There are no page errors in the populated viewport runs.
The native zoom check measures outerWidth/innerWidth ≈ 2 and visualViewport.scale = 1.

API-reference, surface-inventory, production-mock, source-inventory and whitespace
guards pass, as do review-link/JSON checks. Source comparison confirms unchanged
strategy catalogue, indicator/date/bar/marker helpers, polyline/ORB calculations,
fallback analytics and derived surface/Monte Carlo math. The 39 original audit
probes/screenshots are unchanged.

Fourteen synthetic viewport captures accompany this review. Internal page scroll
positions show the section being inspected; these are not stitched claims that
all content fits in one screen. Native zoom uses a browser/CDP viewport capture.
No live provider/LLM/private corpus, production DB, deployment or financial
execution was used.

| State | 1440px | 1024px | 390px |
|---|---|---|---|
| Setup | [View](evidence/backtesting-setup-1440.png) | [View](evidence/backtesting-setup-1024.png) | [View](evidence/backtesting-setup-390.png) |
| Execution settings | [View](evidence/backtesting-execution-1440.png) | [View](evidence/backtesting-execution-1024.png) | [View](evidence/backtesting-execution-390.png) |
| Result reading | [View](evidence/backtesting-results-1440.png) | [View](evidence/backtesting-results-1024.png) | [View](evidence/backtesting-results-390.png) |
| Validation / exact trade inspection | [View](evidence/backtesting-inspection-1440.png) | [View](evidence/backtesting-inspection-1024.png) | [View](evidence/backtesting-inspection-390.png) |

[Failed submission](evidence/backtesting-failed.png) ·
[Native 200% zoom](evidence/backtesting-zoom.png).
