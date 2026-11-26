# Statistical Lab: focused setup and readable captured results

Continues maintainer-accepted #323. The Correlation correction is confirmed working;
its broader model/provider audit remains v5. This slice brings dedicated frontend
work to 34 render entries, including 27 of 32 tool destinations and three shell-
menu extras. Six ordinary menu destinations remain: Pair Trading, MTA, DOM,
Backtesting, About and Account. Direct/auth/secondary/hidden presentation and
broader v3 acceptance remain open. #324 is merged and maintainer-tested;
Stat Lab host acceptance passed. Counts above describe this historical slice.

## Retained workflows

One labelled analysis selector replaces the dense tab row. Inputs wrap at useful
widths and all visible fields have associated labels. The unused shared ticker
loader is hidden on this route; local analysis symbols determine requests.
Long method names remain readable in accompanying text instead of depending on a
clipped native option. Idle analyses use a compact notice rather than a blank plot.

Seven analyses retain their existing operations and defaults:

| Analysis | Submitted defaults | Reading surface |
|---|---|---|
| Forecast | AAPL, first available service method, 30 steps | History, forecast mean and returned interval; exact history/forecast tables; model order, AIC and in-sample RMSE. |
| Pairs/cointegration | AAPL / MSFT | Reported tests, hedge ratio, half-life, signal and z-score; exact spread values. |
| Stationarity | AAPL | Price ADF/KPSS and returns ADF, reported conclusions and retained Hurst heuristic. |
| Factor/CAPM | AAPL / ^GSPC, 63 observations | Rolling beta, return scatter and the service's fitted-line points, estimates and exact values. |
| Autocorrelation | AAPL, 30 lags, returns | ACF/PACF, returned confidence band, exact values and Ljung–Box tests. |
| Granger predictability | AAPL / MSFT, maximum lag 5 | Both directions, lagged p-values and exact values; significance is not labelled real-world causation. |
| Volatility regimes | AAPL | Reported state/parameters and high-volatility probability; exact values. |

The old Decomposition tab had no rendered editor or result despite an existing
backend/API function. It now has an explicit availability notice, without a Run
button or a new request. Implementing that missing workflow belongs to v5.

Existing payloads and backend lookback defaults remain. Numeric controls enforce
the current API's integer bounds: horizon 1–120, regression window 20–252,
autocorrelation lags 5–60 and Granger maximum lag 1–15. Symbols trim/uppercase
at submission; pair analyses reject identical symbols. No model, provider,
dependency, schema, persistence format or API contract changes.

## Run scope and reading states

Each analysis keeps its own draft and captured run while this page stays mounted.
Nothing runs automatically. Submitted fields lock until that request settles;
a synchronous guard prevents duplicate submissions. Switching analysis is allowed,
and a late completion cannot move focus away from another analysis. Active
completion focuses the named result section. Unmounts ignore late completions.

Editing a completed draft leaves its original captured inputs visible with an
explicit changed-input notice. A rerun clears its prior result immediately;
failure keeps the draft with a generic manual-retry message instead of exposing
raw provider text or showing stale values. Methods have independent loading,
failed/empty and manual-refresh states. Empty analysis objects have a separate
no-values result. No automatic retry is introduced.

Charts have readable axes and HTML exact-value alternatives. Full returned names
wrap in HTML rather than being squeezed into legends. Numeric tables have named,
focusable local scrollers and row/column headers. Missing/non-finite numbers are
unavailable; literal zero and explicit false conclusions remain distinguishable.
Missing Hurst values do not produce a neutral interpretation. Regime annual
volatility is already returned in percent and is not multiplied again. Regression
uses the returned fitted-line points rather than refitting in the browser.

## Functionality boundary

This is frontend acceptance, not model validation. v5 must inspect native symbol
identity and positional column fallback in `_get_pair`, quote currency/adjusted
basis, cross-market overlap and missing-data semantics. Forecast business-day
dates require crypto/calendar verification. Review model calibration/fallbacks,
zero sentinels, cointegration half-life/z-score/signal semantics, Hurst thresholds,
Granger lag selection/multiple comparisons and regime annualization/classification.
No backend calculation is changed here. Price/model values lack currency metadata;
no display-currency conversion is added. Results are temporary page state.

## Verification

All 933 frontend tests / 154 files, production build and all 189 installed-Chrome
smoke journeys pass. Eight new unit cases plus the updated retained title case
cover captured scopes, independent drafts, duplicate guards, validation, method
failures/retries, missing/zero and the unwired analysis. Six new browser journeys
cover all seven analyses, real chart paths including the returned regression fit,
1440/1024/390px, 4× desktop CPU, keyboard table scrolling, late inactive completions,
method failures, partial/empty results and native 200% Chrome zoom. After refining
capture positions and correcting the fitted-line legend colour, all nine affected
unit cases, six browser journeys and production build pass again. API-reference,
surface, production-mock, source-audit and whitespace guards pass; review links
and JSON are valid. Seventeen synthetic captures are linked below.
All browser/API/model responses are synthetic and intercepted. No live provider,
model, private corpus, production DB, deployment or financial execution is used.
The unchanged backend suite is not rerun for this frontend-only slice. The source
ledger is regenerated; the original 39 browser probes and screenshots remain
unchanged. Maintainer host acceptance and GitHub CI remain separate gates.

## Synthetic captures

Captures use deliberately long names, numeric zero and populated service-shaped
results. Local numerical scrolling is intentional; the whole page must not
scroll horizontally. Captures show the scrolling workspace at the reviewed
section; lower content and local overflow are checked by interaction.

| Workflow | Desktop | Narrow |
|---|---|---|
| Labelled setup | [1440px](evidence/statlab-inputs-1440.png) | [390px](evidence/statlab-inputs-390.png) |
| Forecast | [1440px](evidence/statlab-forecast-1440.png) | [390px](evidence/statlab-forecast-390.png) |
| Cointegration | [1440px](evidence/statlab-coint-1440.png) | [390px](evidence/statlab-coint-390.png) |
| Stationarity | [1440px](evidence/statlab-stationarity-1440.png) | [390px](evidence/statlab-stationarity-390.png) |
| Regression | [1440px](evidence/statlab-regression-1440.png) | [390px](evidence/statlab-regression-390.png) |
| Autocorrelation | [1440px](evidence/statlab-autocorr-1440.png) | [390px](evidence/statlab-autocorr-390.png) |
| Granger predictability | [1440px](evidence/statlab-causality-1440.png) | [390px](evidence/statlab-causality-390.png) |
| Regimes | [1440px](evidence/statlab-regimes-1440.png) | [390px](evidence/statlab-regimes-390.png) |

[Native 200% Chrome zoom](evidence/statlab-native-zoom.png) uses a Chrome surface
capture through CDP, avoiding full-page CSS-dimension clipping. The viewport is
focused on the readable regime table; interactions check the other analyses.
