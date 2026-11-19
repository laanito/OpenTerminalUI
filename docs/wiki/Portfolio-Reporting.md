# Consolidated Portfolio reporting

The unreleased v3 Portfolio screen starts with **consolidated positions across
all owned portfolios**, backed by the read-only reporting API. Expand an instrument
to inspect original portfolio lots or sell from a specific account. The top bar is the only portfolio scope selector, including while a single
account is selected. It also owns New portfolio and the selected account's settings;
there is no separate vertical portfolio list. Scope and reporting currency are
reflected in the URL and saved views; explicit direct-link scope wins over a
restored preference. Creating an account preserves the current scope.

**Record operation** is the primary Buy/Sell/cash entry. **Add existing position**
opens a separate non-cash dialog. Both require review before recording. Original lots use one dense table per expanded holding, with native cost/currency,
reporting values, dates, provenance, column/sort/CSV controls, sale and currency
repair actions. Position research remains available alongside those lots.

All movements is a single table, collapsed by default like Valuation method and
coverage. Its dated/native/rationale list is fetched only when opened, across the
selected accounts, with portfolio identity and reporting-currency cash deltas.
A failed account read shows an unavailable state instead of a partial list.

Sector allocation and holdings distribution by current value share space with
consolidated holdings. Both use complete current holdings value in the report's
currency and exclude cash. Unknown sectors stay labelled Unknown. Missing sector
coverage can hide only the sector pie while complete holdings distribution remains
available; incomplete or invalid holdings valuations hide both pies. No native
currency totals are added together or renormalized from incomplete known values.

Risk/AI/benchmark/correlation/dividend/attribution/events/backtesting are directly
below the collapsed movement/evidence rows when one account is selected. All-owned
scope explicitly asks for a single account for those methods; it does not select
a hidden primary account or invent consolidated risk. Showing analysis never
automatically generates AI prose. Mandate/settings and import/export are in the
top-bar Portfolio settings dialog, with currency repair on the affected lot or
movement. Custom persisted benchmarks remain visible in settings. The old parallel
Add holding form, duplicate account holdings table and per-holding pseudo-performance
line are removed.
New portfolios default to zero starting cash rather than a demonstration amount.

## Request and ownership

`GET /api/portfolios/report?reporting_currency=USD` uses the authenticated
user's bearer token and selects all their portfolios. It creates nothing when
the user has none. This is a browser-session/bearer API, not a new API-key route.

Repeat `portfolio_id` to select specific owned portfolios:

```text
/api/portfolios/report?reporting_currency=EUR&portfolio_id=<first-id>&portfolio_id=<second-id>
```

Duplicates are counted once; at most 100 explicit IDs are accepted. Any unknown,
empty or foreign ID returns the same 404 before requesting market data. There is
no fallback to the primary portfolio or substitution of another selection.

Reporting currency is required, uppercase, and independent of persisted portfolio
bases and global market controls. Supported codes are USD, EUR, GBP, JPY, CHF,
AUD, CAD and INR. Invalid or omitted reporting currency returns 422. The UI initially uses a supported display currency for all portfolios and the
configured base when selecting a single portfolio; the visible reporting control
can override it. Unsupported defaults require a choice. The API itself never
silently chooses a reporting currency.
The complete schema is in [OpenAPI](../openapi.json), browsable at `/docs` on a
running backend; the [API reference](../API_REFERENCE.md) indexes the endpoint.

## Valuation and coverage

Method: `native_dated_fx_by_portfolio_v1`.

- Each portfolio is calculated independently in the requested currency, starting
  from native holding costs, transaction amounts and fees. Ledgers are never
  pooled across accounts. Acquisition and transaction amounts retain dated FX;
  current marks use current FX. The report does not convert an already-computed
  P&L using today's rate.
- Starting cash is denominated in its portfolio's persisted currency. Foreign
  opening cash uses dated FX at the portfolio creation UTC date, exposed as
  `opening_cash.boundary_date` with method `portfolio_creation_boundary`. This
  is an explicit recording-boundary assumption, **not a verified deposit date**.
  Missing opening FX makes cash and net value incomplete, while independent
  holdings metrics can remain available.
- `as_of` is the retrieval/valuation check. It does not establish simultaneous
  quotes or certify live provider freshness. FX dates, source, cache/freshness
  and degraded reasons remain inspectable in each member's accounting evidence.
- Every metric has `value`, `known_value`, `complete_items`, `total_items`,
  `unit` and `status`. `value` is null unless all its contributors are available.
  `known_value` retains converted components and must never be presented as a
  complete total. Cost/market/unrealized coverage counts lots; cash, net value,
  realized P&L, fees and dividends count portfolios. A portfolio can contain known
  components while its full metric remains unavailable. Empty scope is a known
  zero with zero contributors, distinct from provider failure.
- Current market value can be known while cost/P&L is missing. A missing quote,
  currency, date or FX rate never becomes zero or parity. Degraded FX retains
  its disclosed value. Invalid/non-finite prices or rates are unavailable.

Cash and cost keep existing accounting semantics: dated base-value ledger
replay and its current weighted-average reconciliation. This API does not add a
multi-currency cash wallet, tax-lot engine, cash FX revaluation gain, consolidated
return series, aggregate risk calculation or AI interpretation.

## Position identity and original evidence

Positions combine **exact stored symbol + exchange + supported quote unit**.
The policy is labelled `exact_symbol_exchange_unit`; it does not claim to resolve
aliases or legal security identity. Exchange suffixes are preserved. BTC-USD and
BTC-EUR, or different listings of the same issuer, remain separate.

If exchange or supported quote unit is missing, each lot stays separate with
`identity_status=unresolved` and a reason. Provider unit casing is preserved:
`GBp` is not relabelled GBP, and its market value is unavailable until a supported
unit conversion exists.

Each position retains portfolio membership and original `holding_id`, `lot_id`,
quantity, purchase date, recorded unit cost/currency and notes. Original native
cost and its calculated reporting cost/method remain distinct: inherited ledger
replay may assign a reconciled average rather than historical per-lot tax cost.
Per-portfolio blocks preserve native transaction amounts/fees, row IDs, dated FX,
issues and opening cash evidence for inspection and repair.

The reporting endpoint itself writes no holdings, transactions, currencies or
opening balances. The operation workflow below adds separate write contracts.

## Reviewed operations and non-cash openings

`POST /api/portfolios/{id}/transactions` accepts an optional UUID `operation_id`.
The UI generates one per deliberate submission, freezes the reviewed target/body
on submission, blocks duplicate clicks and never automatically retries a failed
acknowledgement. A manual retry sends the same ID/body. A repeated ID returns the
original result; reuse for different data or a different portfolio returns 409.
`GET /api/portfolios/{id}/operations/{operation_id}` reconciles an uncertain
acknowledgement under the same ownership boundary. Pending IDs are held in the
active dialog; this does not add a durable browser outbox across reloads.

Server writes serialize on the owned portfolio row on PostgreSQL and reserve the
SQLite writer. Ownership, lot currency and available sell quantity are checked
before mutation; holdings and the ledger row commit together. A sale with a lot ID
cannot consume another lot. Otherwise lots are consumed oldest first (stable ID
tiebreak), while cost/P&L retains existing portfolio weighted-average accounting.
A selected UI sale discloses that distinction. Legacy holdings/repair/manage writes
share the same short lock. No provider/model request holds it.

An existing position is a distinct ledger type `opening`, **not a buy or cash
transaction**. It moves no cash/fees, creates a new lot, and records:

- Observation date in `date` and the lot's `purchase_date`: when the security is
  recorded as present in this portfolio. It does not establish earlier account
  ownership, even if acquired earlier.
- Documented unit cost/currency in `price`/`currency`, and an original
  `opening.acquisition_date` and `opening.provenance`. Dated cost FX uses that
  documented acquisition date. `opening.basis_status` defaults to `known` for
  compatibility and requires cost, currency and acquisition date. Choose **Cost
  basis unknown** (`basis_status: "unknown"`, explicit `price: null`, `currency:
  null`) when those records are missing; acquisition date may then be null.
  Provenance is always required. Unknown is stored as SQL NULL, never a zero
  substitute. An explicitly documented zero basis remains allowed.
- Optional total fair value and currency at entry in `opening.contribution_value`
  and `opening.contribution_currency`. This is independent of acquisition cost.
  In-window history counts that value as a capital contribution in kind, not
  investment profit. Missing contribution value/FX makes the affected history
  unavailable with an explicit issue; no zero flow or guessed cost value is used.
- Operation rationale in transaction notes. It does not silently become a position
  thesis, replace the portfolio mandate or create a Journal entry. Existing Brain
  transaction-note indexing remains intact.

`opening` metadata and an idempotent request fingerprint are retained in nullable
`portfolio_transactions.operation_data`. Activity exposes that audit metadata;
consolidated lots also expose opening provenance. Partial/full sales preserve
recorded cost; cash and ledger history recognize openings together.

Upgrade applies Alembic **0021_portfolio_operations** and
**0022_unknown_opening_basis** before startup:
Docker performs Alembic automatically; existing local installations run
`PYTHONPATH=. alembic -c backend/alembic.ini upgrade head` in their configured
backend environment. 0021 adds nullable receipt metadata; 0022 relaxes the
holding unit-cost and transaction-price columns to permit explicit unknowns.
Existing amounts, quantities, currencies, lot constraints and foreign keys are
preserved. PostgreSQL drops NOT NULL without rewriting rows; SQLite uses a batch
copy of the two child tables. Downgrade retains nullable columns and evidence;
it never converts unknown cost to zero. No historical buy is reinterpreted. Older application code cannot interpret
new opening events correctly; deployments containing them need a compatible
rollback build or a forward fix, rather than writing with pre-opening code.


## Unknown basis and evidence repair

Unknown acquisition cost does not hide independently known current market value,
cash, sale proceeds, fees or capital-flow valuation. Cost and unrealized P&L remain
unavailable for the affected weighted-average symbol pool within that portfolio;
known native lot amounts are still inspectable. A sale involving that pool has
unknown realized P&L, rather than treating the sale proceeds as profit. No sales
means realized P&L is zero. Fully closing the pool permits a later documented buy
to establish a new current basis, while past unknown realized P&L stays unknown
until its opening evidence is repaired. Accounting remains weighted-average by
symbol, not a tax-lot method. Accounts never share basis pools.

**Opening evidence** is available on an original lot and on its opening row in
**All movements**, including after full disposal. The dialog shows the fixed
quantity and observation date; review can replace basis, acquisition date,
provenance and/or independent entry contribution value, with a required repair
reason. Earlier revisions are collapsed by default. Generic legacy currency
repair cannot bypass this audit for an opening.

Authenticated bearer routes (same owner checks as Portfolio writes):

- `GET /api/portfolios/{portfolio_id}/transactions/{transaction_id}/opening-evidence`
  returns current evidence, revision, prior snapshots and applied repair IDs.
- `PATCH` on the same path requires a stable UUID `repair_id`, `expected_revision`,
  `price`, `currency`, complete `opening` metadata and a nonblank `reason`.
  Same ID/body replay returns the original successful revision; changed reuse or
  a stale revision returns 409. Reload before reviewing a changed revision.
  Foreign/non-opening receipts return 404. No provider runs under the write lock.

A repair appends audit metadata and atomically updates the opening transaction's
basis and any remaining lot's documented unit cost. It changes no quantity,
observation date, cash, fees or movement count. A fully sold receipt remains
repairable and recalculates realized P&L. If later buys were explicitly merged
into that exact lot, basis changes return 409 pending reconciliation; entry-value
or provenance-only repairs remain possible. No mixed lot basis is overwritten.
Original operation retries retain their original fingerprint and cannot undo a
later evidence repair. Uncertain writes offer manual same-repair retry or a
result check, with no automatic resubmission.

Missing in-window contribution valuation still makes the affected historical
curve unavailable. Repairing that value restores reconstruction when other inputs
are complete, without turning fair value into acquisition cost. Reconstruction
uses current corrected ledger evidence; this is not a retained historical vintage.
The legacy NAV/starting-cash annualized-return shortcut is unavailable when opening,
deposit or withdrawal flows exist. Compatibility stress/factor methods that still
require cost weights return an explicit unavailable response for unknown basis;
price-history, symbol-only and current-value consumers can remain available.
Position/report exports retain null costs rather than printing a false zero.


## Keyboard and inspection

Open the portfolio chooser or a holding with Enter/Space; Escape closes the
chooser or an idle dialog and returns focus. Original-lot and activity grids have
specific accessible names. Focus the grid and use Arrow keys, Home/End or Page
Up/Down to select and reveal a row; Tab reaches its native controls. Keys inside
inputs/selects/buttons retain their normal behavior. Confirmed operation/repair
saves announce the result near the main actions when refresh removes the old lot.

Column options close with Escape and return focus. Resize separators support
Left/Right (Shift for larger steps). **Show Hidden** reveals optional evidence,
including provenance, acquisition dates and recorded position research; the choice
is retained with the table's order/width preferences. CSV exports the visible
columns and full values, including long research text. Narrow displays retain
local horizontal table scrolling; summaries and allocation legends wrap/scroll
without hiding required controls. See the [v3 acceptance report](../design/v3/ACCEPTANCE.md).
