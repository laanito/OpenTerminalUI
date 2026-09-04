# Product surface inventory

Audited **2026-09-03** against `main` at `444f3d3`, immediately after the v1
consolidation roadmap merged. This is the v1.4 decision record for what the fork
exposes. It is not a claim that every retained feature is equally mature.

## Classification contract

| State | Meaning |
|---|---|
| **supported** | Has a useful production contract in a normal installation; upstream failure may still degrade honestly |
| **configuration-gated** | Useful only for supported markets or after a documented provider/key is configured |
| **experimental** | Retained for evaluation, but not part of the stable v1 product promise yet |
| **hidden** | URL/API compatibility remains, but the surface is not advertised in primary navigation |
| **remove** | Verified to have no retained consumer or product purpose; delete with regression coverage |

An honest `empty + degraded` response satisfies the integrity invariant, but it
does not by itself make a feature useful enough for primary navigation.

## Snapshot

- FastAPI publishes **394 paths / 439 operations / 86 tag families**.
- The equity sidebar previously advertised 43 destinations. The current v1.4
  state retains 32 and hides 11 incomplete, unsafe-as-general-UI, or
  empty-data products.
- The repository contained 73 backend route modules, 112 frontend page
  files, and 31 parked Playwright specs. These counts describe audit scale, not
  release gates.

The machine-readable API-family classification is
[`docs/surface-inventory.json`](../surface-inventory.json). Validate it against
the generated OpenAPI schema with:

```bash
PYTHONPATH=. backend/.venv/bin/python scripts/check_surface_inventory.py
```

The primary navigation classification lives beside the UI in
`frontend/src/components/layout/navigation.ts` and is covered by a focused test.

## Primary navigation

The following retained destinations are **supported**:

| Area | Destinations |
|---|---|
| Market and research | Market, Security Hub, Forex, Rotation, Crypto, Compare, Screener, Heatmap, Dividends, News, ETF Analytics |
| Workspaces | Launchpad, Workstation, Multi-Timeframe Analysis |
| Private record | Portfolio, Paper, Position Sizer, Journal, Second Brain, Watchlist, Alerts |
| Risk, quant, and administration | Risk, Correlation, Statistical Lab, Pair Trading, Settings, About, Backtesting |

Configuration-gated destinations remain visible because they provide a useful
contract in a documented environment:

| Destination | Gate and retained behavior |
|---|---|
| Commodities | Live quotes require FMP; failures return explicit degraded data |
| Yield Curve | Live macro series require FRED; no fabricated curve is returned |
| DOM | Real depth exists for Binance crypto and configured India/Kite paths; unsupported US/EU equity depth remains empty and degraded |
| Economics | Live macro indicators require FRED; the calendar remains explicitly labelled sample data until a live forward-calendar source is selected |

No unresolved experimental destination remains in primary navigation. ETF
Analytics retains its keyless Yahoo holdings and overlap contract while marking
the unavailable flows panel degraded. Statistical Lab and Pair Trading are
stateless, keyless research computations over real historical prices. Model Lab
and Portfolio Lab remain available only as compatibility routes because their
saved definitions and runs are installation-wide rather than owner-scoped.

## Hidden compatibility surfaces

The routes remain addressable so bookmarks and integrations do not break during
the audit, but they are removed from primary navigation now:

| Surface | Decision | Re-enable condition |
|---|---|---|
| Bonds | **hidden** | Screening, spread history, and rating migrations receive a real provider; Yield Curve remains separately available |
| Hotlists | **hidden** | A provider supplies the volume/reference fields needed for genuine movers lists |
| Insider Activity | **hidden** | A production filing/provider ingestion path populates the existing owner-neutral query layer |
| Relative Strength | **hidden** | A real benchmark-relative computation and cached universe ranking replace all four empty endpoints; likely v2 work |
| Tape / Time & Sales | **hidden** | A production recent-trades adapter supplies actual prints; live tape embedded in supported depth flows is unaffected |
| Cockpit | **hidden** | The legacy summary becomes an authenticated, owner-scoped composition of the real portfolio, risk, event, news, and signal services |
| Plugins | **hidden** | A deliberate operator workflow and trust model exist for installing and running host Python extensions; lifecycle APIs remain admin-only |
| OMS | **hidden** | The internal simulator is either consolidated into Paper trading or gains an explicit broker/execution contract; its global restricted list remains admin-only |
| Ops | **hidden** | A deliberate administrator UI replaces the former fabricated operational console; the compatibility route now displays measured, read-only health only |
| Model Lab | **hidden** | Experiment definitions and runs become owner-scoped, with an explicit stable research contract |
| Portfolio Lab | **hidden** | Portfolio definitions, blends, and runs become owner-scoped instead of installation-wide |

The corresponding API families are classified `hidden`, not removed. Direct
route access continues to show an honest compatibility state. Cockpit's compatibility
endpoint now returns empty/null sections with explicit unavailable reasons; its
former sample AAPL position, P&L, risk metrics, and FOMC event were removed.
The Plugins URL is retained for local administrators, but it is not a marketplace:
the host operator installs trusted code and enable/disable/reload acts process-wide.
OMS records and audit results are now user-scoped, simulated fills are labelled,
and global restrictions and kill switches require an administrator. Direct Model
Lab and Portfolio Lab pages display an installation-wide data warning and are no
longer linked from Home, About, Portfolio, Backtesting, workspace presets, or
primary navigation.

## Retained partial surfaces

Some useful products contain a narrower missing-data feature. Hiding the entire
product would discard working behavior, so these remain visible with an explicit
boundary:

| Surface | Classification | Boundary |
|---|---|---|
| Economics | **configuration-gated** | Macro data can use FRED; the forward calendar is a labelled sample until a source is selected |
| ETF Analytics | **supported** | Holdings and overlap use real Yahoo data; fund flows still have no provider |
| Crypto derivatives | **supported** | Funding and open interest are real; liquidation totals stay degraded until the Binance force-order stream is wired |
| DOM | **configuration-gated** | Crypto and India have real paths; US/EU equity Level-2 requires a subscribed provider such as IBKR |
| Second Brain | **supported** | Retrieval works without synthesis; LLM output and embeddings depend on configured model capabilities |

## Secondary and compatibility routes

Routes not shown in the sidebar are classified by family:

| Route family | State | Notes |
|---|---|---|
| `/`, `/home`, authentication, account | **supported** | Core entry, authentication, and account lifecycle |
| Security detail, Launchpad popout, saved views | **supported** | Contextual destinations reached from retained workflows |
| Data Quality, Factors, Intelligence Timeline | **experimental** | Reachable through contextual links/commands while their stable placement is reviewed |
| Notes Hub | **supported** | Contextual capture UI; Second Brain remains the primary navigation entry |
| Bond Analytics and Option Greeks calculators | **experimental** | Calculators do not imply that the hidden live Bonds feed exists |
| F&O child routes | **configuration-gated** | India support is intentional; US option paths depend on available providers |
| Model/portfolio labs | **hidden** | Direct compatibility routes carry an installation-wide data warning; they are not stable or owner-scoped v1 products |
| Algorithm framework | **experimental** | Advanced research surface, not a stable v1 core contract |
| Legacy top-level redirects | **hidden** | Compatibility aliases into `/equity`, `/backtesting`, and portfolio-lab routes |

## Removed orphan surfaces

Static import/reachability inspection found four page implementations absent from
`App.tsx` and production imports:

- `frontend/src/pages/Home.tsx` (superseded by `HomePage.tsx`)
- `frontend/src/pages/Crypto.tsx` (superseded by `CryptoWorkspace.tsx`)
- `frontend/src/pages/Auth/LoginPage.tsx` (the app uses `pages/LoginPage.tsx`)
- `frontend/src/pages/BreakoutScanner.tsx` (test-only, with no registered route)

They were removed in the follow-up v1.4 cleanup. The breakout page's dedicated
test and four page-only presentation components were removed with it; scanner
APIs, shared types, alert infrastructure, and the registered Screener workflows
remain. The active frontend page count is now 108.

## API-family decisions

The checked-in registry classifies all 86 generated OpenAPI tags. The important
non-supported groups are:

- **Hidden:** `bonds`, `cockpit`, `hotlists`, `insider`, `model-lab`, `oms`,
  `ops`, `plugins`, `portfolio-lab`, `rs`, `tape`.
- **Configuration-gated:** `ai`, `ai-insights`, `commodities`, `depth`,
  `fixed-income`, `fno`, `fno-flow`, `fno-signals`, `kite`, `options`.
- **Experimental:** advanced governance/framework and portfolio-backtest APIs,
  data-quality, scripting, stock-picking/conviction, and currently untagged
  routes.

Everything else is classified supported at the family level. Mixed families
must still preserve endpoint-specific degraded markers; family classification
does not erase a narrower limitation.

### Duplicate-generation decisions

- Commodities and Forex keep their existing `/api/commodities/*` and
  `/api/forex/*` contracts through the equity router; identical second mounts
  were removed. The inventory guard now rejects duplicate OpenAPI operation IDs
  and redundant per-operation tags; Commodities now exposes its previously
  masked configuration-gated family explicitly.
- `/api/charts/volume-profile/{symbol}` is owned by the richer `chart` family
  implementation with provider routing, modes, caching, validation, and compute
  metadata. The shadowed implementation in the `charts` router was removed;
  other `chart`, `charts`, and `chart-workstation` endpoints remain distinct.
- Backtest generations remain intentionally supported: `/api/backtest/run` is
  the synchronous momentum-rotation contract, `/api/v1/backtest/*` is the active
  job/preset workflow, and `/api/backtests/*` supplies strategy comparison and
  advanced analytics. Duplicate frontend wrappers for the same v1 job calls
  were removed.
- Screener families remain intentional while all three are active consumers:
  the classic run/v2 scan, persisted `/api/v1/screener/*` runs and presets, and
  the revamped saved-screen/formula/export workflow. Consolidating their data
  models is later product work, not a safe v1 compatibility deletion.
- Top-level `/model-lab/*` and `/portfolio-lab/*` URLs are compatibility-only
  redirects. They preserve child paths, query strings, and hashes while routing
  into `/backtesting/model-lab/*` and `/equity/portfolio/lab/*`, respectively,
  so each hidden lab has one layout and route implementation.

## Remaining v1.4 sequence

1. Align `Limitations.md` and user-facing navigation/configuration copy with the
   final retained surface.

Do not turn provider acquisition, broad MCP, or cross-market feature development
into implicit v1.4 gates. Those belong to later generations unless required to
make a retained v1 surface truthful.
