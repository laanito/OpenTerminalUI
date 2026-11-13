# Durable news evidence — v2.8 foundation

Status: v2.8 storage/capture foundation, 2026-11-13. The existing news APIs and
scorers do **not yet write the text/assessment tables**. Explicit comparison
capture now stores its own complete evidence/results inline; existing comparison
generation endpoints remain ephemeral. Browser save/review, captured-input reruns,
retention UX and headline-sentiment integration remain future work. This contract
supports repeatable evidence; it does not promise identical model prose.

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
There is no public endpoint in this increment.

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
against privileged SQL. There are no update/delete HTTP surfaces in this increment.
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
Each new POST fetches fresh evidence and produces a new ID; there is no
captured-input rerun or parent-run linkage yet. The browser still uses existing
generation endpoints and does not yet offer this save flow. This API uses a
synchronous JSON response, not a new progress stream. Transport disconnection
does not prove that a synchronous server operation stopped or did not save;
there is no automatic retry or idempotency promise.

`DELETE /api/market-context/briefing-captures/{id}` explicitly removes only the
owner's capture and its embedded evidence; another owner's ID returns the same
404 as an unknown ID. It does not delete public news, text/assessment rows,
Brain or portfolio records. Account deletion cascades private captures.
No API-key scope is added; existing external note ingestion permissions do not
grant capture access.

Captures are self-contained: the exact selected headline text is retained inline,
not looked up through live URLs, public news IDs or mutable caches. There are no
shared blobs or external evidence dependencies to expire underneath a capture.
They do not yet link separate text snapshots/assessments; that comes with sentiment
integration. News is still headline-only where the packet says so; no full article
archive or historical-knowledge claim is introduced.

Content hashes cover the complete serialized content, including generation/input
times. They identify retained contents, not cross-run semantic equality. Saved
captures have no automatic expiry. Future cleanup must preserve their embedded
inputs/results while retained; deleting a capture releases its own inline data.
A 4,000,000-byte serialized UTF-8 cap rejects oversized captures with 413 before
inserting; nothing is silently dropped. Storage errors return 503 without
claiming retention. Ambiguous commit/network failures can require listing captures
to confirm whether a record exists.

Additive migration `0020_comparison_captures` follows `0019_news_evidence`, changes
no existing rows and retains the new table on downgrade. SQLite migration,
restart/provider-edit, privacy, repair/dispatch and optional-source tests run
locally; migrated PostgreSQL JSON/ownership/deletion coverage runs in the existing
explicit disposable CI lane. Local PostgreSQL DDL checks are not live execution.

Next: browser save/review and captured-input rerun versus linked refresh,
selected-headline sentiment/assessment integration, then configurable
reference-aware retention and deletion UX. See [Roadmap](Roadmap.md).
