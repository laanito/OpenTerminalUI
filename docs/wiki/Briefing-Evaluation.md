# Model-profile and briefing interpretation evaluation

## v2.4 acceptance record

All twelve generation tasks now use explicit Fast/Deep profiles. By 2026-10-31,
the maintainer had merged and host-tested each integration below. This establishes
operational acceptance; it does not supply measured latency, model identifiers,
or a controlled comparison of answer quality.

| Integration | Recorded host feedback | What this establishes |
|---|---|---|
| Comparison Deep routing, #232 | Different model used correctly; briefing used Deep | Configured routing worked on the host. Initial prose was too descriptive. |
| Comparison hypotheses, #233 | “this works better” | Initial interpretation improvement accepted after the descriptive-output feedback. |
| Shared Deep insights, #234 | “working as intended” | Shared insight integration accepted operationally. |
| Brain Deep synthesis, #235 | “works as intended” | Brain integration accepted operationally. |
| Filing Deep extraction/provenance, #236 | “works as expected” | Experimental filing integration accepted operationally. |
| Fast sentiment, emotion and query intent, #237 | “worked as intended” | Final Fast integration accepted operationally. |

No new feature or model deployment is needed to finish this evaluation. The
remaining assessment uses the operator's configured models and existing data;
the automated release gate remains a separate check.

## Representative Fast/Deep review

Use a small sample with inspectable inputs rather than an exhaustive benchmark
of every task. Reuse completed host examples where the inputs and answer are
available; do not rerun merely to fill a table. Profile labels alone do not
establish that a model is fast or capable.

| Sample | Review against the actual supplied inputs |
|---|---|
| Fast headline batch | Bull/bear meaning and rationale match the visible headlines; absent facts are not invented; lexical items stay labelled. |
| Fast query classification | The requested chart, quote table or screener action matches the question; failures remain explicit and no Deep request is added. |
| Deep comparison | Interpretation adds a conditional mechanism, a distinct competing account and useful follow-up evidence; citations point to the relevant observed inputs. Use the cases below. |
| Deep Brain answer | Current evidence outweighs superseded claims appropriately, sources support the answer, and missing/conflicting information remains visible. |
| Deep risk or Interrogate | Interpretation uses the supplied portfolio/research facts, names concrete uncertainty and avoids inventing positions or evidence. |

For each reviewed example, record the task, displayed model/profile, input or
evidence identity, a brief usefulness/source-fidelity finding, and elapsed time
if measured. A rough operator estimate is useful but must be labelled as such.
Unknown timing stays unknown. Include whether an answer came from a cache or
required repair when known; warm/cache hits are not generation benchmarks.
Keep private corpus text, credentials and endpoint details out of public records.

Completion requires representative host feedback on usefulness, source fidelity
and acceptable waiting time, with any material defect fixed or explicitly
deferred by the maintainer. Current feedback accepts functionality and the initial
comparison improvement; broader quality/latency findings are still pending.

## Comparison interpretation background

This is the v2.4 human acceptance guide for briefing usefulness. The maintainer
confirmed on 2026-10-29 that comparison routing selected the configured Deep
model, but found its summary too descriptive. The approved follow-up introduces
explicit hypotheses rather than treating a larger model or valid citations as
proof of useful reasoning. After merging #233, the maintainer reported “this
works better”, accepting the initial interpretation improvement. This is host
feedback, not an exhaustive run of the scenarios below or a cross-model benchmark.

## What a useful answer contains

Keep factual observations and selected source context inspectable. The separate
**Interpretations to investigate** section contains 1–3 focused hypotheses, each
with an interpretation, a possible mechanism, a competing explanation and
specific evidence that would distinguish them. Citations anchor the observed
inputs; they do not prove the mechanism or the truth of any model reasoning.

General economic reasoning may supply a conditional mechanism. It cannot supply
unobserved earnings, sector labels, flows, expectations, events or historical
investor knowledge. No predictions, recommendations or established causal
attribution are introduced. Missing context must not become evidence of absence.

## Representative cases

Use available instruments and actual supplied observations. The examples below
are hypothetical review scenarios, not market reports or expected model scripts.

| Case | Useful interpretation | Reject or revise |
|---|---|---|
| Two stocks diverge over a comparable window; selected news/macro context is similar | Explain why common context may leave company-specific differences or different exposures worth investigating. Describe a concrete conditional channel, an alternative, and company evidence that would distinguish them. | Merely repeat the return spread; assert earnings or sector membership absent from the packet; assume similar headlines imply identical economic exposures. |
| Crypto declines while several supplied macro observations increase | Discuss a conditional growth/policy/financial-conditions channel and an instrument-specific competing account. Check that the series actually show changes over relevant periods. Ask for timing/expectations or missing crypto evidence where needed. | Treat a rate level as tightening, CPI levels as an inflation rate, or rising unemployment as improving employment; assert the macro observations caused the decline. |
| Macro has only one observation per series | Explain that trends and surprises cannot be inferred; make the economic relationship conditional and identify the prior values and timing needed to assess it. | Announce a tightening cycle or a growth regime from single levels; pretend reference dates establish release dates. |
| Price-only selection or selected sources fail | Explain what relative performance establishes, offer a bounded conditional interpretation, and name missing inputs needed to discriminate explanations. | Invent news/fundamentals or imply failed feeds prove no relevant events occurred. |
| Contradictory evidence, unmatched windows or stale/unverified prices | Incorporate those tensions into the alternative/interpretation, with specific limits on cross-asset comparison. | Force a single narrative; rank incompatible windows; hide source/basis/freshness failures. |

## Review and record

For each case, record the model/profile, packet ID, actual pair windows, selected
sources and their coverage, total generation time (including repair), and the
answer or a screenshot. Compare models against the same saved packet when
assessing model quality; fresh UI generations may collect different evidence.
Never include credentials or private unrelated research in review artifacts.

Assess each answer on these questions:

- Does it explain a concrete channel and something meaningful about this
  particular pattern, beyond rephrasing the table or generic uncertainty?
- Are numbers, directions, units, dates and coverage faithful to the packet?
- Does it keep hypotheses conditional and distinguish observed inputs from
  assumptions, expectations and missing evidence?
- Is the competing account plausible and different from the main interpretation?
- Would the proposed follow-up evidence actually distinguish the accounts?
- Do citations open the exact inputs being discussed, without implying proof of
  a mechanism? Are latency, cancellation and failure behavior acceptable?

Reject invented facts, recommendations, asserted causation or wrong inputs even
if the prose is persuasive. Revise vague interpretations and generic alternatives
even when every citation resolves. A useful price-only answer can be shorter
and more limited than one with relevant selected context.

Deterministic backend/browser tests cover the output structure, citation anchors,
bounded repair, failure isolation and inspectable UI. They do not certify
semantic fidelity or usefulness. Record further host findings here; shared
insight cards, Brain, filing analysis and Fast tasks are now profile-integrated.
The representative quality/latency review above remains open; deterministic
checks and accepted host functionality do not substitute for it.
