# Filing evidence for comparison briefings

Status: **v2.7 first slice, 2026-11-06**. This audit and the internal projection
are implemented; provider orchestration, model use and browser controls are not.
The released briefing still excludes fundamentals and SEC filing checks.

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

1. **This slice:** coverage audit, pure projection and regression tests. Existing
   inspectors, generated API artifacts and briefing selections remain unchanged.
2. **Provider and envelope integration:** explicitly selected fundamentals,
   bounded deduplicated per-symbol fetches, pair-window linkage and cancellation;
   preserve missing keys, non-covered symbols and failures. Add a versioned outer
   context shape and collision-free pair-linked references. The nested price
   packet remains unchanged. Expand generated API docs when exposing schemas.
3. **Checked synthesis:** extend prompt, reference validation and bounded repair
   together. Require source/pair references and material coverage limitations.
   Distinguish fiscal measurement periods, filing dates and today's retrieval;
   avoid historical causation, presumed revisions or unsupported cross-company
   comparisons. Structural citation checks do not verify prose truth.
4. **Browser journey and acceptance:** opt-in selection, scope changes cancelling
   stale results, inspectable values/units/durations/accessions and conflict/gap
   states; deterministic browser regression checks and maintainer feedback.

These are reviewable boundaries, not a required PR count. No full archival
reconstruction, provider expansion, automatic filing corroboration, frontend
overhaul or v3 technical thesis validation is included. The audit does not claim
live provider or model-quality testing; fixtures establish the local contract.
