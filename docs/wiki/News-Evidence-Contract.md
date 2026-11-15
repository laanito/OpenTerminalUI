# Durable news evidence — v2.8 foundation

Status: v2.8 capture/review/follow-ups and explicit durable headline scoring API,
2026-11-15. Legacy news APIs/scorers still do not write text/assessment tables.
The new explicit saved-headline endpoint does: it stores exact selected text,
separate keyword tone and Fast asset-implication assessments, and cache provenance.
Saved comparisons retain their original evidence/results; generation endpoints
remain ephemeral. Browser sentiment selection and checked Deep integration,
configurable retention and cleanup remain future work. This contract supports
repeatable evidence; it does not promise identical model prose.

## Existing paths and provenance gaps

| Path | Current storage | Limits for reproducibility |
|---|---|---|
| `bg_services/news_ingestor.py` | Installation-wide `news_articles`, unique URL, baseline score | Repeated URLs are skipped. Scoring precedes title/summary storage truncation, so the stored text may differ from the scored input. No per-score method/model/version/scoring timestamp. |
| `api/routes/news.py` | DB-backed lists or cached live fallback | Live fallback items are not automatically inserted. Missing baseline scores may be calculated on read without a write. |
| `services/llm_sentiment.py` | Short-lived per-text/profile cache | No durable assessment or original scoring timestamp. Its existing trader-oriented prompt infers an asset implication, rather than measuring investor sentiment. Target asset is not explicit in that cache identity. Confidence is heuristic. |
| Existing comparison headline collector and synthesis endpoints | Bounded response/evidence packet | Not automatically saved. The separate explicit capture API below retains a complete run. A response fingerprint alone is not durable storage. |

Leave legacy rows intact. Neither current configuration nor the legacy article
creation time establishes how/when an old score was computed. Do not relabel old
scores as verified assessments or backfill provenance from today's model.

## Storage boundary

`models/news_evidence.py` adds two owner-scoped tables. `services/news_evidence.py`
provides validated inputs, insert-only helpers and owner-filtered reads. Helpers
flush within the caller's transaction; they do not commit, fetch, score or prune.
The initial storage increment exposed no endpoint; the explicit scoring/read
API below now uses these helpers. Legacy rows are not backfilled.

Each text capture gets a UUID, actual terminal `captured_at`, SHA-256 text hash
and schema-versioned JSON. The payload preserves exact title and supplied summary,
URL, publisher, reported publication time (nullable), actual retrieval time,
headline/summary scope, truncation flag and symbol context. Whitespace is retained.
Oversized input is rejected instead of silently truncated. The hash covers a
canonical pair of title/summary strings, not URL, ownership or retrieval time.
It is an equality aid, **not an access credential or snapshot identifier**.

A new capture always gets a new ID, including an unchanged repeated retrieval.
An edited URL therefore cannot mutate an existing reference. This first storage
boundary deliberately has no shared blobs or deduplication: it favors explicit
owner isolation and observation history. Public `news_articles` stays shared.

Each assessment gets a separate UUID and actual `recorded_at`, links to one exact
snapshot, and retains its original `scored_at` even when captured from a cache.
Its versioned payload holds:

- text tone versus asset implication, with a required target for asset implications;
- method/calculation version, public provider/model and prompt version for `llm`;
- exact composed text passed to the scorer, score/label/rationale and optional
  explicitly heuristic confidence;
- completed, fallback or failed status, with a typed failure/reason code for
  failures and fallbacks. A failed assessment cannot carry a fabricated result.

The caller must describe the actual engine used, including the baseline engine
behind a fallback. It must capture the actual supplied text before lossy storage,
and must not turn a cache retrieval time into a scoring time. Existing cache
entries lack that provenance; they cannot be promoted into this contract by
inventing it. New scoring integration must establish these values at scoring.
Only explicit public identity fields are accepted; settings dictionaries,
credentials and authentication headers have no place in the payload.

Assessment writes first check snapshot ownership. A composite database foreign
key also prevents linking another owner's snapshot by ID. Reads require an owner
and never resolve by text hash. Rescoring inserts a new assessment. Ordinary ORM
updates are rejected; this application contract is not a tamper-proof audit store
against privileged SQL. There are no text/assessment update/delete HTTP surfaces yet.
Deleting an account cascades its private records, with no other owner sharing them.

## Migration and retention

Additive Alembic revision `0019_news_evidence` follows
`0018_brain_technical_context`; both PostgreSQL and SQLite use portable JSON,
timezone-aware timestamp declarations and composite foreign keys. Payload dates
retain explicit offsets in JSON, including on SQLite. Existing news, portfolios
and Brain records are not rewritten. Downgrade retains research tables, and
re-upgrade is idempotent. Fresh metadata initialization includes both models.

There is **no expiry job, retention default or implicit deletion**. Agree the
configurable unreferenced retention duration before enabling cleanup. Saved
comparison references must pin their dependencies before any pruning is added.
Storage will grow once callers are wired; define bounded capture and lifecycle
behavior in that integration. Shared-reference release, explicit evidence deletion
and missing-source UX are still unimplemented, not implied by these tables.

## Explicit comparison capture API

JWT-authenticated `POST /api/market-context/briefing-captures` accepts server-side
selections only, for example:

```json
{"anchor":"AAPL","comparisons":["SPY"],"period":"1M","context":{"news":true,"macro_regions":["us"],"technical":true,"fundamentals":true}}
```

Omitted or entirely unselected context uses price-only synthesis. The endpoint
resolves Deep once, reuses the existing bounded server evidence collection and
checked synthesis, then commits one immutable `comparison_captures` row. It
returns 201 with capture identity, actual save time, retention state and a
schema-versioned content envelope containing:

- normalized selections and the complete original result, including its bounded
  price/news/macro/technical/filing evidence, local citations, scope notices,
  source dates, calculation methods/formulas and original schema versions;
- original generation time, answer or handled typed failure (no rejected partial
  prose), plus public model/profile identity, protocol, enabled state, selected
  structured-output mode and configured model deadline;
- each exact dispatched JSON model request body with its terminal dispatch time,
  rendered prompts/evidence, JSON schema and effective generation parameters.
  This includes client-added JSON instructions, response-format fallback,
  token-cap retries and bounded repair feedback. It never includes authentication
  headers, endpoint URLs or provider settings. A dispatch record does not prove
  provider receipt or identify the actual weights behind a mutable model alias.

The client callback observes detached payload copies immediately before HTTP
submission. Requests not reached (disabled model, health failure, evidence
failure) have no dispatched inputs; empty attempts are not an invented prompt.
Unexpected exceptions/cancellation before completion do not publish a capture.
Handled evidence timeout can retain its typed failure with no evidence packet.

`GET /api/market-context/briefing-captures` lists bounded owner summaries
(`limit`/`offset`). `GET /api/market-context/briefing-captures/{id}` reopens the
original contents using only the database, without live providers or inference.
Saved JSON is returned verbatim rather than applying defaults/field projection
from the current generation models.
Each initial capture POST fetches fresh evidence and produces a new ID. The synchronous POST retains its
JSON response. The browser's explicit **Generate and save briefing** action uses
`POST /api/market-context/briefing-captures/stream` for bounded NDJSON progress.
One resolved Deep profile and the same collection/synthesis deadlines apply.
Only a committed record produces a final capture result; model failures retain
their original typed outcome. The stream uses detached JSON bodies and emits no
unchecked model deltas. Closing the stream cancels unfinished source/model work;
a commit that completed before disconnection is not undone. Refresh saved history
if acknowledgement was lost. There is no automatic retry or idempotency promise.

**Generate briefing** continues to produce a temporary result; choosing save
starts a separate fresh run rather than quietly resynthesizing a visible answer.
**Review saved briefings** pages through the owner's records (20 per page),
reopens the original result/evidence through the same citation viewer, and offers
plain-text original model-input inspection and confirmed deletion. Saved scope
and dates are labelled separately from the active live page. Scope changes abort
and discard late in-flight responses. Raw retained JSON is not hydrated with new
defaults; unsupported browser formats fail explicitly without changing storage.
Listing projects only selection/summary columns from JSON rather than loading
full evidence/input payloads for every row; this uses portable SQLAlchemy JSON
projection, covered by SQLite and the guarded PostgreSQL contract.

`DELETE /api/market-context/briefing-captures/{id}` explicitly removes only the
owner's capture and its embedded evidence; another owner's ID returns the same
404 as an unknown ID. It does not delete public news, text/assessment rows,
Brain or portfolio records. Account deletion cascades private captures.
No API-key scope is added; existing external note ingestion permissions do not
grant capture access.

Captures are self-contained: the exact selected headline text is retained inline,
not looked up through live URLs, public news IDs or mutable caches. There are no
shared blobs or external evidence dependencies to expire underneath a capture.
The explicit assessment API records the source capture ID/hash and selected
headline citations in independent text snapshots. It does not rewrite the saved
comparison or add assessments to its evidence/prompt; checked Deep integration
will create a new analysis with explicit retained references. News is still headline-only where the packet says so; no full article
archive or historical-knowledge claim is introduced.

Content hashes cover the complete serialized content, including generation/input
times. They identify retained contents, not cross-run semantic equality. Saved
captures have no automatic expiry. Future cleanup must preserve their embedded
inputs/results while retained; deleting a capture releases its own inline data.
A 4,000,000-byte serialized UTF-8 cap rejects oversized captures with 413 before
inserting; nothing is silently dropped. Storage errors return 503 without
claiming retention. The stream reports allowlisted `capture_too_large` or
`capture_not_confirmed` errors. Its reader permits a bounded 4,100,000-character
record including receipt metadata; legacy ephemeral stream bounds are unchanged.
Ambiguous commit/network failures can require listing captures to confirm whether
a record exists.

Additive migration `0020_comparison_captures` follows `0019_news_evidence`, changes
no existing rows and retains the new table on downgrade. SQLite migration,
restart/provider-edit, privacy, repair/dispatch and optional-source tests run
locally; migrated PostgreSQL JSON/ownership/deletion coverage runs in the existing
explicit disposable CI lane. Local PostgreSQL DDL checks are not live execution.

Next: browser selection/review and checked Deep sentiment integration, then
configurable reference-aware retention.
Browser save/review/deletion is implemented; it does not introduce a private Brain
index or shared evidence-blob lifecycle. See [Roadmap](Roadmap.md).

## Linked reruns and fresh-data refreshes

Both JWT-only follow-up endpoints take an empty JSON object `{}`. The owned source
ID comes from the path; browser-supplied prompts, evidence, settings or lineage
are rejected. Ownership, stored-content SHA-256 integrity and supported contracts
are checked before starting a stream. Unknown/other-owner IDs return 404, damaged
stored contents return 409, and unsupported inputs return 422. No migration is
needed: linkage is immutable JSON inside the existing capture envelope.

- `POST /api/market-context/briefing-captures/{id}/rerun/stream` reuses the last
  **actually dispatched** request, including any saved repair prompt, schema,
  response format and generation settings. Only its `model` field changes to
  today's resolved Deep model; the connection, credentials and deadline are
  current. It performs one checked completion, with no source collection, prompt
  rebuilding, repair, response-format fallback or token-budget increase.
- `POST /api/market-context/briefing-captures/{id}/refresh/stream` collects fresh
  evidence for the saved selection, using the current relative-period window,
  prompts, Deep profile and normal checked synthesis pipeline. It does not use
  the live page's possibly different selection.

Both return the existing NDJSON lifecycle and a committed new capture receipt.
The original stays unchanged. Each child records `lineage` in its contents and
summary: kind (`saved_input_rerun` or `fresh_refresh`), parent ID/content hash,
source generation time, replay request index (null for refresh or a prepared
request) and `model_policy: current_deep`. Each child embeds its own full evidence
and inputs. Deleting a parent leaves its children inspectable and usable; opening
the deleted source returns 404 without clearing the child review.

A rerun validates references against a typed view of the original evidence but
retains the original raw evidence JSON and scope notice, including retained
extensions. Invalid/truncated/model-error/timeout responses produce a typed
unavailable child without partial prose or automatic repair. If generation never
reaches dispatch (disabled/health failure), `generation.prepared_request` retains
the selected request with the current model so that child remains independently
rerunnable. Its actual `attempts` stay empty. An original capture with no saved
request can be refreshed but cannot be rerun. Mutable model aliases, provider
behavior and nondeterminism prevent any guarantee of identical wording or weights.

In saved review, **Re-run saved inputs** and **Refresh with current data** are
explicit separate actions. Progress, cancellation and lineage are visible.
Cancellation closes unfinished work; a commit already completed is not undone.
Refresh saved history after uncertain acknowledgement before manually retrying.
No automatic retry or idempotency guarantee is introduced. Existing generation
endpoints remain temporary; these endpoints introduce no API-key scope, private
Brain indexing, new provider or retention cleanup.

## Explicit saved-headline assessments (API)

JWT-only `POST /api/market-context/briefing-captures/{id}/sentiment` accepts one to
ten selected headline/target pairs from an owned, integrity-checked saved context:

```json
{"headlines":[{"citation_id":"C1G1H1","target_symbol":"AAPL"}]}
```

Use the actual packet-local headline ID and its news group's symbol, not a pair,
section or group ID. Targets must match that group exactly. Unknown/mismatched
references, duplicates, replacement browser text, prompts and extra fields are
rejected before scoring. Price-only/absent/unsupported evidence cannot be scored.
This endpoint reads saved headline text only: no live fetch, URL read, article
summary, legacy score or inferred historical knowledge is added. Source capture
ownership/integrity is checked before model work. Another owner's ID returns 404;
changed stored contents return 409; unsupported selections return 422.

Exact repeated selected source/target observations across pair-local copies are
scored once, with all selected local citations retained. Identity includes title,
URL, publisher, publication/retrieval times and truncation; equal URLs or text
hashes alone do not merge observations. Different targets stay distinct. Each
explicit call creates new snapshot/assessment UUIDs, including cache hits.

The 201 response is a list of retained headline records, each with exact original
title, empty summary, publication and original collection times, truncation flag,
source URL/publisher, terminal capture time and text hash. Additive optional
`origin` JSON records the source capture ID/hash and selected headline IDs. Two
independent assessments are stored per selected observation, in one transaction:

- **Keyword text tone**, `method: lexical`, `finance-keyword-tone-v1`: counts
  positive/negative finance-term substring matches, with score `(positive -
  negative) / max(1, positive + negative)`. `bullish`/`bearish` labels here mean
  positive/negative keyword tone. This engine uses no hidden FinBERT/TextBlob
  fallback and declares no target-price implication or confidence.
- **Fast asset implication**, `method: llm`, `saved-headline-asset-v1`: explicitly
  names the target in a bounded batch prompt. Scores/labels/rationales must pass
  finite-range, index, duplicate, schema and label/score consistency checks.
  It is a model opinion about the supplied headline, not measured investor
  sentiment, a forecast or proof of market impact. No confidence is fabricated.

The rubrics differ; comparing them does not establish classifier agreement or an
investment conclusion. A disabled, unreachable, timed-out or malformed model
produces a **failed** asset-implication assessment with an allowlisted code and
no score/label/rationale. Missing verdicts stay failed while valid other items are
retained. A failed model is never silently replaced by keyword tone or neutral.
The resolved Fast profile bounds health/completion/format-token retries; there is
no Deep/model escalation or semantic repair. Server-task cancellation aborts
unfinished work without inserting partial rows. This endpoint is synchronous;
a client disconnect alone can leave the request running. Storage errors roll back the whole batch and
return 503 without claiming success. A completed commit may outlive a lost reply;
list the retained records before manually retrying. No automatic retry or
idempotency guarantee is introduced.

Fast assessments retain exact title input, target/meaning/method/prompt versions,
public model identity, original completion `scored_at`, and additive optional
`generation` JSON: protocol, public profile, context hash and exact dispatched
JSON request bodies/times (including client augmentation and format/token
fallback). Connection URLs, authentication headers and credentials are excluded. The context hash covers
the versioned full batch prompt and response schema, including targets/order and
truncation; it is not a provider-receipt or immutable-weights guarantee.

A separate owner/profile/context-scoped cache stores only wholly valid Fast
batches for 15 minutes. That TTL is a scoring optimization, **not evidence
retention**. Cache hits preserve original scoring time, model inputs and context;
`reused_from_cache` is explicit, while new `recorded_at`/capture times reflect the
new write. Keyword tone is recomputed with its own scoring time. Legacy cache
entries lack provenance and are never promoted. Target, batch, prompt/schema,
profile/connection identity or exact text changes invalidate reuse. Cache failures
fall back to scoring; neither read nor write failure discards a valid retained
assessment. Cache I/O has a two-second bound, independently of the Fast deadline.

Read without source/model work through:

- `GET /api/market-context/briefing-captures/{id}/sentiment?limit=20&offset=0`:
  owner-filtered retained observations (maximum limit 100, offset 10000).
  Unknown/other-owner IDs return an empty list. Deleting the source capture does
  not remove or hide independent retained assessments.
- `GET /api/news/evidence/{snapshot_id}`: exact saved payload/assessments, including
  original scoring and recording times. Unknown/other-owner IDs return 404.

Reads return stored payload JSON without adding today's defaults. Optional JSON
fields preserve existing records; no migration, old-row rewrite or new API-key
scope is introduced. These routes remain experimental in `market-context`.
There is no automatic expiry or delete endpoint yet; each call retains up to ten
snapshots/twenty assessments. Account deletion still cascades private records.
The current browser and Deep comparison prompts do not consume these records yet;
the next slice adds explicit selection, inspection and checked references. Future
cleanup must preserve referenced evidence and define deletion/missing-source UX.
