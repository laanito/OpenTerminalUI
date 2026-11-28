# Direct Backtesting research: usable setup and captured results

Continues merged #330. This slice reviews the existing Model Governance,
Algorithm Framework and Portfolio Optimizer direct routes. The console review
remains separate. Hidden Model Lab routes and the optional Mosaic branch retain
their existing classifications and are not new dedicated reviews here.

Dedicated work covers 41 render entries, including 31 primary tools and three
shell-menu extras. About and Account are the two ordinary destinations left;
continue with them and auth forms. Other direct/secondary/hidden presentation,
broader acceptance and host acceptance remain open. No release preparation.

## Shared reading and request behavior

The pages share a compact title/navigation, full-width readable setup and named,
focusable numerical regions. Fields have persistent labels and 44px native
controls, with complete selected model names below constrained dropdowns. Labels,
chart axes/tooltips and secondary reading are at least 12px. Secondary settings
are disclosed; Framework/Optimizer setup itself can collapse to give results
room. There are no full-height idle/loading placeholders or stretched result
columns. The unrelated global ticker loader is hidden on these three pages;
workspace market/preferences and storage keys are unchanged.

An explicit submission captures a copy of its inputs. Results and receipts keep
that submitted identity when drafts change. Main requests guard duplicate
submissions, clear old output on a new attempt and ignore completions after
unmount. Failures retain the draft and explain that no previous result is shown.
Catalogue failure and empty availability differ, with explicit retry. Unavailable
metadata prevents submission rather than substituting an invented model.

No backend/API/schema, dependencies, saved formats, provider coverage, production
DB, broker or execution capability changes. All existing endpoints and valid
payloads/defaults remain, with client validation of the existing constraints.
No model/provider accuracy is inferred from frontend acceptance.

## Algorithm Framework

Universe, benchmark and optional dates are primary fields. Initial cash, costs,
Top N, rebalance frequency and long-only remain available under Simulation
settings. First catalogue models and their parameter defaults are retained;
choosing a different model initializes that model's defaults. Parameter controls
are labelled by model and parameter, with integer versus fractional inputs.
Cash/costs accept the backend's existing fractional values. Risk overlays have
visible pressed states; drawdown/weight/stop thresholds are explicitly fractions
(0.2 = 20%) rather than misleading percentage inputs.

The submitted receipt includes universe, dates, benchmark, model IDs, cash,
costs, Top N, rebalance and risk settings, with model parameters inspectable.
Eight metrics precede the full-width strategy/benchmark plot. The response's
normalized equity indices are identified as starting at 1; no currency is
invented for the simulation's cash amount. Missing benchmark values stay
unavailable, and the service's alpha fallback to strategy return is explained.

Exact equity observations, latest simulated holdings, first 200 of the returned
signals and all returned rebalances remain accessible in bounded HTML tables.
Signal direction is text (Up/Down/Flat), including real zero confidence; absent
numbers are unavailable. The signal cap is explicit and magnitudes are inspectable.
No new alpha/risk models, formulas, downloads or simulation rules are added.

## Portfolio Optimizer

Universe/dates and Model & Objective lead; constraints/risk settings are disclosed.
The default universe, first service model/objective/risk, sample covariance,
confidence 0.95, rate 0, aversion 2 and weights 0–1 remain. HRP/HERC/RP keep the
existing disabled objective/risk selections; their internally managed meaning is
explained. Inputs label fractions and validate finite settings, date order,
confidence 0.5–0.999 and ordered weights. Solver feasibility remains the service's
responsibility; no new optimization constraints or model calibration is imposed.

Submitted settings, returned model identifiers, eight metrics and a full-width
frontier remain readable. CVaR's caption uses the submitted confidence rather
than a hardcoded 95% or the latest draft. The selected point is also available as
text, with exact frontier values disclosed. Complete allocation and component-
risk tables include zero, small and negative values that the old allocation
filter hid. The same percentage conversion remains; there is no renormalization.
Clusters retain returned leaf order, and per-asset metrics have a separate exact
table. Unknown metrics are unavailable; healthy numerical zero remains visible.
No weights are applied to a real portfolio.

## Model Governance

Registration, comparison and staging have independent pending/error/receipt
states. Run ID/data version/code hash have persistent labels. Registration's
existing replacement semantics are visible: blank optional values clear those
fields and execution_profile is submitted as an empty object. A successful
receipt names the submitted run, not a subsequently edited ID.

Comparisons retain submitted comma-separated IDs and show the number of returned
runs without claiming unreturned IDs exist. Long hashes/IDs wrap in a locally
scrolling table with status/version/experiment/timestamps. Returned execution
profiles have a disclosure. An empty response differs from failed retrieval;
one action's failure does not clear another action's valid result.

Staging is a separate disclosure showing the current target run and the retained
fixed `default-model` registry / `staging` stage. Its explicit button records that
entry; the success receipt names the captured target. No production-promotion
control, deployment workflow, permissions or execution authority is introduced.

## Later functionality review

v5 must independently verify framework model/parameter bounds, provider/native
identity and history alignment, risk-threshold conventions, accounting currency,
benchmark/alpha semantics and simulation lookahead/costs. Optimizer review must
cover feasibility, return/covariance/annualization assumptions, frontier versus
selected-model consistency, risk-contribution units and signed weights.
Governance needs run/registry ownership/permissions, audit records, overwrite
semantics and staging meaning checked. This frontend work neither changes nor
certifies those backend/model behaviors; TODO and Roadmap carry the findings.

## Verification

All 981 frontend tests / 159 files, production build and all 226 installed-Chrome
smoke journeys pass. After final static-chart/axis and draft-target copy changes,
the thirteen affected unit cases and thirteen browser journeys pass again; their
preview startup rebuilds production assets. Backend/API source is unchanged and
the unrelated backend suite was not rerun.

Twelve new unit cases plus the retained optimizer render check verify unchanged
default/custom parameter payloads, captured scope, fractional costs/risk settings,
zero/negative/small weights, unknown metrics, confidence labels, failed drafts,
metadata failure/empty retry, independent governance actions, fixed staging
payload and late comparison receipts. No live model calculations are mocked as
certified investment outputs.

Thirteen new browser journeys cover each page at 1440/1024/390px, actual 200%
Chrome zoom for all three, Framework at 4× CPU throttling, long names/identifiers,
full plots, local table keyboard scrolling, risk toggles, staging through keyboard,
failed catalogues/requests, empty availability and a pending request surviving
draft edits without leaking into a remounted route. Populated viewport runs have
no page errors. Native zoom measures outerWidth/innerWidth ≈ 2 and
visualViewport.scale = 1; captures use CDP rather than CSS-sized full-page clips.
Chart draw animations are disabled so returned series appear completely, and
axis text has explicit readable contrast.

API-reference/surface-inventory/production-mock/source/whitespace guards pass.
Review links and generated JSON resolve. Source comparison confirms no backend,
API client, model registry, solver or framework-engine change; tests retain valid
payloads and defaults. The source inventory still has 80 leaf render routes / 78
entry files, four shells and 27 redirects. Original 39 probes/screenshots remain
unchanged; direct entry source hints are not acceptance metrics.

Eighteen synthetic captures accompany this review. They show actual internal
scroll positions, not a claim that the whole workflow fits on one screen.
No live provider/model/private corpus, production DB, deployment or execution
was used; no host acceptance is implied.

| Workflow | Setup | Result / inspection | Native 200% |
|---|---|---|---|
| Framework | [1440px](evidence/research-framework-setup-1440.png), [390px](evidence/research-framework-setup-390.png) | [1440px plot](evidence/research-framework-results-1440.png), [1024px plot](evidence/research-framework-results-1024.png), [390px exact values](evidence/research-framework-inspection-390.png) | [View](evidence/research-framework-zoom.png) |
| Optimizer | [1440px](evidence/research-optimizer-setup-1440.png), [390px](evidence/research-optimizer-setup-390.png) | [1440px plot](evidence/research-optimizer-results-1440.png), [1024px plot](evidence/research-optimizer-results-1024.png), [390px exact values](evidence/research-optimizer-inspection-390.png) | [View](evidence/research-optimizer-zoom.png) |
| Governance | [1440px comparison](evidence/research-governance-comparison-1440.png) | [390px comparison](evidence/research-governance-comparison-390.png), [390px staging](evidence/research-governance-staging-390.png) | [View](evidence/research-governance-zoom.png) |

[Unavailable catalogue](evidence/research-unavailable.png) ·
[Failed run / retained draft](evidence/research-failed.png).
