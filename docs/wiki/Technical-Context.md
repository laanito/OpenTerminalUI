# Technical context for comparison briefings

v2.5 is in development as a bounded technical-evidence addition to the existing
comparison briefing. Inputs and deterministic indicators are now exposed through
the comparison API. Explicit technical selection and reference validation now
also work through the context-briefing API; browser controls/inspection follow.
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

## Deterministic observations

Each pair also exposes `technical_indicators.anchor` and `.comparison`, using
calculation version `technical-indicators-v1`. Calculations consume only the
validated technical input's Yahoo-reported adjusted closes, in ascending own-date
order, inside the existing pair window. They do not fetch earlier warm-up history,
shorten a lookback, interpolate, substitute raw prices or discard crypto weekends.

| Metric | Formula/convention | Required history |
|---|---|---|
| `sma20_gap_pct` | `100 * (latest adjusted close / arithmetic mean of last 20 adjusted closes - 1)`, percent | 20 closes |
| `return20_pct` | `100 * (latest adjusted close / adjusted close 20 observations earlier - 1)`, percent | 21 closes |
| `volatility20_pp` | Sample standard deviation of the last 20 simple returns `p[i]/p[i-1]-1`, multiplied by 100; divisor 19 (`ddof=1`), percentage points | 21 closes |

Volatility is **unannualized**; no equity/crypto annualization factors are mixed.
Twenty equity observations may span a different calendar interval from twenty
crypto observations. These are observed-close measures, not verified trading-day
indicators or claims about future performance. The existing drawdown and older
provider-close/shared-date technical panels are not replaced or redefined.

Every metric supplies its formula, unit, lookback, required/used close counts,
exact observation dates and window, finite value rounded to eight decimal places,
and a stable `observation_id` bound to the input identity, calculation version and
result. The parent repeats source/feed, price basis, sampling, freshness and the
unverified adjustment/session/bar-completion dimensions. Changing input history
changes observation identity even if the most recent calculated value stays equal.

Metric status is independently available/unavailable. Insufficient history yields
`insufficient_history`, with no value, used dates or observation identity. Thus
20 closes produce a partial set with a valid mean gap but unavailable return and
volatility; fewer than 20 produce an unavailable set. An unavailable source yields
`input_unavailable` for every metric while retaining its source reason on the
parent. Inconsistent internal input metadata and non-finite arithmetic are also
withheld. Valid zero values remain available. The asset set is available only
when all three metrics are available, partial for one/two, otherwise unavailable.

## Delivery boundary

The **price-only** briefing projection still excludes technical measures;
changing inputs/indicators does not change that nested packet. Technical context
is included only when explicitly selected on the context endpoints below. No
database or embedding change is introduced. See [Roadmap](Roadmap.md) for the
bounded v2.5 exit criteria.

## Opt-in technical briefing evidence

`POST /api/market-context/briefing-context-evidence` accepts, for example:

```json
{
  "anchor": "AAPL",
  "comparisons": ["BTC-USD"],
  "period": "1M",
  "context": {"news": false, "macro_regions": [], "technical": true}
}
```

The same selection is accepted by `/api/market-context/briefing-context` and
`/api/market-context/briefing-context/stream` for Deep synthesis. `technical`
defaults to false; technical-only context is valid, as is combination with news
and US/euro-area macro. No browser-supplied values or snapshots are accepted.

Price and technical facts come from **one fresh comparison snapshot**, within
the existing 45-second price preparation budget. Technical projection adds no
history fetch or external provider job. Selected news/macro retain their own
bounded collection; failure there does not discard valid technical evidence.

Each selected pair gets a `kind: technical` section, with two asset groups and
their three metrics. Section IDs remain packet-local `C#`; asset IDs are `C#A1`
or `C#A2`, and metric IDs are `C#A#T1`–`T3`. The returned asset contains source
identity, calculation version, exact values/units/formulas/dates, quality flags,
reported instrument type/timezone and local-date shift count, history/status/reasons,
and at most 21 supporting adjusted-close points. Source
symbols, windows and provider identities must agree with the price snapshot;
metrics are recomputed and compared before projection. Mismatches yield an
unavailable technical section without replacing price evidence. The outer packet
fingerprint covers selection, technical facts, coverage, caveats and failures.

Only available metric IDs are usable interpretation anchors; valid zero values
qualify. Every such citation must include its linked `P#`. Sections, asset
groups, unavailable metrics, unrelated pairs and invented IDs cannot stand in
for a usable metric. Each asset with usable technical data must contribute at
least one metric citation in possible context or a hypothesis. Limitations must
cite selected sections and asset groups; unavailable metrics remain known for
limitations/unknowns, never usable as observations. Price observations retain
their existing price-only reference rules.

The model is instructed to interpret supplied values conditionally, preserve
own-date/freshness/adjustment/session/bar-completion limitations and distinguish
adjusted technical lookbacks from native shared-date returns. It must not invent
indicators, thresholds, trading signals or causal certainty. Structural/reference
checks and one bounded repair do not certify numeric prose or reasoning quality.

The existing Deep profile, operation budgets, no-replay streaming, cancellation
cleanup and 120,000-character context input cap remain. All four selected context
types can produce up to 24 sections across six pairs; oversized evidence returns
the existing typed failure rather than silently dropping inputs. Frontend
selection, strict technical-envelope validation and citation inspection are the
next slice; the current browser cannot yet request this new technical scope.
