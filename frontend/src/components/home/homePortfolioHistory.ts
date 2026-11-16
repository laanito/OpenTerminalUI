type Point = { label: string; value: number };
export type HomePortfolioHistory = {
  status: "loading" | "unavailable" | "complete" | "degraded";
  message: string; points: Point[]; benchmarkPoints: Point[];
  benchmark: string | null; benchmarkAsOf: string | null; baseCurrency: string | null;
  start: string | null; end: string | null; checkedAt: number | null; notes: string[];
};
export function emptyHomeHistory(message: string, checkedAt: number | null = null): HomePortfolioHistory {
  return { status: "unavailable", message, points: [], benchmarkPoints: [], benchmark: null, benchmarkAsOf: null, baseCurrency: null,
    start: null, end: null, checkedAt, notes: [] };
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const issueLabels: Record<string, string> = {
  price_history_unavailable: "Price history unavailable", instrument_currency_unknown: "Instrument currency unknown",
  fx_history_unavailable: "Historical FX unavailable", purchase_date_invalid: "Purchase date invalid",
  benchmark_history_unavailable: "Benchmark history unavailable",
  benchmark_no_prior_close: "No benchmark close on or before the holdings window",
};

/** An indexed comparison of today's open basket, never a transaction/NAV curve. */
export function buildHomeHistory(value: unknown, now = Date.now()): HomePortfolioHistory {
  const unavailable = (message: string) => emptyHomeHistory(message, now);
  if (!record(value) || value.methodology !== "current_open_holdings_constant_quantity"
    || !["complete", "degraded", "partial"].includes(String(value.status)) || typeof value.base_currency !== "string"
    || !/^[A-Z]{3}$/.test(value.base_currency) || typeof value.benchmark !== "string" || !value.benchmark.trim()
    || !Array.isArray(value.equity_curve)) return unavailable("Historical comparison metadata is unavailable.");
  const notes = Array.isArray(value.issues) ? value.issues.filter(record).map((issue) =>
    `${issueLabels[String(issue.code)] ?? "Historical input unavailable"}${typeof issue.symbol === "string" ? ` (${issue.symbol})` : ""}`) : [];
  const coverageNotes: string[] = [];
  if (record(value.coverage)) {
    if (date(value.coverage.portfolio_start) && date(value.coverage.portfolio_end)) coverageNotes.push(`Current basket history: ${value.coverage.portfolio_start} to ${value.coverage.portfolio_end}.`);
    if (date(value.coverage.benchmark_start) && date(value.coverage.benchmark_end)) coverageNotes.push(`Usable benchmark history: ${value.coverage.benchmark_start} to ${value.coverage.benchmark_end}.`);
  }
  if (value.status === "partial") return { ...unavailable("Historical comparison is incomplete; no partial portfolio curve is shown."), notes: [...notes, ...coverageNotes] };
  if (Array.isArray(value.degraded_reasons)) notes.push(...value.degraded_reasons.filter((reason): reason is string => typeof reason === "string").map((reason) => reason.replace(/_/g, " ")));
  const end = new Date(now).toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  const observations = new Map<string, { portfolio: number; benchmark: number; benchmarkAsOf: string | null }>();
  const conflicts = new Set<string>();
  let withheld = 0;
  for (const point of value.equity_curve) {
    if (!record(point) || !date(point.date)) { withheld++; continue; }
    if (point.date < start || point.date > end) continue;
    if (!positive(point.portfolio) || !positive(point.benchmark)) { withheld++; continue; }
    const benchmarkAsOf = point.benchmark_as_of ?? null;
    if (benchmarkAsOf !== null && (!date(benchmarkAsOf) || benchmarkAsOf > point.date)) { withheld++; continue; }
    const previous = observations.get(point.date);
    if (previous && (previous.portfolio !== point.portfolio || previous.benchmark !== point.benchmark || previous.benchmarkAsOf !== benchmarkAsOf)) conflicts.add(point.date);
    else observations.set(point.date, { portfolio: point.portfolio, benchmark: point.benchmark, benchmarkAsOf });
  }
  for (const day of conflicts) { observations.delete(day); withheld++; }
  const ordered = [...observations].sort(([a], [b]) => a.localeCompare(b));
  const latestBenchmark = ordered[ordered.length - 1]?.[1].benchmarkAsOf ?? null;
  if (latestBenchmark && latestBenchmark < start) return { ...unavailable("No benchmark close is available within the last 30 UTC calendar days."), notes: [...notes, ...coverageNotes] };
  if (ordered.length < 2) return { ...unavailable("At least two shared observations are needed within the last 30 UTC calendar days."), notes: [...notes, ...coverageNotes] };
  const first = ordered[0][1];
  const points = ordered.map(([label, point]) => ({ label, value: point.portfolio / first.portfolio * 100 }));
  const benchmarkPoints = ordered.map(([label, point]) => ({ label, value: point.benchmark / first.benchmark * 100 }));
  if ([...points, ...benchmarkPoints].some((point) => !Number.isFinite(point.value))) return unavailable("Historical values could not be indexed safely.");
  if (withheld) notes.push(`${withheld} invalid or conflicting historical observations withheld.`);
  return { status: value.status === "degraded" || withheld ? "degraded" : "complete", message: "",
    points, benchmarkPoints, benchmark: value.benchmark, benchmarkAsOf: latestBenchmark, baseCurrency: value.base_currency,
    start: ordered[0][0], end: ordered[ordered.length - 1][0], checkedAt: now, notes };
}
