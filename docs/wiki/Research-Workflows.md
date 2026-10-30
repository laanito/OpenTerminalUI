# Research workflows

This guide covers the shipped v2.1 research journey: compare market context,
inspect selected SEC evidence, ask questions of private notes, and save an
answer without turning generated prose into an unquestioned source. It does
not describe automatic trading or a complete historical archive.

## Cross-market context

Open **Market context** from equity research, the Security Hub or crypto detail.
The contextual page is `/equity/market-context`, distinct from the older
`/equity/compare` chart comparison. Select an anchor, choose a one-, three- or
six-month window, and add market proxies through ticker suggestions.

Inspect actual shared-close dates, sources, quote units and overlap before
interpreting return differences. The main indexed path uses actual shared
dates, not interpolated observations. Crypto weekends, exchange timezones and
price-adjustment coverage can change what a comparison means. Separate
exchange-local, Yahoo-adjusted and reporting-currency views do not replace the
primary native-quote result; unavailable evidence stays unavailable.

Request optional news, fundamentals, technical, calendar or macro evidence
independently. These panels can fail without invalidating an available price
comparison. US FRED observations require `FRED_API_KEY`; the bounded euro-area
Eurostat/ECB context is keyless. Macro reference months are not publication
dates, and global observations are not automatically relevant to a ticker.

The page supplies descriptive context, not causation, a recommendation or an
automatically selected relationship. See [Limitations](Limitations.md) for the
evidence contracts and [Surface Inventory](Surface-Inventory.md) for its
experimental classification.

## Check a selected SEC fact

The host must set `SEC_USER_AGENT` to identify its application/operator and a
real contact email, for example `OpenTerminalUI operator@example.com`. This is
identification, not a paid provider key. Compose passes it to the backend;
recreate the backend after changing its environment. The
[environment template](../../.env.example) includes the setting.

1. Open an equity comparison and request its SEC filed facts.
2. Choose **Check source filing** under a fact or same-period differing
   disclosure. Opening the facts panel alone does not run these checks.
3. Inspect selected and observed values, exact fiscal period, unit, form and
   accession. Follow **Open SEC filing** or **Open XBRL source** for evidence.
4. Read the outcome and check time. **Check again** or **Retry source check**
   starts a fresh check; **Refresh SEC facts** handles claims no longer present
   in the current Company Facts response.

The JWT-authenticated API is `POST /api/market-context/sec-filing-fact-check`.
It rechecks exact ticker/CIK identity and current aggregate membership, then
reads the official filing index and its listed XBRL instance. XBRL is the
machine-readable tagged financial data accompanying a filing. Coverage is
bounded to selected standard US-GAAP concepts and 10-K/10-Q forms, including
amendments, with document-size and parsing limits.

**Corroborated** means the checked instance supports the value for the exact
company-wide concept, unit and fiscal duration. Differing or conflicting values,
no exact fact, unsupported format, unreadable data, missing identity/configuration
and provider failure have distinct results. A failed check leaves the original
claim unverified, not disproved. An index entry alone is not corroboration.

Checks may take up to a minute. The browser allows 60 seconds for a backend
operation bounded to 45 seconds; unmounting cancels the browser request.
Focus/reconnect events do not silently re-run it. SEC acceptance metadata may
be unknown and is not proof of dissemination time. No outcome establishes
revision order or what investors knew at a past trading time.

## Ask the private Second Brain

Capture sources in **Notes** (`/equity/notes`), **Journal** (`/equity/journal`),
or Portfolio Manager's thesis and holding/transaction note fields. Set a Note's
effective date when information applies to a different time than capture.
Ingestion time is not source time.

Open **Second Brain** (`/equity/brain`), inspect indexing status, select source
types if needed and ask a question. Incremental indexing is queued after note
writes; a successful save does not mean the text is already embedded. Manual
reindexing exposes progress and final chunk counts.

In v2.4 development, Brain answers use the configured Deep generation model;
with Deep unset they use the existing model and show **Default profile (Deep not
configured)**. The selected profile/model appears during retrieval and on the
answer. Brain Log saves retain the actual model through the existing provenance
fields; older saved entries remain unchanged. Generation settings do not change
embeddings, retrieval ranking or trigger a reindex.

The stream announces its operation deadline before retrieval: the selected model
timeout plus a 120-second preparation allowance. Synthesis, including same-model
non-streaming fallback, also has its own model-timeout bound. The browser adds 15
seconds of margin; heartbeats do not extend it. **Cancel** discards provisional
text and stops provider work. Closing the page also cancels the browser request.
An interrupted stream requires manual retry rather than a second automatic
inference. Model failure retains retrieved sources and shows a degraded result;
partial, failed and retrieval-only answers cannot be saved as model syntheses.
`POST /api/brain/ask` remains available for non-streaming API consumers; both
browser ask helpers use the cancellable stream contract.

Retrieval considers semantic relevance before applying a bounded recency signal.
Dated citations distinguish current views from previous theses. Chronology helps
synthesis handle conflicts, but does not prove a newer note is correct or
formally supersedes every older source. Model availability and quality still
matter. The [retrieval evaluation guide](Brain-Retrieval-Evaluation.md) describes
read-only evaluation against a private corpus.

Brain retrieval uses the owner's recorded research, including deliberate
external-note imports. Comparison evidence panels do not automatically become
its corpus or a unified cross-market AI explanation.

## Save an answer in the Brain Log

Choose **Save answer** after synthesis completes. A memo preserves the question,
answer, source scope, dated citation/content snapshots and model provenance.
Title, tags, annotation, symbol and pin state can be organized; the synthesis
snapshot is immutable.

Opening a memo compares cited chunk identities against current source records
and marks matching, changed, unavailable or unverifiable evidence. It does not
rewrite the answer or fact-check its conclusions, and does not require a
completed reindex.

Memos stay out of retrieval by default. **Promote to Note** opens a separate,
editable draft for review and confirmation; only that Note becomes evidence
and retains its source-memo link. Theses and Journal remain user-owned records,
not automatic destinations for generated answers.

JWT-authenticated clients use `/api/brain/memos`, including per-memo
`/evidence-status` and `/promote-to-note` operations. Use the generated schema
for exact payloads; external-note keys do not grant general Brain access.

## External note ingestion

In **Settings → API Keys**, create a key with **Read + external notes**
(`read_write`) permission. Save its secret when shown. Provider credentials
and SEC identification are managed separately on the host.

```bash
curl -X PUT http://localhost:8000/api/v1/notes/external \
  -H "X-API-Key: otui_..." \
  -H "Content-Type: application/json" \
  -d '{
    "source": "youtube",
    "external_id": "video-example-001",
    "title": "Selected video summary",
    "body": "Summary, source URL and key points selected for private research.",
    "effective_at": "2026-10-18T14:30:00Z",
    "tags": ["youtube", "hermes"]
  }'
```

The same owner, `source` and `external_id` update the same note on retries.
`source` allows up to 16 URL-safe characters, `external_id` up to 38, and `body`
up to 10,000. Supply a timezone-aware `effective_at` when known rather than
treating arrival time as publication time. Successful writes schedule normal
incremental indexing. This is deliberate ingestion, not an automatic crawler
or general MCP interface.

## Keep execution records and interpretation separate

Portfolio transactions are the ledger for quantities, cash, fees and currencies.
Journal records strategy, rationale, emotions and review; today it does not
automatically create or match Portfolio transactions. Selecting executions and
creating missing ones from Journal is an unscheduled [roadmap bridge](Roadmap.md).
A Brain memo is a dated synthesis, not an execution record.

## API reference

### Comparison evidence preparation API

JWT-authenticated `POST /api/market-context/briefing-evidence` accepts
`{"anchor":"AAPL","comparisons":["SPY"],"period":"1M"}`. It fetches a fresh
server comparison, not the page's earlier result, and projects only shared-UTC
native provider-close returns. Browser-supplied values, prose and unsupported
fields (including reporting currency) are rejected. Preparation has a 45-second
deadline; a timeout returns HTTP 504 with `evidence_timed_out`, not a partial
success packet.

The response includes a schema version, content fingerprint, retrieval time,
available/partial/unavailable status and `P1`–`P6` pair citation records. Each
keeps its actual window, exact returned metrics, source/feed, quote unit,
freshness, reported basis and caveats. IDs are local to that packet; its hash is
not an authenticity signature, persisted archive or historical knowledge claim.

The explicit `not_included` list covers optional news, fundamentals, SEC checks,
macro, technical measures, FX/adjusted/local-date views and private research.
Exclusion does not establish that evidence is absent or that a provider failed.
The preparation endpoint generates no answer. Separate generation APIs below
now build on that contract; nothing is persisted or indexed.

### Comparison briefing APIs

JWT-authenticated `POST /api/market-context/briefing` accepts the same selection
and returns a complete or unavailable result. `POST /api/market-context/briefing/stream`
uses the same body but returns newline-delimited JSON lifecycle events. These
calls prepare fresh server evidence themselves; they do not accept a client
packet, reuse an earlier page response or run other optional panels.

The stream sends `start` with `deadlines.evidence_seconds` and
`deadlines.model_seconds`, `progress` (preparing evidence, checking the model,
generating, validating or retrying), then a final `result`; unexpected failures
produce an `error` event. It does not expose raw token deltas. Closing the stream
cancels preparation/inference. Completion-only providers are supported, without
requiring their token-streaming capability.

The final result contains `observations`, `limitations` and `unknowns`, each with
per-statement `citation_ids`, plus the exact evidence snapshot and fixed scope
notice. Pair IDs resolve inside that packet. `SCOPE` refers only to its method,
basis and `not_included` metadata, never an independently checked provider panel.
Structure, packet identity, reference existence and pair-reference coverage are
validated. **These checks do not verify the truth of model prose**, its arithmetic
or its compliance with no-advice/no-causation prompt rules. The response says
`references_only_not_fact_checked`; inspect its source values and mandatory
packet caveats rather than reading a completion as a verification badge.

All-unavailable comparisons skip inference. Disabled, unreachable, failed,
malformed and timed-out model work produce `status: unavailable`, empty prose
arrays and a typed failure; available evidence is retained, not erased. A
preparation timeout has no packet to retain. The generation endpoints return
expected unavailable states as HTTP 200 results, unlike the preparation-only
endpoint's HTTP 504 on its own deadline. Health, completion and one repair share
the resolved profile's deadline: `LLM_DEEP_TIMEOUT_SECONDS` when configured,
otherwise `LLM_TIMEOUT_SECONDS` (default 240 seconds), after up to 45 seconds of
evidence preparation. Clients must allow both stages; heartbeats do not extend
the server budget. Selected context adds its separately announced collection
budget. No rejected/partial answer is published as a completed briefing.

In v2.4 development, comparison synthesis uses Deep when configured. With Deep
unset it uses the existing model and shows **Default profile (Deep not configured)**;
otherwise the result shows **Deep profile** and the selected model. A Deep failure
never retries Fast. The additive `model_profile` response metadata identifies
the selected configuration, even when evidence preparation failed or inference
was skipped; it does not certify that the model ran or that its reasoning is
better. Shared insight cards and Brain synthesis also use Deep. Filing-analysis
routing remains a separate follow-up.

Stock briefings and Interrogate now use `POST /api/ai/insights/stream` from their
browser cards, alongside risk, backtest and collection/market outlooks. The
native GET/POST APIs remain available. The stream announces the model/profile
and an overall model-timeout-plus-60-second preparation budget; clients add 15
seconds of transport margin. Heartbeats do not extend it. Only the final
validated summary/sections are displayed; token progress is provisional.
Interrupted streams require manual retry and never automatically replay a GET
or POST inference. Research cache keys distinguish model/provider configuration;
Interrogate remains owner/note-version scoped and Regenerate bypasses cached
prose. Model failures remain explicit on the selected profile.

### Interpretations to investigate (v2.4 development)

Following host feedback on 2026-10-29, both briefing modes add a separate
`hypotheses` section. Each item explains what an observed pattern could mean,
a possible mechanism, a competing explanation and specific evidence that would
help distinguish them. Observations remain factual; conditional economic
reasoning belongs in hypotheses. The model may use general reasoning to explain
a channel, but may not turn missing company facts, expectations, flows or events
into observations. Prices alone do not establish business exposures, and single
macro levels do not establish changes, surprises or a market regime.

The UI labels these interpretations as model hypotheses. Citation buttons open
the observed inputs, not proof of the proposed mechanism. Every hypothesis
requires an available price pair; context citations must identify an actual
usable headline/series together with its linked pair. Sections, failed sources,
SCOPE and unavailable pairs cannot serve as hypothesis evidence. Completed
generation requires 1–3 hypotheses with all four parts; expected failure states
return none. Structural/reference checks still cannot judge causal truth or
whether the interpretation is useful. See the
[briefing evaluation guide](Briefing-Evaluation.md) for human acceptance cases.

### Browser comparison briefing

On **Cross-market context**, apply the anchor, proxies and window with
**Compare dated moves**, then choose **Generate briefing**. It is always opt-in;
opening the page, focusing the window or reconnecting does not run the model.
The request fetches its own fresh native-quote/shared-UTC snapshot. Optional
panels and reporting-currency views are not included, even when visible.

Progress reports the preparation, generation and reference-checking stages, not
raw model tokens. **Cancel briefing** discards the run. The browser allows the
server-announced preparation and model budgets plus 15 seconds of transport
margin; absent response headers have a five-minute limit. Heartbeats do not
extend deadlines. Failed/interrupted runs require a deliberate manual retry;
there is no automatic second model run or fallback to a different snapshot.

Completed observations, limitations and unknowns are plain text. Click a pair
citation or `SCOPE` to open and focus its evidence in **Inspect briefing evidence
snapshot**: exact returned numbers, pair window, source/unit/basis metadata,
freshness, exclusions and snapshot identity. Material source caveats remain
visible outside the inspector. References are checked, not prose truth; inspect
values and caveats yourself. Expected unavailable results retain the packet when
one exists but have no model prose. A preparation timeout has no packet.

Editing any selection field, including window or reporting currency, clears old
results and cancels active work. Apply the new selection before generating again.
Starting a fresh run also removes the previous answer immediately, including if
the new run fails. There is no Save/Brain Log/indexing action. The maintainer
accepted the live workflow on 2026-10-21, and v2.2.0 was published that day.
The configured model influences prose quality; reference checks
do not compensate for weaker reasoning, and model tuning remains later work.

### v2.3 optional context briefing

The comparison briefing now offers a **Briefing evidence scope** fieldset.
Keep all options off for the original price-only briefing, or independently
select **Dated news headlines**, **US macro (FRED)** and **Euro-area macro
(Eurostat/ECB)** before generating. Regions are not inferred from tickers;
visible optional panels never implicitly inform the answer. Changing scope or
comparison cancels/clears previous work without automatically running a model.

Selected-source coverage stays visible alongside the answer, including partial,
empty, failed, missing-key, timeout and no-price-window states. **Possible
context** is distinct from **Observed movement**, limitations and unknowns.
Click a citation or coverage link to open and focus its exact section, group,
headline or macro series in the returned snapshot. Inspect source links,
publication times, reference periods, units, flags, coverage counts and caps.
The scope section distinguishes the outer context snapshot from the nested
price-only packet, whose exclusions do not describe the entire context answer.
Model failure retains evidence but no prose; an interrupted stream requires a
manual retry and never automatically incurs another model run.

Separate JWT-authenticated endpoints accept explicit context selection:

- `POST /api/market-context/briefing-context-evidence`: prepare evidence only.
- `POST /api/market-context/briefing-context`: prepare and synthesize.
- `POST /api/market-context/briefing-context/stream`: progress and a checked final
  result, not unchecked model tokens. Disconnect cancels work; never replay
  automatically after interruption.

For example, use the following body with a browser-user bearer JWT (not an
external-note API key):

```json
{"anchor":"AAPL","comparisons":["SPY"],"period":"1M","context":{"news":true,"macro_regions":["us","euro_area"]}}
```

Choose at least one source; omit unneeded sources/regions. Regions are explicit,
not inferred from symbols. Existing `/briefing-evidence`, `/briefing` and
`/briefing/stream` reject context fields and retain their price-only contracts.

The new envelope retains the original price packet and separately selected
per-pair context. A selected but unprepared source is unavailable, not an empty
successful search; a pair without price overlap has no invented context window.
Headlines carry dated source links, coverage and at most five items per symbol;
macro series preserve units/flags and at most 24 most recent returned observations
per series, with original counts retained. A monthly macro reference period can
begin before the pair's first daily observation; it is not a publication date.
Only current-at-retrieval macro views are supported by this initial contract.

Section/group/item references are local to the complete fingerprinted envelope,
not cross-request identifiers or fact-checks. News is untrusted source text and
current feeds do not establish complete historical coverage. Macro is global
context, not issuer-specific relevance or causal attribution. Synthesis separates
price observations, possible context, hypotheses, limitations and unknowns. Possible context
requires an available headline/series plus its linked pair; selected sections,
missing inputs and material truncation/withholding/flags must be disclosed.
These are structural checks, not semantic verification of the model's reasoning.

Price preparation has 45 seconds, followed by up to 40 seconds for context with
12-second source jobs and at most three concurrent jobs. Identical macro
region/window queries share a fetch within the operation. Optional failures
retain completed sources and prices. Model health, completion and one repair
share the configured model deadline. The serialized evidence input cap is
120,000 characters, with explicit `evidence_too_large` rather than silently
discarded sources; the initial completion budget is 6,400 tokens (3,200 for price-only)
to accommodate the interpretation section. The existing client can retry a
truncated response at 6,144 tokens when the initial budget is lower. All requests,
including repair, share the selected profile's whole-operation deadline. Typed model
failures return the entire packet and no prose. The stream's start event reports
price/context/model budgets; `collecting_context` is a progress phase.

Context generation receives a server-derived checklist of allowed references,
source-to-pair links and required coverage, rather than having to infer every
obligation from nested evidence. A failed validation logs the mode, attempt,
short snapshot ID and a safe code such as `response_structure`,
`context_limitations`, `context_missing_inputs` or `context_source_pair`.
The existing single repair receives that reason plus known schema paths and
required server IDs; rejected model prose, arbitrary extra-field names and
provider errors are not echoed into logs or repair prompts. These diagnostics
do not relax checks or establish that a model-quality issue has been resolved.

Browser unit tests and deterministic desktop/narrow Chrome journeys cover the
scope, source inspection and degraded paths. On 2026-10-27 the maintainer confirmed
price-only works and combined news/macro completed after its bounded repair;
the first attempt logged a source/pair reference violation. The fast model's
shallow synthesis remains a quality limitation, not another v2.3 feature gate;
Fast/Deep task routing is approved for v2.4. Successful completion is not semantic
verification or a claim that every degraded host case was manually tested.
Release PR #229 passed all three CI jobs and merged; after explicit maintainer
authorization, v2.3.0 was published from `3fb7de3` on 2026-10-28.
Fundamentals, technicals, private research and saving remain excluded.

### Complete contract

The backend serves Swagger UI at `/docs` and its schema at `/openapi.json`.
The checked-in [API reference](../API_REFERENCE.md) and
[OpenAPI JSON](../openapi.json) include authentication and surface classification.
Use each operation's JWT or scoped API-key contract; a notes-ingestion key is
not permission to call arbitrary browser APIs.
