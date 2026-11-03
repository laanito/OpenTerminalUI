import { validResearchTechnicalEvidence, type ResearchTechnicalEvidence } from "./researchTechnicalContext";

export type BrainTechnicalContext = {
  schema_version: 1; requested_symbols: string[]; status: "available" | "partial" | "unavailable" | "skipped";
  reason: "private_context_unavailable" | "model_disabled" | "preparation_timeout" | null;
  groups: ResearchTechnicalEvidence[];
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function normalizeTechnicalSymbols(values: string[] = []): string[] {
  if (!Array.isArray(values) || values.length > 3 || values.some((value) => typeof value !== "string" || !/^[A-Z0-9^._=-]{1,40}$/.test(value.trim().toUpperCase())))
    throw new Error("Choose at most three valid technical symbols.");
  const symbols = values.map((value) => value.trim().toUpperCase());
  if (new Set(symbols).size !== symbols.length) throw new Error("Technical symbols must be unique.");
  return symbols;
}

export function validBrainTechnicalContext(value: unknown, symbols: string[]): value is BrainTechnicalContext {
  if (!symbols.length || symbols.length > 3 || !record(value) || value.schema_version !== 1
    || !Array.isArray(value.requested_symbols) || value.requested_symbols.length !== symbols.length
    || value.requested_symbols.some((symbol, index) => symbol !== symbols[index])
    || !Array.isArray(value.groups) || value.groups.length > 3) return false;
  if (value.status === "skipped") return value.groups.length === 0 && ["private_context_unavailable", "model_disabled", "preparation_timeout"].includes(String(value.reason));
  if (value.reason !== null || value.groups.length !== symbols.length) return false;
  let available = 0;
  for (const [index, group] of value.groups.entries()) {
    if (!validResearchTechnicalEvidence(group, symbols[index], `T${index + 1}.`)) return false;
    available += group.metrics.filter((metric) => metric.status === "available").length;
  }
  return value.status === (available === symbols.length * 3 ? "available" : available ? "partial" : "unavailable");
}

export function validBrainTechnicalReferences(answer: string, context: BrainTechnicalContext, citations: { n: number }[], requireCoverage = true): boolean {
  const refs = new Set([...answer.matchAll(/\[T[^\]\n]*\]/g)].map((match) => match[0]));
  const available = new Set(context.groups.flatMap((group) => group.metrics.filter((metric) => metric.status === "available").map((metric) => `[${metric.citation_id}]`)));
  if ([...refs].some((ref) => !available.has(ref))) return false;
  if (!requireCoverage || context.status === "skipped") return true;
  for (const group of context.groups) {
    const usable = group.metrics.filter((metric) => metric.status === "available").map((metric) => `[${metric.citation_id}]`);
    if (usable.length && !usable.some((ref) => refs.has(ref))) return false;
  }
  const privateRefs = [...answer.matchAll(/\[(\d{1,2}(?:,\s*\d{1,2})*)\]/g)].flatMap((match) => match[1].split(",").map(Number));
  const known = new Set(citations.map((citation) => citation.n));
  return (!known.size || privateRefs.length > 0) && privateRefs.every((ref) => known.has(ref));
}
