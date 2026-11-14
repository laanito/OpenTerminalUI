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
        attempts: [{ dispatched_at: "2026-11-14T12:01:00Z", body: { model: result.model, stream: false, max_tokens: 2000, temperature: 0.1, messages: [{ role: "user", content: "original input <script>source text</script>" }] } }],
      }, result,
    },
  };
}
export function captureSummary(saved = makeCapture()) {
  const { content: _content, ...summary } = saved;
  return summary;
}

export function makeCaptureFollowup(source = makeCapture(), kind: "rerun" | "refresh" = "rerun"): ComparisonCapture {
  const child = JSON.parse(JSON.stringify(source)) as ComparisonCapture;
  child.id = `${source.id}-${kind}`;
  child.content_hash = "d".repeat(64);
  child.captured_at = "2026-11-14T13:02:00Z";
  const index = source.content.generation.attempts.length ? source.content.generation.attempts.length - 1 : null;
  child.lineage = child.content.lineage = {
    kind: kind === "rerun" ? "saved_input_rerun" : "fresh_refresh", parent_id: source.id,
    parent_content_hash: source.content_hash, source_generated_at: source.content.result.generated_at,
    replay_request_index: kind === "rerun" ? index : null, model_policy: "current_deep",
  };
  child.content.result.generated_at = "2026-11-14T13:01:00Z";
  child.content.result.model = "current-deep";
  child.content.generation.profile.model = "current-deep";
  child.content.result.model_profile = { ...child.content.generation.profile };
  const original = index !== null ? source.content.generation.attempts[index].body : source.content.generation.prepared_request!;
  child.content.generation.attempts = [{ dispatched_at: "2026-11-14T13:00:00Z", body: { ...original, model: "current-deep" } }];
  if (kind === "refresh" && child.content.result.evidence) child.content.result.evidence.packet_id = "e".repeat(64);
  return child;
}
