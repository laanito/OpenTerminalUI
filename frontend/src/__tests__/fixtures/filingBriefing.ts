// Server-generated fixture, no live data. Regenerate from the repository root:
// PYTHONPATH=. backend/.venv/bin/python -m backend.tests.generate_filing_briefing_fixture
import data from "./filingContextBriefing.json" with { type: "json" };
import type { ContextBriefingResult } from "../../api/comparisonContextBriefing";
import type { BriefingSelection } from "../../api/comparisonBriefing";
export const filingSelection = data.selection as BriefingSelection;
export type FilingFixtureMode = Exclude<keyof typeof data, "selection">;
export function makeFilingBriefing(mode: FilingFixtureMode = "complete"): ContextBriefingResult {
  return JSON.parse(JSON.stringify(data[mode])) as ContextBriefingResult;
}
