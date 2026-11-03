import type { BrainAskResponse } from "../../api/brain";
import fixture from "./brainTechnicalContext.json" with { type: "json" };

// AskResponse models and multi-asset contexts produced by backend tests with
// deterministic source data, no provider/model or private production corpus.
export function brainTechnicalAnswer(kind: "complete" | "partial" | "unavailable" | "skipped" = "complete"): BrainAskResponse {
  return structuredClone(fixture[kind]) as unknown as BrainAskResponse;
}
