# Risk: scoped review, readable values and captured stress runs

Continues merged #319/#320. Their pre-existing Portfolio Income finding remains
on v5's functionality track. Risk receives a dedicated overview/factors/stress
pass before Correlation, Stat Lab and Pair Trading. Dedicated work now covers 32
render entries, including 25 of the 32 tools and three shell-menu extras. Eight
ordinary menu destinations remain. Risk host acceptance and wider v3 acceptance
are open; this is not release preparation.

## Reading and scope

- Compact wrapping view navigation leads to the active task. The page has its
  own labelled overview scope and explicit ticker draft/apply form; unsubmitted
  text cannot rename results. Shared ticker changes still initialize that scope.
  Factor attribution and history have a labelled period selector, distinct from
  the exposure endpoint's fixed 1Y context. Stress always uses `current` holdings.
- Summary metrics, PCA and reported classification/matrix values precede the
  disclosed exposure preview, on-demand AI interpretation and model-method detail.
  Full classification names live in HTML, replacing clipped SVG labels. Missing
  metrics/matrix cells remain unavailable; literal numeric zero stays visible.
- The retained right rail explicitly names its independent shared-ticker scope,
  rather than appearing to follow the page's local ticker/portfolio selection.
  PCA fields have readable values instead of object-to-string output. Existing
  rail query keys, endpoints, cadence and stored preferences remain unchanged.
- Factor loadings/style and attribution have full-width exact value tables.
  Unavailable size/value does not create a neutral style position. Incomplete
  attribution cannot fabricate a complete waterfall. Accessible checkboxes replace
  mouse-only legend toggles; rolling values remain available for keyboard review.
- Numerical tables have named focusable local scrollers, row/column headers and
  sticky header rows. Contribution lists have a compact height; other long tables
  stay bounded. Charts use themed tick contrast and zero-anchored numeric bar axes.
  Primary labels and axes
  are at least 12px; values/control text use readable sizes. Narrow layouts stack
  at useful widths instead of compressing labels. No source/view classifications,
  navigation destinations, dependencies or saved formats change.

## Reads and run outcomes

Overview and factor reads fail/retry independently. Scope/retry generations and
unmount guards ignore old completions; old values are cleared while loading or
after failure. A failed PCA read does not hide a successful summary/matrix. AI
remains opt-in, requires usable loaded summary/correlation scope and resets when
that scope is refreshed. It does not inherit factor values from a different view.
The existing insight transport, configured model and backend validation remain.

Stress has one compact scenario selector, full descriptions in a disclosed library
and the six retained custom sliders. Percentage/basis-point conversions, ranges,
defaults, payload fields and the fan-band calculation remain. Setup is captured
at submission and locked while scenario/simulation requests settle; duplicate
submissions are guarded. Switching setup afterward cannot relabel captured results.
No scenario or simulation runs automatically.

Scenario and portfolio Monte Carlo outcomes are independent. A completed scenario
survives a simulation or history-read failure; history refresh cannot be overwritten
by an older pending read. A failed scenario response is labelled unconfirmed and
suggests refreshing history before another run, rather than automatically replaying
the recorded operation. Failed simulation percentiles never become assumed zeros.
The Monte Carlo model is explicitly independent of the selected shocks, and fan
bands derive from the returned path sample. Exact holding, sector, worst-holding,
path-band and history values remain inspectable. No real financial actions occur.

## Existing source limits for v5

This is a presentation/state pass, not financial correctness certification. Source
review found equal weighting, simplified beta and positional history alignment;
missing history can return zero summary sentinels. The `sectors` response actually
groups country metadata and symbol counts. The UI calls it reported classification
share rather than market-value sector allocation.

Factor model proxies/shared engine state and calibration require verification.
The retained confidence whiskers are a client heuristic, not statistical bounds;
the market snapshot sums daily factor returns rather than compounding. Existing
valid numerical transforms remain; missing data is not silently filled to zero.

Stress uses stored purchase costs as current values and inferred sectors, without
established currency conversion. Its FX shock retains the legacy INR factor.
Audit model/price/shock calibration, current-portfolio resolution, and process-local
global run-history durability/ownership: the existing authenticated history route
does not filter rows by user. These are source findings for v5, not observations
from a production account, a verified live diagnosis or a backend repair in v3.

## Validation and synthetic evidence

Eight focused unit cases cover missing/zero, independent failed reads, explicit
scope application and late responses, missing style/attribution, captured payload
units, duplicate protection/locked setup, independent simulation/history failure,
ambiguous scenario responses and invalidating old history reads after confirmation.
Six Chrome journeys exercise every view at 1440/1024/390px, 4× desktop CPU, partial
factor data, late ticker/period reads, keyboard sliders/toggles/local scrolling,
failed reads/retained drafts, captured runs and actual 200% Chrome browser zoom.
Bounds use a batched DOM snapshot, preserving the normal CI timeout/throttle.

All 919 frontend tests / 152 files and all 177 installed-Chrome smoke journeys
pass. After final axis/table/rail presentation adjustments, eight focused unit
cases, all six Risk browser journeys and production build pass again. API-reference,
surface-inventory, production-mock, source-artifact and whitespace guards pass.
Review links/source JSON and retained fan-band, custom-default, slider-range and
unit-conversion helpers are checked. The final journeys also verify vertical
keyboard scrolling through a larger contribution list and the independent rail
scope, plus a visible zero endpoint on negative-impact bar axes.
Browser APIs and sockets are intercepted with synthetic fixtures; no live provider,
model, private corpus, production database or deployment is accessed. No backend,
API/schema, dependency or stored-format change. The unchanged backend suite is
not rerun. Current source artifacts are regenerated; the original 39 baseline
browser probes and captures remain unchanged.

| View | Desktop | Mobile |
|---|---|---|
| Overview | [1440px](evidence/risk-overview-1440.png) | [390px](evidence/risk-overview-390.png) |
| Loadings and style | [1440px](evidence/risk-factor-loadings-1440.png) | [390px](evidence/risk-factor-loadings-390.png) |
| Rolling values | [1440px](evidence/risk-factors-1440.png) | [390px](evidence/risk-factors-390.png) |
| Custom setup | [1440px](evidence/risk-setup-1440.png) | [390px](evidence/risk-setup-390.png) |
| Captured impact | [1440px](evidence/risk-impact-1440.png) | [390px](evidence/risk-impact-390.png) |
| Independent simulation/history | [1440px](evidence/risk-results-1440.png) | [390px](evidence/risk-results-390.png) |

[Native 200% Chrome zoom](evidence/risk-native-zoom.png). Images show the scrolling
workspace viewport at the reviewed section. Lower rows/local overflow are verified
by interaction, not claimed to fit on one screen. Chrome's native surface is
captured through CDP so CSS-sized screenshot clipping does not crop the zoom proof.
