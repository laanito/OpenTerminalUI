import type { InsightData } from "../../api/types";
import fixture from "./portfolioTechnicalContext.json" with { type: "json" };
// Server-produced deterministic source projections; no real portfolios/models.
export function portfolioInsight(kind: "complete" | "partial" | "unavailable" | "modelFailure" = "complete"): InsightData {
  return structuredClone(fixture[kind]) as unknown as InsightData;
}
