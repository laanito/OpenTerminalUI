# Browser test suites

The root `playwright.config.ts` is the single Playwright configuration. Run it
from the repository root with the frontend package scripts:

```bash
npm run test:e2e:smoke --prefix frontend
npm run test:e2e --prefix frontend
```

## Regular CI smoke set

Tests containing `@smoke` run in Chromium on every pull request and push to
`main`. They must use seeded authentication, intercept any data-provider calls,
and cover only stable, release-critical behavior. The set covers the login
surface, authenticated shell/navigation/GO-bar routing, and a fixture-backed
Backtesting submit/poll/result journey, and desktop/narrow-screen comparison
briefing generation, citation inspection, failed retry and selection invalidation.
It also checks crypto stock-detail snapshot/chart routing with mocked quote ticks.
Brain technical journeys at desktop/narrow widths cover explicit symbol scope,
per-asset metric inspection, captured Brain Log saves/reopening, private-only
evidence rechecks, reviewed promotion and partial/unavailable history. They use
the same backend-produced projections as the frontend protocol tests.
Portfolio risk journeys also cover explicit held-symbol selection, exact
per-holding inspection, partial/unavailable history, retained evidence after
model failure and clearing on portfolio/scope changes at desktop/narrow widths.
Filing comparison journeys cover opt-in SEC facts, exact citation focus,
concepts/units/fiscal periods versus filing/retrieval dates, withheld conflicts,
missing configuration, model-failure evidence retention and malformed-reference
rejection at desktop/narrow widths. Their serialized fixtures come from server
projections; regenerate/check with
`PYTHONPATH=. backend/.venv/bin/python -m backend.tests.generate_filing_briefing_fixture [--check]`
from the repository root. These are deterministic protocol/UI checks, not live
SEC access or model-quality benchmarks.
Because those requests are fully
intercepted, the smoke command runs the built frontend without starting backend
jobs or contacting upstream providers.

### Use an installed browser locally

The runner supports `PLAYWRIGHT_EXECUTABLE_PATH` when a compatible Chrome is
already installed. On the maintainer's macOS workstation:

```bash
PLAYWRIGHT_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:e2e:smoke --prefix frontend
```

Playwright starts an isolated temporary profile for this run. A separate
bundled Chromium download is unnecessary with this option. CI continues to
install and test Playwright's bundled Chromium. The workstation's Chrome CDP
endpoint on port 9222 is also available for interactive checks; the smoke
command above uses the executable override.

Authentication state is written directly by `global-setup.ts` with a stable test
identity and bounded token lifetime. Backend-backed full-suite runs get a
process-scoped SQLite database, so stale records from an earlier run cannot
affect them.

## Existing journey classification

The remaining suite is retained for rehabilitation and is not part of the
regular gate yet. Classification describes how a test should be treated, not
whether its product surface is supported.

| Class | Specs | Next action |
|---|---|---|
| CI smoke | `auth-smoke`, `critical-shell-smoke`, `backtesting-tabs`, `comparison-briefing`, `crypto-stock-detail` | Keep deterministic and small. |
| Mocked journey candidates | `alerts-v2`, `chart-workstation`, `correlation-dashboard`, `custom-formula-screener`, `factor-attribution`, `fno-option-chain`, `hotkey-trading`, `market-heatmap`, `model-lab-flow`, `notification-center`, `options-flow`, `portfolio-lab-flow`, `position-sizer`, `risk-oms-ops`, `screener-scanner`, `stress-test`, `time-and-sales`, `trade-journal`, `workspace-templates` | Reconcile fixtures and assertions with current contracts, then promote valuable journeys individually. |
| Provider/live-data dependent | `dom-ladder`, `insider-activity`, `multi-timeframe`, `pair-trading-lab`, `statlab-v2-tabs`, `terminal-shell-go-bar` | Replace upstream dependencies and pre-v1 defaults with explicit fixtures before gating. |
| Mobile-only | `mobile-interactions` and the mobile case in `terminal-shell-go-bar` | Run only in the scoped `mobile-chromium` project; update fixtures before promotion. |
| Visual capture | `screenshots` | Keep manual; it produces review artifacts rather than pass/fail product contracts. |

The full suite remains runnable for focused cleanup. A failure there can expose
a real regression, but first check whether the fixture still assumes India-first,
synthetic, or live-provider behavior removed during the v1 integrity work.
