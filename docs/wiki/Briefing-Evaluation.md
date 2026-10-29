# Comparison briefing interpretation evaluation

This is the v2.4 human acceptance guide for briefing usefulness. The maintainer
confirmed on 2026-10-29 that comparison routing selected the configured Deep
model, but found its summary too descriptive. The approved follow-up introduces
explicit hypotheses rather than treating a larger model or valid citations as
proof of useful reasoning. Host acceptance of this follow-up is **pending**.

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
semantic fidelity or usefulness. Record host findings here before marking the
interpretation-quality acceptance complete; model routing for shared insight
cards and Brain remains a separate unfinished v2.4 work item.
