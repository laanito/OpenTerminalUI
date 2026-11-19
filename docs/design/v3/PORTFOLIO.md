# Portfolio workflow and accounting proposal

Status: accepted v3.0 design contract. The HTML study is not a backend implementation.
Read-only reporting, its default consolidated screen and reviewed operations
with documented-basis non-cash openings are implemented; see the
[reporting/operations contract](../../wiki/Portfolio-Reporting.md). Unknown-basis
receipt accounting and the complete secondary-section/acceptance work remain
upcoming. Existing ownership, accounting,
dated FX, ledger history and evidence contracts remain authoritative. Discovery
changes no production schema/data.

## Information hierarchy

```text
Portfolio
  Scope: All owned portfolios | one portfolio     [Record operation]
  Reporting currency / valuation time / coverage
  Net value | positions | cash | unrealized P&L
  Positions  Activity  Research  Analytics  Manage
    Instrument → portfolios → original lots → operation
```

Start at all owned portfolios for a first visit, then preserve the user's explicit
scope in the URL/saved-view contract. A direct portfolio link wins over a prior
preference. Do not silently select the first portfolio or change scope when a new
portfolio is created. The selector floats over the content and collapses fully;
its closed control always names the scope. Narrow views expose the same choices.
Creating a portfolio is a deliberate action in the selector/Manage area.

**Positions:** one row per compatible instrument identity, with quantity,
native quote/currency, reporting value, unrealized P&L and portfolio membership.
Open it to see portfolio contributions and original lots, including cost/date/
currency/provenance and repair controls. On narrow views, show summary cards
with the same detail access; keep the complete dense table available on demand.

**Activity:** authoritative recorded buys/sells, deposit/withdrawal/dividend cash
movements and distinctly labelled non-cash opening receipts. Show dates,
quantities, native amounts/fees, target portfolio, rationale and accounting status.
Keep existing export and legacy currency repair reachable.

**Research:** optional portfolio mandate/constraints, current position research
and operation rationale have distinct labels/identities. Existing Notes and
Second Brain indexing are preserved, not reset or duplicated by moving fields.
A new rationale stored with a transaction does not silently replace a position
thesis or create a Journal entry. Journal owns later strategy/emotion/outcome
review; quantity-aware execution matching remains a separate backlog item.

**Analytics:** retain access to risk metrics, AI assessment with explicit technical
scope, correlation, dividends, attribution, benchmark overlays, events and
backtesting. Show their existing methods and evidence. New all-portfolios value
aggregation does not create consolidated historic returns, aggregate risk or
value-weighted AI interpretations. Until supported, ask for a single portfolio
instead of manufacturing an aggregate.

**Manage:** portfolio create/edit/delete, mandate/benchmark/base settings, existing
import/export and repair workflows. These actions leave the initial reading
path but are not removed. CSV import that creates buys must say so; never
silently change an old import's cash semantics to a no-cash receipt.

## Consolidation rules

1. Aggregate only the authenticated owner's explicitly selected portfolios.
   Preserve the ID, membership and original lot identities behind every row.
2. Use a canonical instrument/market/quote-unit identity. Do not merge aliases
   by stripping exchange suffixes or combine BTC-USD and BTC-EUR automatically.
   When identity or units cannot be established, keep rows separate and explain.
3. A single portfolio defaults to its configured base currency. All portfolios
   use an explicit reporting currency (proposed initial default: the user's
   display currency, visibly labelled and independently selectable; if unavailable,
   require a valid explicit choice). Changing
   reporting currency must request correct accounting, not relabel existing sums.
4. Compute consolidated value, cash, cost and P&L from their underlying
   native/cost/fee amounts and dated FX evidence in the requested reporting
   currency. Do not add USD and EUR totals, or convert previously calculated
   P&L using one current FX rate. Preserve dates and existing conversion methods.
5. Unknown quote, basis or FX coverage does not become zero. Current market value
   can be known while cost/P&L remain unknown. Expose coverage per metric; retain
   labelled known components without presenting them as a complete total.
6. An all-portfolios trade needs a specific target portfolio; a sale also needs
   owned available quantity and a disclosed lot allocation. There is no implicit
   sale across accounts or silent short position.
7. The prototype's pre-valued USD fixtures illustrate the hierarchy only. They
   are not a consolidation algorithm or proof that a new API already exists.

## Record operation: review before commit

The primary flow opens with Buy/Sell, plus a clearly separate existing-position
entry. Deposit, withdrawal and dividend remain accessible in the operation menu;
the study only illustrates the first three paths. New fields are labelled,
keyboard-accessible and retain user input on validation/provider errors.

| Flow | Required meaning | Review must show |
|---|---|---|
| Buy | One actual acquisition, target portfolio, instrument, positive quantity/unit price, operation date, price currency, explicit fees/currency, optional rationale. | New/selected lot, native trade cash outflow and fee cash legs, any FX gap, target and resulting quantity. |
| Sell | Actual disposal in a specific owned portfolio; sufficient quantity; selected lots or disclosed deterministic allocation. | Quantity available/sold, allocation, native proceeds and fees, remaining quantity and any unknown realised-cost result. |
| Existing position / external receipt | Securities were already owned or received into the tracked portfolio; establish a position without inventing a buy or cash deposit. | As-of date, quantity, documented or unknown basis, original acquisition date if known, provenance and separate performance-flow valuation. |
| Deposit / withdrawal / dividend | Preserve existing cash-ledger semantics and currency/fee evidence. | Native cash effect and target portfolio; never mislabel as security performance. |

Production submission must validate again server-side and commit the execution/
receipt, holdings and cash consequences atomically. Reject insufficient quantity
before any partial write. Preserve fractional shares, currency validation,
negative/zero input rules and ownership checks. Disclose current deterministic
lot ordering; this is position accounting, not a new tax-lot engine.

Give each deliberate submission a stable operation identity/idempotency contract.
Double-clicks or uncertain acknowledgements must not create duplicate ledger rows.
Keep a saving state and recover an uncertain result by looking it up, not blindly
replaying it. Changing scope must not retarget an in-flight operation. Validate
these requirements against current transaction APIs during the backend slice;
the discovery PR does not claim they are already present.

## Non-cash receipt: minimum domain work before UI shipping

Today's holding endpoint writes a `buy`, and the transaction schema has no
receipt type. A new auditable ledger event and compatible accounting are needed.
The existing position/cost representation also needs an explicit unknown-basis
contract; use a nullable/typed unknown, not a known zero disguised as missing.

- Record quantity, instrument, owning portfolio, date the position is known to be
  present, source/provenance and the original acquisition date if documented.
  Acquisition date and recording/as-of date are distinct; unknown dates stay
  unknown. A receipt dated today does not prove historical ownership last year.
- Record documented cost and its currency separately from the position's current
  market value and any fair-value contribution at entry. Unknown cost can leave
  a fully valued position with unavailable cost-dependent P&L.
- A receipt moves **no cash**, but may be an **external capital contribution in
  kind** for return calculations. Record its dated fair value/currency and FX
  evidence independently of acquisition cost. Missing contribution valuation
  makes affected historical returns partial/unavailable; it is not a zero flow
  or investment profit. Do not use the cost basis as a guessed market value.
- Opening balances define a documented observation boundary. Do not backfill
  invented earlier trades/dividends or cash from an acquisition date alone.
  Keep v2.8 ledger reconstruction's legacy estimates explicitly distinct from
  new recorded receipts. Stored legacy lots/transactions remain unchanged.
- New event semantics must reach cash, holdings, realised/unrealised accounting,
  daily history, reports/export and relevant consumers together. Verify unknown
  basis and subsequent partial/full sales. Do not ship a UI-only receipt that
  causes another ledger/holdings mismatch later.
- Paired internal transfers/transfer-out workflows and cross-account performance
  elimination are **not** added in v3.0. Label this flow existing/opening position
  or external receipt; do not advertise a complete transfer engine. Later internal
  transfers require linked source/destination events and no double capital flow.

Review an additive, rollback-preserving PostgreSQL/SQLite migration/API plan in
the backend implementation slice. Preserve old rows and compatibility clients;
no automatic reinterpretation of old buys, bulk rewriting of portfolio history,
production DB operation or schema proposal is executed in this design PR.

## History and interpretation

Remove the current Portfolio `perfSeries` presentation: array-indexed
per-holding returns are not a historical comparison. Reuse appropriately dated
existing history where its method matches, or show an explicit unavailable state.
Keep reconstructed ledger performance separate from current-open-basket risk and
benchmark analytics. Every chart names method, currency, window and coverage.

AI Risk Assessment remains an explicit action with its selected holdings and
technical evidence scope, Deep identity, cancellation and failure semantics.
Moving it to Analytics must not auto-run a model or index its prose into Brain.
Saved Brain memos and comparison captures retain their existing identities and
source navigation; this is a frontend generation, not a research-memory rewrite.
