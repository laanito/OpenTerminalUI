type Point = { label: string; value: number };
type Valuation = Point & { cash: number; holdings: number; flow: number; priceDates: Record<string, string> };
export type HomePortfolioHistory = {
  status: "loading" | "unavailable" | "complete" | "degraded";
  message: string; points: Point[]; benchmarkPoints: Point[]; navPoints: Point[];
  valuations: Valuation[];
  benchmark: string | null; benchmarkAsOf: string | null; baseCurrency: string | null;
  start: string | null; end: string | null; checkedAt: number | null; notes: string[];
};
export function emptyHomeHistory(message: string, checkedAt: number | null = null): HomePortfolioHistory {
  return { status: "unavailable", message, points: [], benchmarkPoints: [], navPoints: [], valuations: [], benchmark: null, benchmarkAsOf: null, baseCurrency: null,
    start: null, end: null, checkedAt, notes: [] };
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const issueLabels: Record<string, string> = {
  ledger_price_or_fx_unavailable: "Historical price or FX unavailable",
  ledger_fx_or_currency_unavailable: "Ledger currency or historical FX unavailable",
  ledger_holdings_mismatch: "Ledger quantities do not match current holdings",
  ledger_position_negative: "Ledger sells exceed recorded purchases",
  ledger_date_or_value_invalid: "Ledger date or amount is invalid",
  ledger_value_invalid: "Ledger amount is invalid", ledger_history_empty: "No dated portfolio history",
  benchmark_history_unavailable: "Benchmark history unavailable; reconstructed portfolio values remain available",
};

/** Ledger NAV is independent of the flow-adjusted comparison and benchmark. */
export function buildHomeHistory(value: unknown, now = Date.now()): HomePortfolioHistory {
  const unavailable = (message: string) => emptyHomeHistory(message, now);
  if (!record(value) || value.methodology !== "daily_ledger_reconstruction"
    || !["complete", "degraded", "partial"].includes(String(value.status)) || typeof value.base_currency !== "string"
    || !/^[A-Z]{3}$/.test(value.base_currency) || typeof value.benchmark !== "string" || !value.benchmark.trim()
    || !Array.isArray(value.equity_curve)) return unavailable("Historical reconstruction metadata is unavailable.");
  const notes = Array.isArray(value.issues) ? value.issues.filter(record).map((issue) =>
    `${issueLabels[String(issue.code)] ?? "Historical input unavailable"}${typeof issue.symbol === "string" ? ` (${issue.symbol})` : ""}${typeof issue.date === "string" ? ` on ${issue.date}` : ""}`) : [];
  if (Array.isArray(value.degraded_reasons)) notes.push(...value.degraded_reasons.filter((reason): reason is string => typeof reason === "string"));
  if (Array.isArray(value.excluded_transactions)) {
    for (const row of value.excluded_transactions) {
      if (record(row) && row.reason === "legacy_unmatched_sale" && typeof row.symbol === "string" && date(row.date) && positive(row.shares)) {
        notes.push(`Excluded legacy sale: ${row.symbol} · ${row.date} · ${row.shares} shares${typeof row.id === "string" ? ` · transaction ${row.id}` : ""}.`);
      }
    }
  }
  if (value.status === "partial") return { ...unavailable("Historical reconstruction is incomplete; no partial portfolio curve is shown."), notes };
  const end = new Date(now).toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  const observations = new Map<string, Record<string, unknown>>();
  for (const point of value.equity_curve) {
    if (!record(point) || !date(point.date)) return { ...unavailable("Historical reconstruction contains an invalid date."), notes };
    if (point.date < start || point.date > end) continue;
    if (!finite(point.net_liquidation_value) || observations.has(point.date)) return { ...unavailable("Historical reconstruction contains invalid or duplicate values."), notes };
    observations.set(point.date, point);
  }
  const ordered = [...observations].sort(([a], [b]) => a.localeCompare(b));
  if (ordered.length < 2) return { ...unavailable("At least two daily observations are needed within the last 30 UTC calendar days."), notes };
  if (ordered.some(([label], i) => i > 0 && Date.parse(label) - Date.parse(ordered[i - 1][0]) !== 86400000)) return { ...unavailable("Historical reconstruction has missing calendar days."), notes };
  const navPoints = ordered.map(([label, point]) => ({ label, value: point.net_liquidation_value as number }));
  const valuations = ordered.flatMap(([label, point]) => finite(point.cash_balance) && finite(point.holdings_value) && finite(point.external_flow)
    ? [{ label, value: point.net_liquidation_value as number, cash: point.cash_balance, holdings: point.holdings_value, flow: point.external_flow,
      priceDates: record(point.price_dates) ? Object.fromEntries(Object.entries(point.price_dates).filter((entry): entry is [string, string] => date(entry[1]) && entry[1] <= label)) : {} }] : []);
  const firstPositive = ordered.findIndex(([, point]) => positive(point.portfolio));
  const indexed = firstPositive < 0 ? [] : ordered.slice(firstPositive);
  const validIndex = indexed.length > 1 && indexed.every(([, point]) => positive(point.portfolio));
  const points = validIndex ? indexed.map(([label, point]) => ({ label, value: (point.portfolio as number) / (indexed[0][1].portfolio as number) * 100 })) : [];
  const validBenchmark = validIndex && indexed.every(([label, point]) => positive(point.benchmark) && date(point.benchmark_as_of)
    && point.benchmark_as_of <= label && Date.parse(label) - Date.parse(point.benchmark_as_of) <= 7 * 86400000);
  const benchmarkPoints = validBenchmark ? indexed.map(([label, point]) => ({ label, value: (point.benchmark as number) / (indexed[0][1].benchmark as number) * 100 })) : [];
  if ([...points, ...benchmarkPoints].some((point) => !finite(point.value))) return { ...unavailable("Historical values could not be indexed safely."), notes };
  if (!validIndex) notes.push("Flow-adjusted comparison unavailable; reconstructed portfolio values are shown in Portfolio HQ.");
  else if (!validBenchmark) notes.push("Benchmark comparison unavailable; the portfolio return index remains available.");
  return { status: value.status === "degraded" || !validBenchmark ? "degraded" : "complete", message: points.length ? "" : "Flow-adjusted return index unavailable.",
    points, benchmarkPoints, navPoints, valuations, benchmark: value.benchmark, benchmarkAsOf: validBenchmark ? indexed[indexed.length - 1][1].benchmark_as_of as string : null,
    baseCurrency: value.base_currency, start: ordered[0][0], end: ordered[ordered.length - 1][0], checkedAt: now, notes };
}
