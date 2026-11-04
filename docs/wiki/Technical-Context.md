# Technical context for comparison briefings

v2.5.0 was published on 2026-11-02 from `fad1c95` after implementation PRs
#242–#245, release-prep PR #246 and explicit maintainer authorization.
The bounded technical-evidence addition includes eligible inputs, deterministic
indicators, explicit briefing selection, reference validation and browser
inspection. Maintainer host acceptance, consolidated local checks and all three
release-prep CI jobs passed. Existing comparison returns and descriptive
technical panels keep their behavior.

## v2.6 standalone snapshot foundation (in development)

`backend/services/technical_snapshots.py` adds an internal, reusable collector
for a single instrument. It creates no comparison pair, public route, AI prompt,
database record or embedding. The foundation merged as #251; existing v2.5
comparison outputs and source/observation identities retain their contract.

`TechnicalSnapshotRequest` normalises a bounded symbol, fixes the interval at
daily, and selects 1–181 calendar dates (90 by default). One provenance-aware
history call requests `3mo` or `6mo`; collection defaults to 15 seconds, is capped
at 45 seconds, and propagates caller cancellation. It adds no fallback query or
internal cache. Existing fetcher fallback remains identifiable by its actual
returned source/feed; unsupported feeds remain unavailable.

The snapshot separates the requested UTC date window from actual observed
start/end dates. Selection uses original source timestamps, so a bad or dropped
edge row cannot silently shorten the integrity check. Crypto weekends and
continuity remain explicit. All selected observations must have valid original
and adjusted closes matching the selected history. No partial adjusted input,
raw-close substitution, padding or shortened indicator period is allowed.
Source/selected-row parsing remains bounded to 1,000 rows; the requested window
bounds returned points to 181. Provider errors/timeouts expose safe reason codes
without copying provider exceptions, URLs or unrelated source metadata.

`yahoo-adjusted-instrument-window-v1` inputs use
`own_utc_dates_within_instrument_window` sampling. The existing
`technical-indicators-v1` formulas and 20/21-close warm-up are shared with the
pair calculator. Input/observation identities bind exact source values and
conventions; `ts_` snapshot identity additionally binds request and coverage.
Retrieval time is explicit and excluded from the content identity. Staleness is
still the seven-calendar-day disclosure, not audited exchange sessions.

`history_semantics: current_source_history_not_point_in_time` prevents confusing
this retrieval with a historical knowledge capture. Adjustment methods,
sessions and bar completion remain unverified. A short history can produce
partial metrics; missing/inconsistent source input produces unavailable values.

Later v3 technical thesis validation may use RSI/MACD, volume, accumulation areas
and Elliott-wave hypotheses to challenge claims in ingested videos/notes. This
snapshot foundation supplies traceable daily evidence; it does not implement
those methods or equate its three measures with full technical analysis. See
[the roadmap direction](Roadmap.md#v3-direction--technical-thesis-validation-deferred).

## Instrument research consumers (v2.6 development)

AI Investment Briefing and Interrogate now use the collector for the requested
stock/index/coin when generation is enabled. Technical preparation, including
lazy fetcher startup, has a 15-second optional budget within the existing
60-second preparation allowance. Failure/timeout yields unavailable technical
coverage while preserving the original facts, news and owner-scoped notes.

`research_technical_context.py` rechecks the snapshot's calculations against its
inputs and projects exact metric values/identities, quality metadata and the
union of actually used dates (at most 21 supporting closes). `TECH1`/`TECH2`/
`TECH3` references are local to the generated answer and map to the existing
three measures. Available evidence requires at least one usable metric reference
in the analysis; invented/unavailable references enter the same selected-model,
bounded stream-fallback/completion-repair lifecycle. These are reference checks,
not semantic fact-checks or a full technical verdict.

The additive `technical_context` companion is available on existing research
GET/stream results and inspectable from the browser cards. Disabled generation
skips the fetch. Cache keys add the technical contract and current UTC date;
profile and Interrogate owner/note-version scope remain intact. Regenerate
refreshes both evidence and analysis. Source retrieval time remains explicit.
Same-symbol note effective/recorded dates are supplied separately without
changing semantic related-note queries, embeddings or indexing. This instrument
consumer slice merged as #252; host quality feedback is still pending.

## Second Brain technical context (v2.6 development)

Brain offers an explicit, default-empty technical scope of at most three unique
symbols. It does not infer tickers from question text or change private-source
selection, ranking, embeddings or indexing. With generation enabled, explicit
technical selection collects history even when private retrieval has no matches,
the index is empty or query embeddings fail. The private gap is supplied to the
model, with failed search distinguished from missing notes. The browser labels
answers without private citations and the limits on long-term investment use.
Disabled generation or a preparation timeout reports a skipped scope with a
reason. Older saved skipped scopes retain their original meaning. A 15-second batch bounds at most three concurrent
collectors, including provider startup, inside Brain's existing preparation
allowance. Cancellation cancels and joins the children. Partial and unavailable
asset coverage remain visible beside usable private evidence.

`POST /api/brain/ask` and `/ask/stream` accept `technical_symbols`, for example
`["AAPL", "BTC-USD"]`. Their additive typed `technical_context` contains selected
symbols, coverage/reason and per-asset research projections. References are
local to the answer: `T1.1`–`T1.3` for the first asset, `T2.1`–`T2.3` for the
second, distinct from private `[1]` citations. Stable snapshot/input/observation
IDs are preserved. Successful technical synthesis must cite a private source
when private citations are supplied, and at least one available metric for each usable asset; unknown and
unavailable references fail validation. These checks locate evidence, not prove
the interpretation. Current observations cannot alone reject a dated historical
description or a long-term thesis, and do not establish past investor knowledge.
When no private citation and no usable technical metric is available, a complete
retrieval-only result retains coverage and explains the evidence gap without
asking the model for an ungrounded synthesis. Omitting technical symbols retains
the existing private-only retrieval behaviour.

The frozen Deep/default profile and its existing deadlines remain. Stream text
is provisional; reference failure uses the existing same-profile completion
fallback with safe correction. Non-streaming synthesis permits one reference
repair. Failed completion replaces provisional prose with private sources and
captured coverage. A validated technical stream finishes with a full `result`
and completion timestamp; legacy nontechnical success retains `done`. The browser
checks selected scope, metadata, references and unchanged captured evidence
between synthesis start and final result, without replaying inference.

An explicit Brain Log save retains the full context as captured, including at
most 21 supporting closes per asset. It is immutable alongside the answer.
Reopening or rechecking a memo only compares private source identities and never
refreshes those market observations. Reviewed **Promote to Note** drafts include
dated capture/source/value/ID footnotes and relabel local references as
`(captured T1.1)` so future retrieval cannot confuse them with a new snapshot.
The user still reviews and confirms the separate Note; transient evidence and
saved memos are not automatically indexed.

Existing databases need Alembic revision `0018_brain_technical_context`, adding
one nullable portable JSON column to `brain_memos`, with no default/backfill or
old-row rewrite. Docker's entrypoint runs the upgrade before app startup; local
existing databases use `PYTHONPATH=. alembic -c backend/alembic.ini upgrade head`.
Rollback retains the column and captured research; older code ignores it.
Portfolio integration is described below.

## Portfolio AI Risk Assessment (v2.6 development)

The selected portfolio's risk card offers a default-empty scope of up to three
explicitly selected positive-quantity held symbols. This does not rank holdings
by exposure or silently choose a proxy. Existing supplied risk observations
remain separate from server-owned position metadata and technical history.
If portfolio risk metrics are missing, selecting held symbols still permits
generation with the evidence limits visible.

Both `POST /api/ai/risk-insights` and the shared stream's `risk` payload accept
optional `portfolio_id` and `technical_symbols`. The server verifies the actual
portfolio owner and current membership before any market/model work. Foreign
and absent portfolios both return 404; unheld symbols return 422. Selected lots
are aggregated into recorded quantities, lot counts and known/unknown cost
currencies. No position market values, value weights, FX conversion or technical
risk contributions are computed. Supplied risk observations are explicitly
client-provided, not independently reverified by this operation. The typed input
has a 32,000-character JSON limit instead of silently slicing JSON at 2,000.

The additive `portfolio_technical_context` contains portfolio/selected-symbol
identity, total held-symbol count, selected positions and up to three research
projections. `H1.1`–`H3.3` references are local to each selected asset. At least
one available metric per usable asset must be cited; invented/unavailable refs
use the same Deep/default stream/completion repair and deadline. The browser
validates requested portfolio, selected symbols, positions, exact evidence and
references. Coverage counts symbols, not portfolio value; unselected holdings
have no technical evidence in the packet. Single-asset volatility must never
be interpreted as portfolio volatility, diversification, covariance or tail risk.
Those claims require their own supplied portfolio evidence and joint history.

Selected history shares the cancellable 15s batch used by Brain, with at most
three concurrent collectors. Each Generate/Regenerate collects fresh snapshots;
there is no insight cache added. Disabled generation does not fetch history.
Unavailable/short/stale history keeps its source limits and other supplied risk
inputs. Model failure retains the captured context. Selection, holdings,
portfolio or supplied-metric changes cancel/clear the old browser result; late
background analytics from a previous portfolio cannot overwrite the new scope.
There is no save/indexing action or schema migration for this consumer.

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
the existing typed failure rather than silently dropping inputs.

## Browser workflow (v2.5 development)

1. Open **Cross-market context**, apply an anchor/proxies/window, then find
   **Comparison briefing → Briefing evidence scope**.
2. Check **Technical observations** (off by default), alone or with dated news
   and macro. Selecting a checkbox does not call the model. Choose **Generate
   briefing** to fetch a fresh, explicitly scoped snapshot and request synthesis.
3. Choose a technical citation in the answer or a coverage link. The evidence
   disclosure opens and focuses that exact section, asset or metric. Inspect
   value/unit, formula, history requirements, own-date window, source/freshness,
   quality limitations and stable input/observation IDs. Expand the exact dates
   and supporting adjusted-close table when needed.

Partial history remains visible: 20 closes allow the mean gap but not the
21-close return/volatility calculations. Unsupported or missing source inputs
can leave prices available while technical observations remain unavailable;
there is no replacement provider fetch or invented zero. The initial technical
source contract is Yahoo-specific, even when other feeds supply valid prices.

Changing any scope checkbox clears the old answer and cancels running work.
Selection changes/unmount and the existing Cancel action retain that behavior;
generation and retries are explicit. Repeated citation clicks refocus the target.
The same evidence layout supports desktop and narrow screens.

Before display, the client validates selected scope, source/pair identities,
calculation version/conventions, finite values, metric history/dates and exact
supporting rows, unavailable states and reference/coverage obligations. It
does not recalculate indicators or establish adjustment quality, bar completion,
source truth, semantic fidelity or causal mechanisms. Model prose remains plain
text and reference validation retains the v2.4 limits.
