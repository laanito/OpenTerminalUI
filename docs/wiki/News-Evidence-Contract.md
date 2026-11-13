# Durable news evidence — v2.8 foundation

Status: storage foundation only, 2026-11-11. The comparison briefing, news APIs
and scorers do **not yet write these records**. Saving/reopening comparisons,
retention UX and headline-sentiment integration remain future v2.8 work. This
contract supports repeatable evidence; it does not promise identical model prose.

## Existing paths and provenance gaps

| Path | Current storage | Limits for reproducibility |
|---|---|---|
| `bg_services/news_ingestor.py` | Installation-wide `news_articles`, unique URL, baseline score | Repeated URLs are skipped. Scoring precedes title/summary storage truncation, so the stored text may differ from the scored input. No per-score method/model/version/scoring timestamp. |
| `api/routes/news.py` | DB-backed lists or cached live fallback | Live fallback items are not automatically inserted. Missing baseline scores may be calculated on read without a write. |
| `services/llm_sentiment.py` | Short-lived per-text/profile cache | No durable assessment or original scoring timestamp. Its existing trader-oriented prompt infers an asset implication, rather than measuring investor sentiment. Target asset is not explicit in that cache identity. Confidence is heuristic. |
| Comparison headline collector and synthesis | Bounded response/evidence packet | Live headlines and generated answers are not automatically saved. A response fingerprint is not durable storage. |

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

Next: persist complete bounded comparison selections/evidence, rendered model
input and result/failure with generation metadata; build owner-scoped replay,
separate captured-input rerun/current-data refresh, then connect selected-headline
sentiment to checked Deep interpretation. See [Roadmap](Roadmap.md).
