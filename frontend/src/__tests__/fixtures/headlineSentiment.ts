import type { ComparisonCapture } from "../../api/comparisonCaptures";
import type { RetainedHeadline, RetainedAssessment } from "../../api/headlineSentiment";
import { makeCapture } from "./comparisonCaptures";

export function makeRetainedHeadline(source: ComparisonCapture = makeCapture(true), index = 0): RetainedHeadline {
  const result = source.content.result;
  if (!("possible_context" in result) || !result.evidence) throw new Error("Fixture requires saved headlines");
  const choice = result.evidence.sections.flatMap((section) => section.kind === "headlines"
    ? section.groups.flatMap((group) => group.headlines.map((headline) => ({ ...headline, target_symbol: group.symbol, retrieved_at: section.retrieved_at! }))) : [])[index];
  const common: RetainedAssessment["payload"] = {
    schema_version: 1, target_symbol: null, meaning: "text_tone", method: "lexical", method_version: "finance-keyword-tone-v1",
    provider: null, model: null, prompt_version: null, input_text: choice.title, scored_at: "2026-11-15T10:00:00Z",
    status: "complete", score: 0, label: "neutral", rationale: "Keyword tone only.", confidence: null,
    confidence_kind: "not_provided", failure_code: null, generation: null, reused_from_cache: false,
  };
  return {
    id: `snapshot-${index + 1}`, captured_at: "2026-11-15T10:01:00Z", content_hash: "f".repeat(64), retention: "retained_no_automatic_expiry",
    payload: { schema_version: 1, title: choice.title, summary: "", source_url: choice.url, publisher: choice.source,
      published_at: choice.published_at, retrieved_at: choice.retrieved_at, text_scope: "headline_only", truncated: choice.title_truncated,
      symbols: [choice.target_symbol], origin: { kind: "saved_comparison_headlines", capture_id: source.id,
        capture_content_hash: source.content_hash, citation_ids: [choice.citation_id] } },
    assessments: [
      { id: `tone-${index + 1}`, recorded_at: "2026-11-15T10:01:01Z", payload: { ...common } },
      { id: `asset-${index + 1}`, recorded_at: "2026-11-15T10:01:02Z", payload: { ...common, target_symbol: choice.target_symbol,
        meaning: "asset_implication", method: "llm", method_version: "saved-headline-asset-v1", provider: "openai_compatible", model: "fast-sentiment",
        prompt_version: "saved-headline-asset-v1", score: -0.5, label: "bearish", rationale: "A limited adverse implication from this headline.",
        generation: { protocol: "openai_compatible_chat_completions", profile: { requested_profile: "fast", resolved_profile: "fast", model: "fast-sentiment" },
          context_hash: "e".repeat(64), attempts: [{ dispatched_at: "2026-11-15T09:59:00Z", body: { model: "fast-sentiment", messages: [
            { role: "user", content: JSON.stringify([{ headline: choice.title, target_symbol: choice.target_symbol, untrusted_text: "<script>source data</script>" }]) },
          ], stream: false, max_tokens: 700 } }] },
      } },
    ],
  };
}
