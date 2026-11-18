# External-agent project context

Current work **2026-11-18: v3 discovery/design proposal**. The maintainer
confirmed post-release app docs #285 and bilingual blog chapter 24 (`praderasblog`
#121) merged, then authorized discovery/design for v3. v2 close-out is complete.
This branch adds `docs/design/v3/`: a synthetic Chrome audit of nine initial
routes at 1440/1024/390, Portfolio before/after screenshots, an isolated interactive
HTML study, workflow/accounting boundaries and proposed release acceptance.
Production components/APIs/accounting/schemas remain unchanged; version stays 2.8.0.

Proposed v3.0 gate: shared responsive frontend foundation + complete Portfolio
pilot. Other page redesigns are later v3.x scope proposals. Review `SCOPE.md`
and the study before implementation; do not treat the HTML as shipped APIs.
All-portfolios consolidation needs reporting-currency/identity/coverage contracts.
Existing-position/external receipt entry needs audited non-cash ledger semantics,
unknown cost basis and separate in-kind capital-flow valuation for performance;
no fake buy/deposit/profit. Full internal transfer and Journal matching stay later.

Observed baseline issues include clipped shell controls despite a viewport-width
root document, holdings below the initial viewport (y=958/1503/1908), fixed/stacked
portfolio management forms and the source-confirmed array-indexed per-holding
“Performance vs Benchmark” curve. Keep contained table/ticker scrolling distinct
from defects. Initial unasked/empty research states are not a full generated-
evidence audit; the pack explicitly records fixture limits and follow-up cases.

Validation: 27 fixture-only initial views with no captured JS runtime errors;
prototype overview/scope/lot drill-down, buy review, oversell rejection,
unknown-basis receipt, separate native fee cash legs, partial/empty/error states,
section navigation and native-dialog keyboard containment/Escape/focus return
pass at 1440/1024/390. Source/app regression suites are not rerun for a docs-only
study; production migration must preserve populated research/evidence journeys.
No private data, backend, database, provider or model calls used. Scripts block
external traffic and writes. Deployment remains with the host agent.

Published **2026-11-18: v2.8.0 — Durable news and sentiment evidence**.
Implementation through retention/deletion PR #283 is merged at `0e7a383`.
The maintainer confirmed merge; carry forward earlier accepted portfolio/BTC
fixes without requesting duplicate tests. Backend/frontend/lock/OpenAPI and
README/site labels align to 2.8.0. Release-prep PR #284 passed build-and-test,
clean-install and postgres-contract and merged at `61599bc`. The maintainer
explicitly authorized tagging/publication. The annotated tag and public,
non-prerelease GitHub release were published and verified on 2026-11-18.
Remote v2.8.0 resolves to `61599bcc510f38661757dbd419d4b502f5303f88`; do not move it.
No v2.8 release gate remains; the approved v2 feature scope is closed.
Deployment stays with the host agent; do not monitor CI unless requested.

The milestone saves bounded comparison evidence/results and actual model inputs;
reopen is offline, rerun freezes inputs with current Deep, refresh collects new
sources. Both follow-ups retain separate lineage. Selected exact headline text,
independent keyword tone/Fast asset implication, scoring/cache provenance and
failed methods are durable. Selected retained observations inform a new checked
Deep run with frozen market context. No automatic Brain indexing or calibrated
whole-market sentiment claim. Notes, Brain and public legacy news retain their
existing lifecycle.

Upgrade adds additive Alembic `0019_news_evidence` and
`0020_comparison_captures`. Docker upgrades before startup; existing local
installations must upgrade their configured database. Downgrades preserve research
tables; a disposable SQLite full-chain upgrade/downgrade to 0018/re-upgrade passed.
No production database was accessed. No dependency, provider, indicator or
embedding change. Guarded PostgreSQL and clean-install CI passed in #284; this
does not claim a production deployment by the coding agent.

The agreed unreferenced evidence default is 90 days from latest recording;
`NEWS_EVIDENCE_RETENTION_DAYS=0` disables expiry. Compose forwards it; restart
backend after changing it. Saved runs never automatically expire and protect
references until the final retaining run is deleted, without resetting age.
Owner bundle DELETE gives 404 for unknown/foreign IDs, 409 for references.
Cleanup is daily, bounded to 100 bundles and delayed one interval after startup.
Short owner locks serialize writes/deletion (PostgreSQL READ COMMITTED/SQLite
writer reservation); no model call holds the lock. Mid-generation source removal
produces a known unsaved outcome. Conservative JSON matching can overretain and
scales with owner history. No lifecycle migration/backfill is needed.

Post-bump `make gate` passed compilation, API/surface/mock guards, 1,914 backend
tests (three PostgreSQL-only skipped; 78.49% coverage), production build and all
830 frontend tests/133 files. All 39 installed-Chrome smoke journeys passed.
Compose configuration, both generated fixture checks and version consistency
passed. Local Python 3.12.16/Node 26.7.0 checks differ from CI Python 3.11/Node 22.
See `docs/wiki/Releasing.md`. v3 remains the
Portfolio-first frontend overhaul after v2 close-out. Do not start another v2
feature minor. Post-release docs #285 and bilingual chapter 24 (blog #121) are merged per
maintainer confirmation. v3 discovery is authorized; production migration has
not started. Deployment stays with the host agent.

This directory is the repository-owned handoff for AI coding agents and new
maintainers. Read it before making changes. It records decisions that may have
previously existed only in a maintainer's chat or local agent memory.

Previous published baseline **2026-11-09:** **v2.7.0 — Filing-grounded comparison briefings**
is published from `4bc03cf`, the merge of release-prep PR #263. Implementation
PRs #259–#262 are merged; the maintainer explicitly confirmed #262 as merged
and tested. Carry that acceptance forward. Backend/frontend/lock/OpenAPI and
public version labels align to 2.7.0. Post-bump `make gate` passed compilation,
API/surface/mock guards, 1,739 backend tests (one skipped; 77.54% coverage),
production build and 730 frontend tests. All 26 post-bump installed-Chrome smoke
journeys passed with one worker. Compose, fixture parity and version consistency
checks passed. Local Python 3.12.16 / Node 26.7.0 are distinct from CI's supported
Python 3.11 / Node 22 and disposable PostgreSQL/fresh-stack lanes. Release-prep
#263 passed build-and-test, clean-install and postgres-contract, then merged.
Following explicit maintainer authorization, the annotated tag and public,
non-prerelease GitHub release were published and verified on 2026-11-09. The
remote tag resolves to `4bc03cfd71febaa87169c62b977e739b6197aaaf`; do not move it.
No v2.7 release gate remains. See `docs/wiki/Releasing.md`.

The bounded SEC aggregate, exact concept/unit/duration grouping, full-set conflict
checks, per-symbol collection, version-2 references, checked Deep synthesis and
opt-in browser inspection are complete. Current aggregates do not establish
historical investor knowledge, revision order or exact filing corroboration.
No migration, provider, setting, dependency, persistence or embedding change.
Deployment stays with the host agent. Finish the approved v2 scope first;
v3 now targets the UX/frontend overhaul,
beginning with Portfolio. Broader technical validation remains a later theme.

Previous published baseline **2026-11-05:** **v2.6.0 — Technical context across AI research**
is published from `fccb6b3`, the merge of release-prep PR #256. The maintainer
explicitly authorized publication after merge. The annotated tag and public,
non-prerelease GitHub release were created and verified on 2026-11-05. All three
release-prep CI jobs passed: build-and-test, clean-install and postgres-contract.
No v2.6 release gate remains. Deployment belongs to the host agent.

Implementation PRs #248–#255 delivered the same three deterministic daily
observations to Investment Briefing, Interrogate, optional Brain symbol scope
and selected portfolio holdings. Exact values/own dates/source IDs and missing
coverage remain inspectable. No new indicator, provider, dependency or embedding
change. Current revised history is not historical investor knowledge, and
reference validation does not certify reasoning or source quality. Preserve the
maintainer's #254 Brain-fix and #255 Portfolio acceptance; do not request duplicate
tests for those resolved paths. Release approval is not a numerical latency or
independent model/source benchmark.

Consolidated post-bump `make gate` passed compilation, API/surface/mock guards,
**1,667 backend tests** (one skipped; **77.29% coverage**), production build and
**681 frontend tests**. All **24 installed-Chrome smoke journeys** passed with
one worker. Compose configuration and backend/frontend/lock/OpenAPI/public-label
version consistency passed. Local Python 3.12.16 / Node 26.7.0 checks are distinct
from CI's successful Python 3.11 / Node 22, fresh-stack and disposable PostgreSQL
lanes. Fixtures establish contracts, not live inference quality.

Upgrade includes nullable JSON migration `0018_brain_technical_context`, with
no default/backfill or old-row rewrite. Docker applies Alembic before startup;
existing local DBs must upgrade. A disposable SQLite full-chain check verified
legacy memo preservation, NULL preservation, rollback retention and re-upgrade.
No production DB was used locally. Saved Brain snapshots remain captured; private
citation rechecks do not refresh market data. Only reviewed promotion creates an
indexed Note. Private ranking/embeddings are unchanged. Missing private matches
or risk metrics do not block explicitly selected technical evidence; Brain skips
synthesis if neither private nor technical evidence is usable.

Portfolio technical scope explicitly selects up to three current held symbols.
Ownership/membership precede market/model work. Recorded quantities/cost currencies
and symbol-count coverage do not establish value weights or aggregate risk.
Per-holding H#.# references inspect the same three observations; shared 15s batch,
Deep/default deadlines and cancellation preserve failures. Scope changes clear
old output, and late prior-portfolio analytics are ignored.

Post-release documentation #257 and bilingual chapter 22, “The question we
almost lost” (`praderasblog` #119), are merged. The changelog records Nov 5
publication separately from Nov 4 preparation without moving the tag.
Blog deployment belongs to the host agent.

The latest completed milestone is **v2.7 — Filing-grounded fundamentals in comparison
briefings**, beginning with a coverage/revision audit and a bounded interpretation
contract. The SEC projection/audit (#259), collection (#260) and checked
synthesis (#261) are merged. The browser now offers opt-in SEC filing facts
with strict version-2 validation, exact citation focus, original concepts/units,
fiscal/filing/retrieval dates, disclosure links and conflict/gap states. Scope
changes abort and discard late work. Existing Deep routing, bounded repair and
deadlines apply; failed models retain validated evidence. Unselected context
retains version 1. Shared server-generated fixtures have a repository-owned
regeneration/check command. The maintainer confirmed #262 as merged and tested;
release/publication is complete. Post-release docs #264 and bilingual chapter 23
(`praderasblog` #120) are merged; host publication remains outside this repo.

Sequencing decision (2026-11-14): finish the currently approved v2 work/release
first; v3 is the UX/frontend overhaul before further feature expansion. Portfolio
is the first concrete workstream. Do not start v3 or expand v2 from optional
backlog items. See Roadmap for the operation/non-cash-entry and thesis boundaries.
Ollama 0.35+ local System One models are an evaluation candidate for sentiment,
not an adopted provider, verified runtime or new release gate.

The next proposed increment is **v2.8 — Durable news and sentiment evidence**.
On 2026-11-11 the maintainer required durability for news/sentiment references
so analyses remain inspectable/repeatable. Plan immutable text snapshots,
versioned method/model/context-linked assessments and complete captured analysis
inputs/results, with replay distinct from re-run or refresh. Saved analyses pin
referenced evidence; unreferenced retention is configurable with the agreed
90-day default (2026-11-17). Preserve owner boundaries and PostgreSQL/SQLite safety.
The first storage foundation now adds owner-scoped exact-text snapshots and
append-only assessments, with additive migration `0019_news_evidence`. News/scoring
routes are not wired to those tables yet; no cleanup runs. PR #266 is merged.
PR #267 is merged and adds explicit JWT comparison capture/list/reopen/delete APIs
with self-contained evidence, public generation identity and exact dispatched
model inputs (including format/token retries and repair), plus additive
`0020_comparison_captures`. Merged PR #270 adds browser **Generate and save
briefing**, paginated owner history, original citation/input inspection and
confirmed deletion. Temporary generation remains explicit. Saved review uses
original scope/dates and fetches no market data or inference. A new JWT-only
`/briefing-captures/stream` uses the shared lifecycle and returns a receipt only
after commit; ambiguous acknowledgement is recovered by refreshing saved history,
never by automatic inference retry. Current source/model work cancels on scope
changes; late save/list/detail responses are ignored. List SQL projects summary
and selection JSON rather than full input envelopes (SQLite/PostgreSQL portable).
No new migration, provider, settings, dependency or API-key scope. Capture JSON
remains self-contained; scoring/text-assessment linkage and unreferenced
retention duration/cleanup remain open.
Read `docs/wiki/News-Evidence-Contract.md` for precise boundaries. Locally 310
focused backend tests passed (three PostgreSQL-only checks skipped), all 756
frontend tests passed (127 files), production build and API/surface/mock guards
passed, and all 29 installed-Chrome smoke journeys passed with one worker. The
new saved-review desktop/narrow journeys also passed after the final pagination
refresh adjustment. Native PostgreSQL JSON/list execution remains in its guarded
CI lane. The maintainer confirmed #270 and roadmap #271 merged. Carry the
accepted BTC fix forward; no repeat chart testing is requested.

The next implemented v2.8 slice adds JWT-only owner follow-up streams:
`/briefing-captures/{id}/rerun/stream` and `/{id}/refresh/stream`, both strict empty
JSON bodies. Rerun preserves the last actual request (including a saved repair),
changes only `model` to current Deep and makes one checked completion; no source
fetch, prompt augmentation, repair or format/token fallback. Refresh uses the
saved selection with current sources/prompts/settings. Both create separate,
self-contained children with parent ID/hash/generation time/request index JSON
lineage, preserving the original. Deleted-source children remain inspectable and
rerunnable. Reruns preserve raw evidence extensions and scope; disabled/health
failures retain a prepared request with empty honest dispatch attempts. Original
no-request captures can refresh only. Integrity/ownership/supported-input checks
precede streaming. Browser controls show progress, cancel, lineage and source
navigation; uncertain acknowledgement is recovered via saved history, without
automatic retry. No schema/config/provider/dependency/API-key changes. Local
verification: 325 focused backend tests passed, three PostgreSQL-only skipped;
766 frontend tests/127 files, build and API/surface/mock guards passed. Installed
Chrome full smoke suite passes all 31 journeys, including desktop/narrow follow-ups.
The maintainer confirmed PR #272 merged. Sentiment browser/Deep linkage and the
unreferenced retention policy remain open.

The next v2.8 slice implements explicit durable selected-headline scoring APIs:
`POST /api/market-context/briefing-captures/{id}/sentiment` selects up to ten
saved headline IDs with their news-group target symbols. Reads use GET on that
path (paginated) or `GET /api/news/evidence/{snapshot_id}`. Ownership, source
integrity and target/reference checks precede scoring; no live text/URL fetch or
browser replacement text is accepted. Exact repeated source/target observations
across selected pair copies retain all local citations and score once. Each call
creates new text and assessment UUIDs, atomically using existing tables.
Independent keyword tone (`finance-keyword-tone-v1`) and Fast asset implication
(`saved-headline-asset-v1`) are retained; the former is not a fallback model
verdict. Model failure/missing/invalid output stays failed without a neutral or
baseline replacement. Full batch/target/schema/version/owner/profile cache
identity and actual dispatched bodies preserve original scoring times and inputs
on cache hits; new recording/capture times remain distinct. Cache TTL is 15min,
not evidence expiry. Cache I/O is bounded at 2s and failures do not lose results.
No hidden FinBERT/TextBlob chain, Deep escalation, decision-model provider,
confidence invention, legacy-score promotion, migration or old-row rewrite.
New optional JSON origin/generation/cache flags preserve older records.
Saved reads return raw original payloads, and retained text/assessments survive
source-capture deletion. API-key scopes stay unchanged; routes are experimental.
The synchronous scoring request can finish after a client disconnect; inspect
retained records before manually retrying an uncertain reply. Server-task
cancellation leaves no partial rows; storage failure rolls the whole batch back.
Locally 370 focused research/scoring tests and 57 legacy news/auth tests passed;
three actual PostgreSQL checks skipped and remain in the guarded CI lane. That
lane now checks nested origin JSON filtering and owner-only retained reads.
Generated API reference, surface inventory (487 operations/87 families), mock
and whitespace guards pass. This slice changes no frontend behavior: browser
sentiment selection/review/progress, checked Deep reference integration and
reference-aware retention/cleanup remained subsequent work at that slice. The
maintainer confirmed PR #273 merged. Do not infer release acceptance.

The next implemented v2.8 slice exposes **Headline sentiment** inside Market
Context's **Review saved briefings**. Open a news-containing saved run, select up
to ten explicit headline references/targets and **Assess and retain selected
headlines**. Browser validation checks returned text, dates, source identity,
original hash, targets, full selection coverage and deduplication before showing
receipts. Keyword tone renders as positive/negative/neutral independently from
Fast asset implication; failed models have no score/neutral verdict. Original
scoring and recording times, cache reuse, exact source/truncation metadata,
public method/model identity and escaped saved batch inputs remain inspectable.
No model runs on opening, paging or inspecting retained records. Parent saved-run
mutation controls are disabled during scoring, while close/scope changes cancel
unfinished work and ignore late results.

New JWT `/{capture_id}/sentiment/stream` shares synchronous scoring/storage and
the existing cancellable lifecycle, current Fast budget and post-commit list
receipt. Preflight ownership/hash/reference validation happens before headers.
Source collection and Deep synthesis do not run. A commit completed before
cancellation is not undone; refresh retained history before manually retrying
uncertain completion. No automatic model retry. New JWT `GET /api/news/evidence`
provides owner-only paginated history, including observations from deleted source
captures. **Review retained headline assessments** works with no saved run open;
when one is open, an optional all-history filter widens the default source scope.
Deleting a source explicitly preserves independent headline assessments.
No schema/settings/provider/dependency/API-key changes. The guarded PostgreSQL
contract now checks global owner-history reads as well as source-filtered reads.

Local verification: 373 focused backend tests passed; three PostgreSQL-only
checks skipped. All 795 frontend tests/129 files, production build, all 33
installed-Chrome smoke journeys, generated API check, surface inventory
(489 operations/87 families), production-data and whitespace guards pass. The
new desktop/narrow journeys cover explicit selection, exact inputs, reload,
cache labels, failed models, deleted-source discovery and overflow. A child
Homebrew Node failed to load a missing simdutf library during the initial browser
attempt; rerunning with existing `/Users/lamigo/.hermes/node/bin` first in the
process PATH passed. No host runtime or repo test configuration was changed.
The maintainer confirmed PR #274 merged and tested. Carry that acceptance
forward. The implemented Deep follow-up is described below; reference-aware
retention/deletion/cleanup is implemented in the current branch described above.

Current v2.8 increment (2026-11-17): checked Deep interpretation of explicitly
selected retained sentiment is implemented. In original saved-news review, open
retained assessments, select one to five observations (one version per headline/
target), then **Interpret selected sentiment and save**. This is JWT-only
`POST /api/market-context/briefing-captures/{id}/sentiment-briefing/stream`, accepting
only snapshot IDs. Preflight checks owner/source integrity, original observation
ID/hash/text/source/dates/truncation, methods/targets and deduplication. Reject
unsupported saved evidence extensions instead of silently dropping them.

The current resolved Deep profile uses frozen original market context and dated
retained methods; no market/source fetch or Fast rescore. Context envelope v3 adds
packet-local R# references, paired to exact original headlines/P#; unselected v1/2
shapes/hashes are preserved. Completed methods require contextual consideration;
all selected methods require limitations coverage. Failed/fallback opinions are
unavailable, never neutral evidence. Keep tone and asset implication independent,
scoring/publication/retrieval/capture times distinct, cache provenance intact and
repeated pair copies from becoming independent reports. Reference checks are not
semantic fact checking or calibrated market-sentiment evidence.

The separate child has `retained_sentiment_interpretation` lineage and complete
`sentiment_sources` copies, including original scoring requests. Deep's projection
omits bulky scoring request bodies, while offline inspection retains them. Shared
stream lifecycle, deadline and bounded repair apply. Only a committed receipt
claims saving; cancellation/ambiguous acknowledgement requires history review,
not automatic retry. Source/assessment records stay unchanged. A child can reopen
and rerun after its parent/independent rows disappear; saved-input reruns keep the
opinions, while fresh refreshes omit them and collect new context. No migration,
provider, setting, dependency or API-key changes. Capture/input byte limits remain.

Validation: all 1,898 backend tests pass (three PostgreSQL-only skipped locally),
all 825 frontend tests/132 files, production build and all 37 installed-Chrome
smoke journeys pass. The guarded PostgreSQL lane now checks nested retained
sentiment inputs, new lineage summaries and owner-only reads; native execution
belongs to that CI lane. Shared deterministic fixture regeneration/check uses
`python -m backend.tests.generate_sentiment_briefing_fixture` (PYTHONPATH=. and
backend/.venv). API generation/surface inventory (491 operations/87 families),
production-data and whitespace guards pass. An earlier full coverage run caught
fixture regeneration during execution; the subsequent full test run is clean.

The maintainer confirmed #282 merged. Retention/deletion/cleanup is now
implemented as described in the current handoff above; the earlier slice notes
record intermediate states. Release review/preparation remains. #281's portfolio
UX is merged and accepted; do not request duplicate reconstruction testing.

Home history UX follow-up: the maintainer confirmed #280 works and requested
less verbosity. Legacy explanations, excluded transaction IDs/quantities and
opening adjustments now live in one collapsed “Legacy data adjusted for this
estimate · Details” disclosure. Keep active input failures and non-legacy/FX
warnings visible. Calculation and API payloads are unchanged. Validation: 24
focused frontend tests, production build and both Home browser widths pass,
including default-hidden details and expansion/collapse. Preserve the maintainer's
functional acceptance; do not request duplicate reconstruction testing.

Legacy opening inventory follow-up (2026-11-16): #279 is merged/deployed,
but excluding unmatched old sales exposed remaining quantity differences from
unrecorded development-era adds/removes. For legacy symbols only (an excluded
pre-window sale or a current holding with a purchase date before the window),
reconstruct opening shares as today's shares minus recorded net in-window trades.
Keep every in-window trade, and show `opening_position_adjustments` with original
ledger shares, estimated shares, signed delta and boundary date in the API/Home.
These are non-cash assumptions, not synthetic buys/sells or database updates.
Negative required opening inventory and remaining chronological oversells fail;
new/undated holdings without legacy evidence keep strict reconciliation. Unknown
historical add/remove dates and approximate cash/returns remain disclosed. Values
can differ from current accounting; exclusions and adjustments stay inspectable.
Validation: 48 backend checks, 23 focused frontend tests, production build and
both Home browser widths pass, as do generated API and whitespace checks. Tests
cover positive/negative adjustments, imported positions, recorded sales, eight
excluded rows across three synthetic symbols, no cash creation and strict guards.
Maintainer review/deployed validation remains pending. This supersedes the
blanket remaining-mismatch failure rule in the older compatibility notes below.

Legacy Home history follow-up (2026-11-16): #278 is merged/deployed. The
maintainer identified unmatched old sales as development-era add/remove artifacts
and authorized ignoring them for reconstruction. Exclude an unmatched sale row
only when it predates the displayed 30-day window; exclude its entire cash
proceeds and fees too, without modifying stored rows or inventing purchases.
Return `excluded_transactions` (ID, symbol, date, shares, reason) and show each
row in Home warnings. Explicitly disclose that reconstructed cash may now differ
from current ledger accounting. Matched sales remain; in-window oversells and
remaining quantity mismatches still fail. No migration or database operation.
This compatibility exception supersedes the blanket oversell statement below.
Validation: 42 backend checks, 22 focused frontend tests, production build and
both Home browser widths pass; generated API and whitespace checks pass.
Maintainer review and deployed-data validation remain pending.

Latest Home follow-up (2026-11-16): the maintainer explicitly chose **actual
portfolio history**, permitting approximate ledger backfill for validation.
The chart restored by #277 exposed the current-basket limitation (a new purchase
reset the whole window). Home now uses a separate JWT owner-scoped
`GET /api/portfolios/{portfolio_id}/analytics/history`, including `primary`.
The read-only service replays dated buys/sells/deposits/withdrawals/dividends/fees
and returns up to 30 UTC-day NAV/cash/holdings/external-flow values, native close
dates and approximate end-of-day-flow-adjusted returns. A new purchase does not
reset history; sold positions participate while held. Portfolio HQ's sparkline
now uses reconstructed NAV, separately from the current quote-backed headline.
The expandable daily table supports validation. Benchmark failures preserve NAV;
non-positive/unfunded periods can prevent the return index independently.

The approximation is explicit: opening cash applies from the earlier of creation
and first recorded activity, cash uses the shared transaction-date FX accounting,
securities use valuation-day FX, native prices carry at most seven days and never
use later closes for earlier dates. There is no corporate-action replay, retained
immutable NAV, intraday flow precision, database backfill, invented funding or
inferred missing trades. Ledger quantities must reconcile to current holdings;
unknown currency/FX/prices, invalid dates/amounts or oversells yield explicit gaps.
New/short portfolios show only available history. Existing Manager risk/benchmark
current-basket analytics remain separate. No migration or production DB action.
Validation: 65 relevant backend checks (17 new history regressions), all 817
frontend tests/131 files, production build and all 35 installed-Chrome smoke
journeys pass. API generation/check, surface inventory (490 operations/87
families), production-data and whitespace guards pass. No CI monitoring; the
maintainer reviews/tests after the PR. Deployed-data validation remains pending.
The following Home notes describe the preceding fixes, not this latest scope.

A separate Home correctness fix follows maintainer feedback that the 30D graph
looked unrelated to Portfolio. The audit found a hard-coded 24–26m fallback,
retained old curves after failure, older-date substitution, independent ending
rescaling and independent visual scales. The fix removes those paths and the
misleading net-liquidation sparkline. Home resolves the actual primary portfolio
ID before requesting its existing benchmark analytics. It shows only shared dated
observations within the last 30 UTC calendar days, independently rebased to 100 at
the same first date and plotted on one vertical scale. Dates, base currency,
primary name, original open-holdings methodology, history status and missing/
degraded inputs are explicit. Null/string/nonfinite/nonpositive points and
conflicting dates cannot silently misalign the two series. Partial, unsupported,
empty, failed or insufficient recent history has no curve. Loading clears old
history, single-flight polling avoids overlaps, and cleanup invalidates old scope
requests/results. History check time is distinct from the final historical date.

This is a presentation/data-integrity fix, not full historical account performance:
the backend models today's open basket at constant quantities after the date all
its positions existed, including historical FX. Cash, closed positions and full
transaction-ledger/NAV returns remain excluded. No backend/API/schema/provider/
settings/dependency change or production DB operation. Local checks: all 814
frontend tests/130 files, production build, production-data/whitespace guards and
all 35 installed-Chrome smoke journeys passed. New desktop/narrow Home journeys
verify actual primary ID, independent ending returns, failed-refresh clearing,
missing FX, old-window rejection and recovery. Maintainer review of this fix is
pending; do not reopen #274 testing or treat the fix as v2.8 release acceptance.

PR #275's initial CI run timed out in both Home browser journeys despite local
passes. The test used four `clock.runFor(30001)` calls while fake time also ran
automatically, replaying all due timer/animation callbacks and allowing host-speed
poll races. The correction pauses the clock before navigation, then uses
`fastForward(30001)` for one poll per phase, awaiting the expected request count
and rendered outcome before the next jump. Assert exactly five total history
requests. No application logic or timeout was changed. Both widths passed three
consecutive runs (six tests), and the complete 35-journey Chrome smoke suite
passed after correction. Keep this deterministic clock pattern for polling tests;
The maintainer confirmed #275 merged. Live follow-up then reported only
`Benchmark history unavailable (^GSPC)`, with no missing holding/FX issue.

The following backend fix reproduces that precise failure with valid source data:
Yahoo daily crypto bars use UTC midnight while US index bars use the session's
14:30 UTC timestamp. `_close_series` preserved these hours and benchmark reindexing
matched exact instants, erasing all overlap. Normalize Yahoo daily bars to UTC
calendar dates before the existing deduplication/alignment; FMP date labels already
use midnight. Hourly requests keep their actual timestamps. No provider, benchmark,
ownership, price, FX or quantity/accounting policy changes. Existing past-close
carry-forward remains; no future benchmark quote is backfilled. Add a brief Home
calendar disclosure so a weekend date is not mistaken for a new index quote.
Regression tests fail on the old code and pass on the fix, covering mixed Yahoo/
FMP history, crypto/equity session hours, weekend carry, no future fill, UTC rollover,
intraday preservation and genuinely missing benchmark data. Local verification:
70 backend tests (portfolio analytics/attribution/accounting/primary ownership/
ledger), 29 Home frontend tests, production build and both installed-Chrome Home
journeys passed. Generated API reference check, production-data and whitespace
guards pass. No schema/dependency/settings change or production DB operation.
Maintainer review of the daily-alignment follow-up is pending; the reported live
instance was not directly inspected. This is separate from the remaining v2.8
Deep sentiment integration and retention work.

PR #276 then hit a CI setup failure before browser tests: `ubuntu-latest` resolved
to Ubuntu 26.04, which locked Playwright 1.58.2 does not support for Chromium
installation/dependencies. Pin only the browser-bearing `build-and-test` job to
`ubuntu-24.04`; keep Compose/PostgreSQL runner selection, Node/Python, SDK/lockfile
and all test gates unchanged. Existing Playwright platform/dependency tables
explicitly support Ubuntu 24.04 x64. YAML parsing/diff verifies that only this
job's runner label changed semantically, and a Linux-target browser install
`--dry-run --with-deps chromium` resolves successfully. This is not an actual
Ubuntu package/browser installation on the local Mac; hosted CI must verify it.
The release guide records the OS pin and requirement to check locked SDK support
before moving the runner. #276 is merged; keep the Ubuntu 24.04 browser-runner pin. Do not monitor CI
unless requested.

A later live report still showed only `benchmark_history_unavailable (^GSPC)`.
The daily-hours fix missed a distinct weekend-start case: the basket begins after
Friday's last benchmark session. `source.reindex(basket_dates).ffill()` removed
Friday before filling, even though its close was available. A full-path regression
fails on that code. Resolve prior closes against the original sorted source with
`reindex(..., method="ffill")`, preserving earlier seeds and never backfilling a
later UTC-date close. A reported weekend-started basket matches this case.

The follow-up adds per-point `benchmark_as_of` and optional response `coverage`
(portfolio/benchmark start/end dates), and distinguishes no prior close from no
benchmark feed. Home displays quote as-of and unavailable coverage; it rejects a
benchmark close wholly older than its 30-day window. One portfolio point is not
an error, but Home still requires two observations to draw a comparison. Alpha
and tracking error are now nullable without two paired returns, preventing NaN
serialization and false zero metrics. Portfolio Manager renders missing metrics
as Unavailable while preserving genuine computed zero. API schema/types and
generated OpenAPI are updated; no DB migration, owner/benchmark/provider/FX or
quantity policy changes. Quotes remain daily-date observations, not intraday
knowledge. Current-basket history still starts at the latest opening date; do
not fabricate a full-month NAV curve from today's quantities.

Validation: 78 relevant backend tests, all 818 frontend tests/131 files,
production build and all 35 installed-Chrome journeys pass. Tests include the
weekend-start full fetch/FX/basket path, one/two-row JSON serialization, no later
date backfill, source-date provenance, nullable metrics and coverage display.
Generated API reference/surface inventory (489 operations/87 families), production
mock and whitespace guards pass. No production DB was queried or changed.
Maintainer review of the prior-close-window follow-up is pending. Remaining v2.8
Deep sentiment and retention work stays separate.

The BTC stock-view issue is accepted as fixed: #268's timestamp/value guards were
insufficient on their own; #269 (`cf03cf4`, including test-hardening `5601656`)
coalesced the reproduced Yahoo off-grid quote tail and repaired full crosshair
OHLCV selection. Its smoke test now targets the interaction canvas, waits for
all five values, uses a populated history and consistent clock. The maintainer
confirmed "that fixed it" and authorized continuing. Carry that acceptance
forward; do not request another test of the resolved case. Partial live volume
is not independently verified full-period volume; weekly/monthly and CoinGecko
tail behavior are unchanged by the hotfix.
See
`docs/wiki/Fundamentals-Briefing-Contract.md` for the audit and delivery sequence.
The inherited layout audit is the discovery step for a dedicated
v3 frontend overhaul after v2 close-out; it is not a minor-release
cleanup item. RSI/MACD, volume, accumulation, Elliott-wave hypotheses and
independent validation of video/note assumptions remain later north-star work.
See Roadmap/TODO and `docs/wiki/Releasing.md`.

Previous post-release audit: **2026-10-28**, against published **v2.3.0** at
`3fb7de3` (release preparation PR #229). All three CI jobs passed and the PR
merged; following explicit maintainer authorization, the annotated tag and
GitHub release were published on 2026-10-28. The full local gate, eight Chrome
smoke journeys and Compose configuration passed on 2026-10-27; see the ledger
in `docs/wiki/Releasing.md`. README/wiki now describe the published workflow.
The changelog publication date is reconciled without moving the release tag.
No v2.3 release gate remains open. The bilingual chapter-19 article is published
in `praderasblog` (PR #116), reflecting the context/repair/quality distinction.
v2.4 Fast/Deep model-profile work started on 2026-10-28; broader v2.x items remain
backlog rather than automatic follow-ups.

## Read order and sources of truth

1. This file: mission, architecture, invariants, and working conventions.
2. `TODO.md`: current shipped state, active work, and known gaps.
3. `postgres-notes.md`: database portability constraints.
4. The code and tests for the area being changed.
5. `README.md`, `CHANGELOG.md`, and `docs/wiki/Roadmap.md` for product-level
   detail and release history.

When changing the product surface, also read `docs/wiki/Surface-Inventory.md`
and its machine-readable `docs/surface-inventory.json` before adding, removing,
or advertising a route. The complete generated API contract lives in
`docs/API_REFERENCE.md` and `docs/openapi.json`; regenerate it with
`scripts/generate_api_reference.py` after route, schema, auth, or classification
changes.

The code and recent Git history win when prose disagrees. Older plans, RFCs,
architecture proposals, and QC records are historical unless `docs/README.md`
marks them current; do not copy their assumptions without checking the current
code, Docker Compose, README, and maintained wiki pages.

Repository-level `AGENTS.md` and `CLAUDE.md` currently point to local PRO-LONG
session history. That history is supporting context, not a substitute for this
maintained handoff or an authority over the current code and user instructions.

## Why this fork exists

Upstream (`Hitheshkaranth/OpenTerminalUI`) was India/NSE-centred and assumed
SQLite, Zerodha Kite, and Indian providers. This fork is now a broader private
investing terminal with these priorities:

- **US, EU, and crypto first-class support**, while retaining India/NSE/BSE F&O.
- **PostgreSQL-first deployment**, with SQLite still supported for local and
  test use.
- **Honest data semantics**: missing, rate-limited, sample, or unsupported data
  must be labelled degraded. Plausible fabricated values must never look live.
- **Private, provider-agnostic AI**: OpenAI-compatible LLM calls default to local
  Ollama but can use LM Studio or hosted providers.
- **A private research and portfolio system**, including per-user portfolios,
  notes, second-brain retrieval, and adversarial "Interrogate" features.

The product principle is **integrity over feature count**. A visible empty or
degraded state is preferable to a convincing but invented number.

The long-term product is a private, AI-friendly, multi-asset decision terminal:
it should connect worldwide market context, fundamentals, technicals, sentiment,
portfolio exposure, and the user's own research; support decisions across
investing, trading, and scalping; and eventually interact with brokers through
strictly controlled execution. The major-generation targets are:

1. **v1 — coherent, honest fork:** one product identity, intentional surface
   area, accurate contracts and docs, no accidental inherited defaults, and
   trustworthy base-currency accounting for multi-market portfolios.
2. **v2 — cross-market intelligence:** markets and asset classes explain one
   another rather than existing as isolated screens.
3. **v3 — UX/frontend overhaul:** coherent workflows for existing capabilities,
   beginning with consolidated Portfolio positions, operations-first entry and
   floating/collapsible portfolio navigation.

Later north-star themes retain multi-dimensional validation, the decision
lifecycle, multiple horizons/instruments, agent-native access and controlled
execution. Their replacement release numbers are not assigned. On 2026-11-14 the
maintainer explicitly chose to finish v2 first, then prioritize v3 UX before
further feature expansion; the former v3 validation label is superseded.

These are dominant product promises, not silos. Existing journal, derivatives,
and Hermes ingestion work are foundations for later generations, not evidence
that those generations are complete. `docs/wiki/Roadmap.md` is canonical for the
release-level interpretation and safety boundaries.

## Current release and development state

- **v2.3.0 released — Context beyond price.** Extend the selected comparison
  briefing with explicitly included dated headlines and existing US/euro-area
  macro observations, preserving scope, source links, actual pair windows,
  current-vintage/reference-period semantics and failures. First slice is a pure
  deterministic context projection in `market_briefing_context_evidence.py`:
  selected regions are never inferred from tickers, headline text is untrusted,
  values/flags/counts survive bounded projection, and references are local to a
  separately fingerprinted envelope. Its nested v2.2 price packet keeps its
  original price-only scope. Separate JWT-only `/briefing-context-evidence`,
  `/briefing-context` and `/briefing-context/stream` endpoints now collect selected
  sources and synthesize observations/possible context/limitations/unknowns.
  Context collection is bounded to 40s, 12s per source, three concurrent jobs;
  identical macro region/window requests share one fetch within the operation.
  Price preparation retains 45s and model health/completion/one repair share the
  configured LLM deadline. Exact references, linked pairs and coverage are checked,
  not prose truth. Evidence above 120,000 serialized characters is rejected for
  synthesis without silent trimming; model failure retains the entire envelope.
  Closing either briefing stream immediately cancels/joins its operation. The
  browser now defaults to price-only and offers independent news, US FRED and
  euro-area macro opt-ins. Scope/selection changes abort and clear old work;
  the shared stream reader includes the context budget without silent replay.
  Coverage/failures stay beside prose, with keyboard-focusable section/group/
  headline/series citations, safe source links, exact values/counts/flags and
  separate outer/price snapshot IDs. Browser shape/reference checks do not
  fact-check prose. Desktop/narrow Chrome journeys and deterministic frontend
  tests cover the richer and degraded paths. Release PR #229 passed all three
  CI jobs and merged; publication is complete. Host feedback on
  2026-10-27 confirmed price-only works but news+macro hit validation failure
  after repair; the old logs did not capture which check failed. Context prompts
  now include validator-derived reference obligations, and the single repair
  gets safe reason codes/schema paths/required server IDs. Both attempts log
  these diagnostics without rejected prose/provider secrets. The maintainer
  confirmed the news+macro retest completed after repair on 2026-10-27; attempt 1
  logged `context_source_pair`. This does not diagnose the older uninstrumented
  failure or certify prose quality. Shallow extraction/reasoning on the fast
  model remains a limitation; Fast/Deep task routing is approved for v2.4, not
  a new v2.3 gate. Do not relax validation. No persistence
  or indexing is added; v2.2 request/result shapes stay price-only. Fundamentals,
  technicals, private notes, portfolio-wide context, discovery, saving and new
  provider acquisition are excluded. Calendar-provider reliability and historical
  vintage/release audits are not gates on this milestone.
- **v2.4.0 released — Task-appropriate models.** After v2.3
  closure, add named Fast/Deep generation profiles with explicit task routing,
  independent model/endpoint/credentials/timeout, legacy `LLM_*` compatibility,
  consistent deadlines and visible resolved identity. Deep failure must not
  silently substitute Fast; credentials must not leak across endpoints.
  Embeddings remain independent. Evaluate representative tasks for usefulness,
  fidelity and latency, not only structure. No model deployment, autonomous
  escalation, new evidence providers or broader validation features. See the
  Roadmap and TODO before continuing. First slice adds validated optional Deep
  settings, task map/resolver and `get_llm_client(task=...)`. Comparison briefings
  (price-only and selected context) now resolve Deep once and share that snapshot
  across transport, health, bounded repair, deadline announcements and visible
  model identity. Default single-model operation stays explicit when Deep is
  unset; configured Deep failures never retry Fast. Shared stock/Interrogate,
  market/collection outlooks, risk and backtest insights now also use Deep with
  one profile across health, requests, repair, identity and deadlines. Their
  browser cards share a cancellable lifecycle, including research GET-compatible
  surfaces; total operation budget is model timeout plus 60 seconds preparation
  allowance, with 15 seconds browser margin. Interrupted runs never replay;
  manual retry is explicit. Research caches hash profile configuration and retain
  owner/note-version isolation; failed insights are not cached. Embeddings stay
  on the legacy factory. Explicit Deep URLs never inherit
  Fast keys; when the Deep URL is omitted, the existing endpoint/key may be
  inherited. Shared insight host testing after #234 confirmed it works as intended.
  Brain synthesis is now integrated: one selected profile spans retrieval gating,
  completion, streaming/fallback, identity and deadlines. `queued` announces an
  overall model-timeout-plus-120-second preparation allowance before retrieval;
  the producer owns model/operation deadlines across heartbeat reads. The browser
  adds 15 seconds of margin, supports Cancel and never replays interrupted runs.
  Completed Brain Log saves retain the actual model through existing fields;
  provider labels are generic classes, not hostnames. There is no Brain answer
  cache, database migration or embedding/indexing change. After #235 the maintainer
  confirmed Brain works as intended. Filing analysis is now integrated separately:
  one profile/deadline, typed output checks and explicit lexical fallback reasons.
  A portable, lazily created `stock_conviction_provenance` companion table stores
  model/failure metadata atomically with the existing report. No old columns,
  catalyst JSON, engine labels or historical model provenance are rewritten.
  New model output uses engine `llm`; old `lmstudio` rows remain unknown-provenance.
  A cancellable ingest lifecycle/browser helper honors announced budgets without
  replay. The saved-report panel labels model/lexical/legacy states; no new
  ingestion UI or provider is added. This remains an experimental global report,
  not private Brain evidence or SEC fact verification. SQLite persistence and
  PostgreSQL DDL compilation are checked; no live PostgreSQL rollout is claimed.
  After #236 the maintainer confirmed filing integration works as expected.
  News sentiment, stock emotion and query intent now explicitly resolve Fast;
  health/generation share one model deadline and browser lifecycles announce
  identity/budgets without automatic replay. Sentiment/emotion caches hash Fast
  configuration; Deep-only changes do not invalidate them. Query rate limits use
  the authenticated owner. After #237 the maintainer confirmed the Fast slice
  worked as intended (2026-10-31). All twelve generation tasks are integrated
  and operationally accepted. The maintainer then clarified that quality,
  source accuracy and response times were tested in the individual PRs, closing
  the evaluation gate without duplicate runs. `Briefing-Evaluation.md` records
  this acceptance; no measured benchmark is claimed. Local exit checks passed;
  release PR #239 passed all CI jobs and merged at `e8aaddb`, then authorized
  tag/GitHub publication completed on 2026-10-31. No v2.4 gate remains.
  On 2026-10-29 the maintainer confirmed Deep routing works, but found briefings
  too descriptive. Approved quality follow-up: structured `hypotheses` now
  separate interpretations, conditional mechanisms, competing explanations and
  distinguishing evidence. Citations anchor observed inputs, not mechanisms;
  established causal attribution/recommendations remain excluded. Both validators
  and UI implement this contract; initial price/context budgets are 3,200/6,400 tokens
  under the same profile deadline. After merging #233 the maintainer confirmed
  the briefing works better, accepting the initial improvement. The scenario
  guide remains in `docs/wiki/Briefing-Evaluation.md`; do not claim an exhaustive
  audit or that tests certify reasoning quality.
- **v2.2.0 released — Grounded Comparison Briefing.** The agreed outcome is
  on-demand cited synthesis of a selected comparison, with observations, possible
  context, conflicts and unknowns kept distinct. No causal explanations, trade
  advice, automatic discovery or portfolio-wide context. The first API slice
  builds fingerprinted shared-UTC provider-close evidence on the server. Separate
  `/briefing` and `/briefing/stream` APIs now add on-demand synthesis with strict
  structure, snapshot identity and citation-reference checks, bounded health/
  generation/repair and cancellable progress streaming. Reference validity is
  not semantic fact-checking; preserve the fixed scope notice and original
  evidence/caveats. Optional panels, persistence and indexing remain excluded.
  The comparison browser now offers explicit generation, progress/cancellation,
  manual retries, plain-text results and citation-to-snapshot inspection. Draft
  or applied selection changes invalidate prior work; failed retries retain no
  old prose. No automatic stream replay or saving/indexing. The maintainer
  accepted the live briefing and confirmed the crypto quote fix after PR #221
  on 2026-10-21. Model capability may merit later work but is explicitly outside
  this milestone. The local gate passed with 74.90% backend coverage, 447 frontend
  tests and six Chrome smoke tests. PR #222 passed build-and-test, clean-install
  and PostgreSQL-contract CI and merged. With explicit maintainer authorization,
  the annotated tag and GitHub release were published from `039c395` on 2026-10-21.
- Latest published release: **v2.5.0**, tagged and published from `fad1c95` on
  2026-11-02 after green release-prep CI and explicit maintainer authorization.
  Keep `backend/config/settings.py` and `frontend/package.json` in lockstep when
  releasing.
- **v2.0 shipped the bounded cross-market context feature**, alongside the
  completed time-aware Brain and Brain Log foundations. Release preparation
  and host acceptance are complete, including the final proxy-suggestion click
  fix. The broader fundamentals-vintage, macro-release, technical-session,
  automatic relationship, portfolio-context, and AI-interpretation ambitions
  are later v2.x candidates (or later validation work), not implicit pre-release
  PRs. See the explicit v2.0 gate in `TODO.md` and `docs/wiki/Roadmap.md`.
- **v2.1 shipped filing-grounded US fundamentals:** `POST /api/market-context/sec-filing-fact-check`
  checks one selected current Company Facts claim against an official,
  archive-listed XBRL instance. It requires exact issuer/concept/unit/duration
  evidence, returns source links and explicit failure/conflict states, and
  bounds document size, parser complexity and request duration. The comparison
  browser offers **Check source filing** below each fact and each same-period
  differing disclosure. Exact values, source links, dated results and manual
  retries are visible; the request has a 60-second browser timeout and cancels
  on unmount. Checks remain opt-in without focus/reconnect refetches.
  The maintainer confirmed the NVDA filing journey after PR #215 fixed SEC
  label markup and padded CIK formats. PR #216 passed all three CI jobs and
  merged; explicit maintainer authorization preceded the published tag/release.
  It does not claim a full historical
  vintage or make fundamentals explain past price moves. See `TODO.md` and
  `docs/wiki/Roadmap.md` for the bounded v2.1 scope.
- **v2 opens with time-aware private memory.** Semantic similarity alone must
  not flatten current and historical beliefs. Second Brain evidence carries
  effective, recorded, and updated timestamps; retrieval may give bounded weight
  to recency only inside a semantically relevant candidate set; synthesis treats
  newer conflicting evidence about the same subject as current while retaining
  the older view as cited history. Manual Notes capture can set or clear the
  effective time, and its loading, failure, and queued-indexing states are
  visible; manual Brain reindexing also reports progress and final chunk totals.
  The owner-scoped **Brain Log** storage/API foundation now saves completed
  answers as immutable research memos with dated citation/content snapshots and
  model provenance. Organization metadata is editable; answer/evidence snapshots
  are not. Memos stay out of retrieval by default. The browser Second Brain
  page now saves completed answers and exposes the Brain Log for reading and
  organizing them. A reviewed **Promote to Note** action creates a separate,
  editable Note with a link back to its source memo; only that Note becomes
  evidence. Opening a memo compares its cited chunk identities with live source
  records without depending on the embedding index, and distinguishes changed,
  unavailable, and unverifiable evidence. This is not fact-checking the answer.
  Theses and Journal remain
  canonical user-owned records. This is an iterative contract to evaluate
  against the growing Hermes corpus before cross-market synthesis relies on it.
  `docs/wiki/Brain-Retrieval-Evaluation.md` describes the read-only retrieval
  runner; no real Hermes case file is checked in, so tuning remains open.
- **v1.7.0 — multi-currency portfolio accounting** completed the v1 arc.
  It promotes the existing portfolio currency to an explicit reporting base,
  persists transaction/native currency semantics, and normalizes ledger and
  analytics results using traceable current and historical FX rates. Missing
  conversions must remain partial/degraded rather than produce false totals.
  Implementation has established the traceable current/historical FX resolver
  and explicit nullable holding, transaction, and fee currency evidence; legacy
  rows remain unknown. Portfolio list, detail, and Manager analytics now share a
  backend base-currency engine with native evidence and explicit
  complete/degraded/partial results, and Portfolio Manager renders that contract.
  Primary dashboard summaries, Home, Cockpit, Launchpad, current allocation, and
  position exports are aligned as well. Deep risk and benchmark history now use
  dated base-currency observations, while attribution separates security, FX,
  and interaction returns. The endpoints explicitly describe their current-open-
  holdings methodology and withhold unsupported history. Implementation and
  automated release preparation are complete through PR #146. Host testing then
  exposed an unactionable legacy-currency state; PR #147 added explicit,
  owner-scoped repair controls and passed functional host testing. PR #148 then
  moved those controls from crowded value cells to row actions and a focused
  dialog after UX feedback. The repeated host smoke, tag, and GitHub release are
  complete.
- **v1.3 — The second brain gets depth** shipped
  deterministic long-note chunking, source-aware retrieval, progressive answers,
  deliberate API-key note ingestion, and an explicit journal-gap review. Feature
  work, release verification, tag, and GitHub release are complete. The release
  gate recorded 817 backend tests and 296 frontend tests, plus compile, build,
  production-mock, and Compose checks.
- The v1 arc is **fork consolidation and accounting truth**: v1.4 audited and
  pruned the exposed surface, v1.5 made identity/defaults/contracts consistent,
  v1.6 established the stable baseline, and v1.7 closes trustworthy backend
  base-currency accounting. v2 cross-market intelligence is the next arc.
  The v1.4 inventory, stub decisions, initial orphan removal, and hidden
  compatibility hardening have landed; primary experimental destinations are
  now adjudicated. Watchlists and their reports/dividend views are owner-scoped;
  background workers receive only a symbol union, and the old flat global model,
  API, and table are gone. Duplicate backend mounts and frontend lab route trees
  are consolidated; intentional Backtest/Screener generations are recorded in
  the surface inventory. Limitations and user-facing configuration cues now
  match the retained surface, completing the v1.4 implementation sequence.
  Final user-test blockers extend the browser deadline beyond the backend LLM
  timeout and make direct public NSE scraping opt-in with a first-403 process
  circuit. PR #117 merged those reliability fixes; PR #118 made Journal and
  portfolio-thesis capture discoverable and corrected Brain citation routes.
  Live testing then exposed intermittent malformed JSON from a healthy local
  Gemma provider and ungrounded Home/Risk generation when their facts were
  absent; PR #119 added one bounded structured-output retry and factual input
  gates. The maintainer completed live verification, release PR #120 merged,
  and `v1.4.0` was tagged and published at `2999a42`. **v1.5 — Fork
  consistency** shipped in v1.5.0. PR #122 established canonical fork
  identity, package-derived frontend versioning, the documentation hierarchy,
  and current PostgreSQL-first setup/contribution contracts. PR #123 centralized
  US/NASDAQ as the fallback for generic screens, backtests, charts, reports,
  labs, and model tools while preserving selected NSE/BSE behavior. The current
  currency/locale pass makes provider instrument metadata authoritative, keeps
  native labels when FX is unavailable, confines Indian grouping to intentional
  India contexts, and identifies mixed-currency aggregates. The implementation
  and automated v1.5.0 release preparation completed in PR #125. Final user
  testing found ambiguous unlabelled holding-entry fields beside the newly
  visible portfolio thesis; PR #126 added persistent labels and a responsive
  layout. The maintainer verified the fix, and `v1.5.0` was tagged and published
  at `1d2f3ca`. **v1.6 — Stable baseline** implementation and automated
  verification completed through PR #137: deterministic browser journeys,
  resilient streamed insight jobs, cold-route reductions, PostgreSQL parity,
  the generated API contract, and a disposable clean-install gate. Automated
  release preparation landed in PR #138. Host/user testing then found the API-key
  list response mismatch; PR #139 fixed it without a migration and passed the
  full gate. Tag and GitHub release `v1.6.0` were published from `0dc86db`.
  **v1.7 — Multi-currency portfolio accounting** implementation completed
  through PR #145: explicit ledger currencies, traceable current/historical FX,
  shared current accounting, aligned consumers, base-currency history, and
  security-versus-FX attribution. Release preparation merged in PR #146. Host
  testing then found that conservatively unknown legacy currencies could not be
  repaired in the UI; PR #147 added per-record holding, transaction, and fee
  currency repair. Host testing confirmed the behavior but rejected the crowded
  inline UI; PR #148 moved repair into row actions and a focused dialog. The
  maintainer verified the result, and `v1.7.0` was tagged and published from
  `0473307` on 2026-09-15.
- General MCP tooling and automatic external market/news indexing remain
  deferred. The supported automation boundary is the authenticated, idempotent
  external-note endpoint intended for deliberate inputs such as Hermes YouTube
  summaries.
- The real Relative Strength engine and broader depth/coverage work remain
  separate backlog rather than v1.3 release gates.
- The old `.agents/TODO.md` snapshot stopped around PR #17. Its Ollama, EUR,
  crypto tick, and early frontend-audit tasks have all shipped and must not be
  treated as current work.
- See `TODO.md` for the current backlog. Before starting any backlog item, check
  `git log`, the implementation, and tests in case it landed without a doc edit.

The v1.3 collaboration retrospective was merged into `praderasblog` as PR #104,
series order 10: **“When a Second Brain Learns to Grow.”** The v1.4 retrospective
followed in PR #108, series order 11: **“The Release That Learned to Say No.”**
The bilingual v1.5 retrospective followed as `praderasblog` PR #109, series order
12: **“The Terminal Learns Where It Stands.”** The series continued through
v1.6/v1.7, the Second Brain goals essay and the published v2.0 retrospective,
series order 16: **“A Market Comparison That Knows Its Limits.”** New release
articles belong in the sibling `../praderasblog` repository under its own
authoring instructions; confirm its current series order before adding a post.
These are narrative context, not engineering sources of truth; deployment is
handled separately on the blog host after merge.

## Architecture at a glance

### Backend

- Python 3.11, FastAPI, Pydantic, SQLAlchemy, and Alembic.
- The app entry point is `backend/main.py`; router composition is in
  `backend/api/router.py`.
- Thin route handlers live mainly in `backend/api/routes/`; business logic lives
  in `backend/services/`, with additional domain packages such as `equity/`,
  `fno/`, `portfolio_lab/`, `risk_engine/`, and `screener/`.
- PostgreSQL 16 is the Docker default. SQLite remains the code-level fallback
  and is used by tests and dedicated sidecar caches.
- Redis provides optional caching, pub/sub, and quote distribution.
- Alembic migrations live in `backend/alembic/versions/`.

### Frontend

- React 18, TypeScript, Vite, Tailwind, TanStack Query, and Zustand.
- Pages live in `frontend/src/pages/`, API clients in `frontend/src/api/`, shared
  state in `frontend/src/store/`, and real-time subscriptions in
  `frontend/src/realtime/`.
- Charts use Lightweight Charts; other visualisations use Recharts, Nivo, and
  Three.js where appropriate.

### Market data and providers

- Search uses the `instrument_master` universe: US Nasdaq Trader data, EU
  `pytickersymbols`, crypto CoinGecko data, plus a live Yahoo fallback.
- US/EU quotes and charts use provider fallbacks including Yahoo, FMP, and
  Finnhub. Crypto uses CoinGecko/Binance/Yahoo as appropriate. India uses
  Kite/NSE providers where credentials are available.
- Live ticks are normalised and distributed through the quote hub and
  `/api/ws/quotes`. Binance supplies crypto spot ticks.
- External-client work must preserve retry/backoff, circuit-breaker, cache, and
  degraded-response behaviour. Never cache provider 429/5xx responses.

### AI and private research

- `backend/services/llm_client.py` is the provider-agnostic OpenAI-compatible
  client. Defaults point to Ollama; legacy LM Studio aliases remain supported.
- Structured-output support must work with providers that ignore
  `response_format`; the JSON schema is also carried in the prompt, and truncated
  structured calls can be retried with a larger budget.
- Notes and second-brain data are user-private. PostgreSQL uses pgvector when
  available; SQLite uses in-process cosine similarity. Do not weaken ownership
  checks or leak one user's notes/portfolio data to another.

## Engineering invariants

1. **No fake live data.** Use the shared degraded marker and frontend degraded
   banner. Keep `scripts/check_no_production_mocks.py` passing.
2. **Preserve SQLite and PostgreSQL portability.** Prefer SQLAlchemy/Alembic over
   raw SQL. When raw SQL is unavoidable, follow `postgres-notes.md` and use
   `backend/shared/sql_compat.py`.
3. **Keep Alembic revision IDs at most 32 characters.** PostgreSQL enforces the
   `alembic_version.version_num` width.
4. **Portfolios are per-user.** The legacy global `Holding`/`TaxLot` system was
   removed in v1.1. Use the owner-checked `/api/portfolios` system and the
   per-user primary portfolio.
   Watchlists follow the same rule: supported clients use `/api/watchlists`.
   Installation-wide workers may use only the shared symbol-union helper; do not
   recreate an ownerless watchlist model or API.
5. **Cash derives from the transaction ledger.** Do not introduce a competing
   mutable cash balance. Sells must update both the ledger and holdings.
6. **Currency must be instrument-aware.** A display-currency selection is not
   permission to relabel an unconverted value. If conversion is unavailable,
   show the native currency honestly.
7. **Provider failures are normal.** Missing keys, quotas, geoblocking, and
   unavailable feeds should degrade cleanly rather than crash or fabricate.
8. **Do not commit secrets or `.env`.** Document new settings in `.env.example`
   and the README.
9. **Do not revive retired global portfolio or tax-lot APIs** without an explicit
   new design decision. Tax-lot accounting is deliberately out of scope because
   jurisdiction-specific wrong answers are worse than no answer.

## Development and verification

The PR CI gate uses Python 3.11 and Node 22. It runs:

```bash
python -m compileall backend
python scripts/check_no_production_mocks.py
PYTHONPATH=. python scripts/check_surface_inventory.py
PYTHONPATH=. python scripts/generate_api_reference.py --check
PYTHONPATH=. pytest backend/tests -q --cov=backend --cov-fail-under=45
cd frontend && npm ci && npm run build && npx vitest run
```

For an existing checkout with dependencies installed, `make gate` runs the
mock/surface/API guards, backend compile/tests with coverage, frontend build and
Vitest. Browser smoke runs separately locally and in regular CI; CI also runs
disposable PostgreSQL contracts and a fresh-install job. Run focused tests during
development, then the broadest relevant checks before handing off.

The maintainer's macOS workstation has Chrome installed at
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` and exposes a
Chrome CDP endpoint at `http://127.0.0.1:9222` for interactive checks. For the
existing smoke runner, set `PLAYWRIGHT_EXECUTABLE_PATH` to the installed Chrome
binary; it uses an isolated temporary profile. Check this available browser
before downloading Playwright's bundled Chromium. See
`frontend/tests/e2e/README.md` for the local command. CI uses bundled Chromium.

The deterministic Playwright `@smoke` subset is part of every PR gate. The rest
of the browser suite remains manual and is classified in
`frontend/tests/e2e/README.md`; several specs predate the 1.0 integrity/de-India
changes and need rewriting. Do not assume a legacy E2E failure is a new product
regression without checking the fixture and expectation, and do not silently
ignore genuine failures either.

Documentation-only changes do not require the full application suite, but check
links, paths, commands, spelling, and the rendered diff.

## Working conventions for agents

- Start from a clean, current `main` and use a focused branch (`feat/`, `fix/`,
  or `docs/`). Do not modify or discard unrelated user changes.
- Inspect the relevant routes, services, frontend consumers, tests, and recent
  commits before changing behaviour. The repository is large and older plans can
  be stale.
- Add or update tests for behaviour changes. Prefer focused tests first.
- Keep PRs scoped and explain degraded/fallback semantics when provider-facing
  behaviour changes.
- Update `CHANGELOG.md` for user-visible changes and update `.agents/TODO.md`
  when a tracked item lands or priorities change.
- Follow `.forge/tasks/*.json` locks when Forge tasks are present; keep
  `auto_commit` disabled unless explicitly authorised.

## Useful file map

| Concern | Location |
|---|---|
| Application entry / lifespan | `backend/main.py` |
| API router composition | `backend/api/router.py` |
| Configuration | `backend/config/settings.py`, `.env.example` |
| Database engines/sessions | `backend/db/base.py`, `backend/db/session.py` |
| Alembic migrations | `backend/alembic/versions/` |
| SQL dialect helpers | `backend/shared/sql_compat.py` |
| Degraded response helper | `backend/shared/degraded.py` |
| HTTP resilience | `backend/shared/http_resilience.py` |
| Market classification | `backend/shared/market_classifier.py` |
| LLM client | `backend/services/llm_client.py` |
| Second brain | `backend/services/brain/` |
| External note ingestion | `backend/api/routes/external_notes.py` |
| Portfolio routes/services | `backend/api/routes/portfolios.py`, `backend/services/portfolio_*` |
| News ingestion/API | `backend/bg_services/news_ingestor.py`, `backend/api/routes/news.py` |
| Frontend API clients | `frontend/src/api/` |
| Frontend pages | `frontend/src/pages/` |
| Currency conversion/display | `frontend/src/lib/currency.ts`, `frontend/src/hooks/useDisplayCurrency.ts` |
| Realtime frontend | `frontend/src/realtime/` |
| CI definition | `.github/workflows/ci.yml` |
| Release procedure | `docs/wiki/Releasing.md` |
