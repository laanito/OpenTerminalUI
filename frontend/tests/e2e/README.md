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
Backtesting submit/poll/result journey. Because those requests are fully
intercepted, the smoke command runs the built frontend without starting backend
jobs or contacting upstream providers.

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
| CI smoke | `auth-smoke`, `critical-shell-smoke`, `backtesting-tabs` | Keep deterministic and small. |
| Mocked journey candidates | `alerts-v2`, `chart-workstation`, `correlation-dashboard`, `custom-formula-screener`, `factor-attribution`, `fno-option-chain`, `hotkey-trading`, `market-heatmap`, `model-lab-flow`, `notification-center`, `options-flow`, `portfolio-lab-flow`, `position-sizer`, `risk-oms-ops`, `screener-scanner`, `stress-test`, `time-and-sales`, `trade-journal`, `workspace-templates` | Reconcile fixtures and assertions with current contracts, then promote valuable journeys individually. |
| Provider/live-data dependent | `dom-ladder`, `insider-activity`, `multi-timeframe`, `pair-trading-lab`, `statlab-v2-tabs`, `terminal-shell-go-bar` | Replace upstream dependencies and pre-v1 defaults with explicit fixtures before gating. |
| Mobile-only | `mobile-interactions` and the mobile case in `terminal-shell-go-bar` | Run only in the scoped `mobile-chromium` project; update fixtures before promotion. |
| Visual capture | `screenshots` | Keep manual; it produces review artifacts rather than pass/fail product contracts. |

The full suite remains runnable for focused cleanup. A failure there can expose
a real regression, but first check whether the fixture still assumes India-first,
synthetic, or live-provider behavior removed during the v1 integrity work.
