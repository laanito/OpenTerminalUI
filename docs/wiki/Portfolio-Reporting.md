# Consolidated Portfolio reporting

The unreleased v3 foundation adds a **read-only API** for current positions in
one or more owned portfolios. The Portfolio screen still uses its existing
single-portfolio workflow; the consolidated UI follows the receipt/operation
accounting work. Existing endpoints and stored portfolios are unchanged.

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
AUD, CAD and INR. Invalid or omitted reporting currency returns 422. A future UI
may choose an explicit initial currency, but the API never silently chooses one.
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

This endpoint writes no holdings, transactions, currencies or opening balances.
There is no migration or automatic reinterpretation of legacy transactions.
