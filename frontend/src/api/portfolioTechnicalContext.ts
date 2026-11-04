import { validResearchTechnicalEvidence, type ResearchTechnicalEvidence } from "./researchTechnicalContext";

export type PortfolioTechnicalScope = { portfolioId: string; symbols: string[] };
export type PortfolioTechnicalContext = {
  schema_version: 1; portfolio_id: string; selected_symbols: string[]; total_held_symbols: number;
  selection: "explicit_held_symbols"; weighting: "not_computed"; status: "available" | "partial" | "unavailable";
  positions: { symbol: string; quantity: number; lot_count: number; recorded_cost_currencies: string[]; unknown_cost_currency: boolean }[];
  groups: ResearchTechnicalEvidence[];
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function validPortfolioTechnicalContext(value: unknown, scope: PortfolioTechnicalScope): value is PortfolioTechnicalContext {
  if (!record(value) || value.schema_version !== 1 || value.portfolio_id !== scope.portfolioId
    || value.selection !== "explicit_held_symbols" || value.weighting !== "not_computed"
    || !Number.isInteger(value.total_held_symbols) || Number(value.total_held_symbols) < scope.symbols.length
    || !scope.symbols.length || scope.symbols.length > 3 || new Set(scope.symbols).size !== scope.symbols.length
    || !Array.isArray(value.selected_symbols) || value.selected_symbols.length !== scope.symbols.length
    || value.selected_symbols.some((symbol, index) => symbol !== scope.symbols[index])
    || !Array.isArray(value.positions) || value.positions.length !== scope.symbols.length
    || !Array.isArray(value.groups) || value.groups.length !== scope.symbols.length) return false;
  let usable = 0;
  for (const [index, symbol] of scope.symbols.entries()) {
    const position = value.positions[index];
    if (!record(position) || position.symbol !== symbol || typeof position.quantity !== "number" || !Number.isFinite(position.quantity) || position.quantity <= 0
      || !Number.isInteger(position.lot_count) || Number(position.lot_count) < 1 || typeof position.unknown_cost_currency !== "boolean"
      || !Array.isArray(position.recorded_cost_currencies) || new Set(position.recorded_cost_currencies).size !== position.recorded_cost_currencies.length
      || position.recorded_cost_currencies.some((code) => typeof code !== "string" || !/^[A-Z]{3}$/.test(code))) return false;
    const group = value.groups[index];
    if (!validResearchTechnicalEvidence(group, symbol, `H${index + 1}.`)) return false;
    usable += group.metrics.filter((metric) => metric.status === "available").length;
  }
  return value.status === (usable === scope.symbols.length * 3 ? "available" : usable ? "partial" : "unavailable");
}
export function validPortfolioTechnicalReferences(summary: string, sections: { title: string; points: string[] }[], context: PortfolioTechnicalContext): boolean {
  const body = [summary, ...sections.flatMap((section) => section.points)].join("\n");
  const refs = new Set([...body.matchAll(/\[H[^\]\n]*\]/g)].map((match) => match[0]));
  const all = new Set([...refs, ...sections.flatMap((section) => [...section.title.matchAll(/\[H[^\]\n]*\]/g)].map((match) => match[0]))]);
  const available = new Set(context.groups.flatMap((group) => group.metrics.filter((metric) => metric.status === "available").map((metric) => `[${metric.citation_id}]`)));
  return [...all].every((ref) => available.has(ref)) && context.groups.every((group) => {
    const usable = group.metrics.filter((metric) => metric.status === "available");
    return !usable.length || usable.some((metric) => refs.has(`[${metric.citation_id}]`));
  });
}
