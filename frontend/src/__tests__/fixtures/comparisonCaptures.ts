import type { ComparisonCapture } from "../../api/comparisonCaptures";
import { briefingSelection, makeBriefing, makeContextBriefing } from "./comparisonBriefing";

export function makeCapture(context = false): ComparisonCapture {
  const result = context ? makeContextBriefing({ news: true, macro_regions: ["us"] }) : makeBriefing();
  return {
    ...briefingSelection, id: "saved-1", captured_at: "2026-11-14T12:02:00Z", mode: context ? "context" : "price",
    status: result.status, content_hash: "c".repeat(64), retention: "retained_no_automatic_expiry",
    content: {
      schema_version: 1, mode: context ? "context" : "price",
      selection: { ...briefingSelection, context: context ? { news: true, macro_regions: ["us"] } : null },
      generation: { contract_version: "comparison-capture-v1", protocol: "openai_compatible_chat_completions",
        profile: { requested_profile: "deep", resolved_profile: "fast", model: result.model! },
        enabled: true, timeout_seconds: 240, structured_output: "auto",
        attempts: [{ dispatched_at: "2026-11-14T12:01:00Z", body: { model: result.model, messages: [{ role: "user", content: "original input <script>source text</script>" }] } }],
      }, result,
    },
  };
}
export function captureSummary(saved = makeCapture()) {
  const { content: _content, ...summary } = saved;
  return summary;
}
