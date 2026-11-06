# Filing evidence for comparison briefings

Status: **v2.7 synthesis slice, 2026-11-06**. The audit, internal projection,
explicit collection and checked synthesis are implemented. Browser selection
and evidence inspection remain pending. Exact SEC filing checks stay excluded.

## Coverage audit

| Existing path | Identity retained | Limits for briefing use | v2.7 decision |
|---|---|---|---|
| SEC Company Facts (`sec_filing_evidence.py`, `market_sec_facts.py`) | CIK, accession, form, filed date, US-GAAP concept, unit, fiscal start/end, value | Current aggregate; not an archived vintage or verified revision sequence. Existing inspector limits facts to 50 and difference groups/disclosures to 20/8. | Use its full normalized eligible set before briefing limits; never build model input from a capped inspector response. |
| SEC submissions cross-check (`sec_submission_evidence.py`) | Accession/form/date and optional acceptance metadata, with bounded continuation coverage | Index metadata does not establish numeric corroboration, dissemination or complete historical coverage. | Keep separate; an index match cannot upgrade a fact to historically known. |
| Exact filing check (`sec_filing_verification.py`) | Exact entity, concept, unit and duration matched against an XBRL filing instance | Explicit opt-in download, one selected claim, bounded runtime/document size; it does not establish revision order. | Do not imply this check ran merely because Company Facts supplied an accession. Automatic filing downloads are outside the first slice. |
| FMP/Yahoo PIT projection (`unified_fetcher.py`, `pit_fundamentals_service.py`, `fundamental_evidence.py`) | Metric, fiscal end, source, release date and estimated-date flag | `PitFundamentalRecord` lacks units, fiscal start and accession. The context normalizer excludes estimated dates but cannot recover the lost identity. | Exclude its numbers from the initial briefing contract; do not infer USD, fiscal duration or comparability. |
| Owner fundamental captures (`market_fundamental_captures.py`) | Retained terminal retrieval times, value sets, hashes, failures and owner boundary | Observation history starts when captured; deletion and failed captures matter. Captures do not backfill provider vintages or recover missing metric identity. | Keep owner-scoped and separate. No automatic capture, cross-owner lookup or promotion to historical market knowledge. |

The initial numerical scope is the existing four SEC duration concepts and
units: `Revenues` and `RevenueFromContractWithCustomerExcludingAssessedTax`
(kept separate), `NetIncomeLoss` (USD), and `EarningsPerShareDiluted`
(USD/shares). Only 10-K, 10-Q and their `/A` forms with finite numeric values,
valid accessions and ordered fiscal/filing dates qualify. Custom taxonomies,
IFRS, balance-sheet instants and free cash flow are outside this projection.
An unsupported or empty scope does not establish that the company has no data.

## Internal version-1 projection

`backend/services/filing_briefing_evidence.py` is a deterministic, network-free
builder. Its caller must first resolve the exact ticker to a unique CIK and
fetch the matching aggregate. The builder checks CIK identity, a normalized
symbol, a timezone-aware terminal retrieval time and an ordered filed-date
window of at most 730 days ending no later than retrieval's UTC date.
Cached client responses may be up to 30 minutes old: terminal retrieval time
is not the SEC's publication time or a guarantee of a fresh upstream download.

The packet retains the symbol, CIK, selected filed-date window, retrieval time,
explicit source, schema version and SHA-256 fingerprint. It fixes historical
availability and revision order to `not_established`. It includes no acceptance
instant, valuation multiple, estimated release date, derived growth rate or
inferred latest truth.

Facts group only by exact concept, unit, fiscal start and fiscal end. The full
eligible set in that filed-date window is examined before output limits:

- Identical facts are deduplicated. One common value across accessions remains
  one group with the contributing disclosure identities.
- Different values anywhere in a group withhold its numerical value. Differing
  filing metadata for one accession also withholds the value. Later accessions
  or an amendment form never silently win.
- Conflict and total group counts cover all eligible groups, including omitted
  ones. This cannot detect disagreements outside the requested filed-date
  window or records absent from the provider response.
- Return at most eight groups and three disclosure identities per group, with
  exact omitted counts. Most recent filed groups appear first for bounded
  presentation; that ordering does not establish revision priority.
- Each group has a packet-local `F#` reference and generated SEC filing links.
  Only `available` groups with a value can become numerical evidence. Conflict
  references can explain limitations, not support an asserted metric value.
- The normalized source-record digest covers omitted values too. Changes to
  those values therefore change the packet fingerprint even when the visible
  groups and counts remain identical. No raw provider strings enter the packet.

`available` means at least one usable displayed group with no conflict or output
truncation. `partial` retains usable displayed values alongside conflict or
truncation. `empty` has no usable displayed values, including an all-conflict
selection. Conflict counts distinguish that case from no matching facts.
`unavailable` carries a closed configuration/coverage/ambiguity/provider/timeout
reason and no values. Exceptions and arbitrary provider URLs are not failure
messages. These states describe the projection, not complete SEC coverage.

## Integration sequence

1. **Completed, #259:** coverage audit, pure projection and regression tests.
2. **Implemented:** explicitly selected fundamentals on the evidence endpoint,
   bounded per-symbol fetches, pair-window linkage, cancellation and a versioned
   outer envelope. Generated API documentation reflects the exposed schemas.
3. **Implemented:** prompt, reference validation and bounded repair support
   selected filing evidence in synchronous and streaming context synthesis.
   See the checked-interpretation contract below.
4. **Browser journey and acceptance:** opt-in selection, scope changes cancelling
   stale results, inspectable values/units/durations/accessions and conflict/gap
   states; deterministic browser regression checks and maintainer feedback.

These are reviewable boundaries, not a required PR count. No full archival
reconstruction, provider expansion, automatic filing corroboration, frontend
overhaul or v3 technical thesis validation is included. The audit does not claim
live provider or model-quality testing; fixtures establish the local contract.

## Evidence endpoint and collection limits

`POST /api/market-context/briefing-context-evidence` requires the existing user
JWT and accepts selections only, for example:

```json
{"anchor":"AAPL","comparisons":["SPY","BTC-USD"],"period":"1M","context":{"fundamentals":true}}
```

The existing context endpoint returns outer `schema_version: "2"` when
fundamentals are selected, and version 1 otherwise. A false/omitted selection
does not fetch SEC data and is omitted from the serialized context-options
object, preserving the version-1 packet shape/fingerprint behavior. The nested
price packet and its price-only exclusions are unchanged.

Each selected pair has a `kind: "fundamentals"` section linked to its P#.
Assets retain the complete bounded version-1 filing snapshot without modifying
its hash. `group_citations` maps its local F# to an outer reference such as
`C1A1F1`; those mappings are unique across pairs and assets. Original F# names
remain local to the nested snapshot. Exact filing checks stay excluded even
when aggregate filing facts are selected.

The collector resolves each unique symbol once and fetches Company Facts only
after an unambiguous CIK match. It projects that aggregate separately for each
distinct pair window. No-window pairs never fetch filing data. There are at most
seven SEC symbol jobs, sharing the existing three-job concurrency limit, 12s
per-source budget and 40s context budget with selected news/macro sources.
The prior 45s price preparation budget remains separate. Completed assets survive
other jobs' failures/timeouts; cancellation joins pending work. Request-local
deduplication adds no persistence; the existing SEC client cache still applies.

Missing `SEC_USER_AGENT`, non-covered symbols (including crypto), ambiguous
ticker mappings, empty eligible facts, malformed responses, provider failures
and timeouts remain distinguishable. Provider exception strings are not returned
or logged. These paths perform no synthesis, filing-instance download, capture
write, private-source read or indexing.

## Checked interpretation

`POST /api/market-context/briefing-context` and `/briefing-context/stream` now
accept the same `context.fundamentals: true` selection. They require the existing
user JWT, prepare a fresh server comparison, collect selected context and invoke
the existing Deep profile. The current browser cannot select fundamentals yet.

Only available, non-conflicting numerical groups enter the usable reference
index, under their mapped C#A#F# IDs. Each use in possible context or a hypothesis
must include its exact linked P#. Nested F#, filing URLs, accessions, sections,
asset references and failed/conflicted groups cannot support numerical context.
Price observations still cite only available price pairs. Each filing asset with
usable groups must contribute at least one such reference in possible context
or a hypothesis, so a completed answer cannot silently ignore selected evidence.

Every selected section and filing asset is required in limitations, including
unavailable assets. Conflicted groups and groups with omitted disclosures are
also required in limitations. Empty/failed groups remain explicit in limitations
or unknowns. Asset-level scope includes omitted group counts and conflicts beyond
the display cap. The rules do not require a particular causal or business claim.

The selected-only filing prompt asks for conditional business implications,
alternatives and further evidence, while distinguishing fiscal measurement
periods, filed dates and retrieval time. It prohibits inventing withheld numbers,
growth rates, currency conversions or valuation ratios; it does not infer revision
priority, historical investor knowledge or cross-issuer comparability. Structural
reference validation does not verify those semantic claims or reasoning quality.
Current Company Facts remain distinct from an exact filing-instance check.

The same version-2 evidence packet is retained across the existing single bounded
repair. Diagnostics allow only known codes, schema paths and bounded reference
names through C30 and F8; rejected prose is never echoed into repair feedback or
streamed as a completed result. The existing input/response ceilings, 6,400-token
completion ceiling and resolved model deadline remain unchanged. Missing coverage
does not become fabricated evidence. Model failures retain the collected packet
with no completed interpretation; disconnect cancels collection or inference.
No snapshot persistence, automatic capture, private indexing or new model setting
is introduced. Browser inspection and maintainer feedback remain the next gate.
