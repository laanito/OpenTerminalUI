import type { BriefingSelection } from "../../api/comparisonBriefing";
import type { BriefingContextOptions, ContextBriefingResult } from "../../api/comparisonContextBriefing";
import fixture from "./technicalContextBriefing.json" with { type: "json" };

// Real response shapes generated from backend.tests.test_technical_briefing_evidence
// with isolated/mock sources (no live provider/model). Calculation/input versions
// are v1. Keep this fixture aligned when the backend evidence contract changes.
export const technicalSelection = fixture.selection as BriefingSelection;
export const technicalOptions: BriefingContextOptions = { news: false, macro_regions: [], technical: true };
export function makeTechnicalBriefing(kind: "complete" | "partial" | "unavailable" | "mixed" = "complete"): ContextBriefingResult {
  return structuredClone(fixture[kind]) as unknown as ContextBriefingResult;
}
