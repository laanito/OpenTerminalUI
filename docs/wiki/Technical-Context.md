# Technical context for comparison briefings

v2.5 is planned as a bounded technical-evidence addition to the existing
comparison briefing. The first implementation slice exposes **inputs only**;
new indicators, technical briefing selection and browser inspection follow.
Existing comparison returns and descriptive technical panels keep their behavior.

## Source audit and supported input contract

The comparison fetcher can return Yahoo charts directly or normalize an adapter's
rows into a chart-shaped payload. The normalized path previously retained quote
units and adjusted values but dropped interval/timezone metadata and used the
last adjusted value at a duplicated timestamp. An adapter can also omit rows
before the comparison sees them. Reconstructed arrays alone therefore cannot
establish source integrity.

For the new contract the fetcher preserves a bounded private copy of original
Yahoo timestamps, closes, adjusted closes and selected metadata before that
conversion. No extra provider request is made. The existing normalized chart
and primary price-comparison calculations remain unchanged. The source copy
does not retain arbitrary metadata, URLs, keys or unrelated provider fields.

`POST /api/market-context/compare` adds `technical_inputs.anchor` and
`technical_inputs.comparison` to each pair. The version is
`yahoo-adjusted-own-dates-v1`. Each asset is assessed independently.

| Contract | Behavior |
|---|---|
| Supported feed | Explicit `yahoo_chart` provenance; an adapter name alone, Alpaca raw bars or FMP history does not qualify. |
| Required metadata | Matching source symbol, daily interval, supported reported instrument type, quote unit and valid exchange timezone. |
| Price input | Original finite positive provider close and Yahoo-reported `adjclose` for every selected source observation. Never replace missing adjusted values with raw closes. |
| Sampling | Each asset's own UTC dates inside the exact existing pair window. Crypto weekends are retained, not sampled down to equity overlap. |
| Integrity | Array lengths must match; duplicate UTC source dates, invalid selected values and differences between original and selected rows withhold the entire asset input. No partial adjusted series or interpolation. |
| Calendar coverage | Crypto requires every calendar date in the selected window. Equity/ETF/index inputs are observed dates; missing exchange sessions are not independently assessed. |
| Dates and freshness | Exact window, observation count, extra dates versus the pair, UTC/local date-shift count and current/stale state are exposed. The freshness threshold matches the existing seven-calendar-day disclosure, not exchange-session certification. Future observations are withheld. |
| Identity | Stable opaque `input_id` covers contract, provider/feed, selected metadata, pair window and exact dated input values. Freshness changes alone do not change the observation identity. |
| Limits | At most 1,000 original source rows are captured; the existing maximum six-month pair window bounds each returned series to 181 UTC dates. |

An `available` input means that this **observed-data contract** passed. Its
`adjustment_verification` is still `not_independently_verified`,
`session_verification` is `not_performed`, and `bar_completion` is `not_verified`.
The contract does not certify split/dividend methodology, daily bar completion,
exchange-calendar completeness, historical vintages or decision-grade signals.
The endpoint carries no claim that the fields were known to investors then.

Unavailable inputs have a reason code, no points and no identity. Examples are
`unsupported_or_unknown_feed`, `daily_interval_unconfirmed`,
`incomplete_source_arrays`, `duplicate_utc_date`, `invalid_or_missing_close`,
`selected_rows_differ_from_source` and `missing_crypto_dates`. A failed pair
reports `pair_unavailable`. Source defects can withhold one technical leg while
the original price comparison remains available.

## Delivery boundary

No technical inputs enter comparison model prompts in this slice. The existing
briefing projection still explicitly excludes technical measures; changing the
new inputs does not change its evidence packet. The server/API contract is the
foundation for deterministic indicators and a later explicit, default-off
technical selection with inspectable citations. No database or embedding change
is introduced. See [Roadmap](Roadmap.md) for the bounded v2.5 exit criteria.
