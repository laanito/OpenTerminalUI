import type { InsightData } from "../../api/types";
import fixture from "./researchTechnicalContext.json" with { type: "json" };

// Generated from backend.tests.test_research_technical_context with isolated,
// deterministic source data. No real model, provider or private notes are used.
export function researchInsight(kind: "complete" | "partial" | "unavailable" | "zero" | "crypto" | "cryptoPartial" | "cryptoUnavailable" = "complete"): InsightData & { ticker: string } {
  return structuredClone(fixture[kind]) as unknown as InsightData & { ticker: string };
}
