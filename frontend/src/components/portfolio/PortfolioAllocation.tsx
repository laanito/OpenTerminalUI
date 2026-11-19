import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { ConsolidatedPortfolioReport } from "../../api/client";
import { TerminalDataState } from "../terminal/TerminalPage";
import { portfolioMoney } from "./portfolioPresentation";

type Slice = { name: string; value: number };
const COLORS = ["#ff6b00", "#38bdf8", "#34d399", "#c084fc", "#facc15", "#fb7185", "#22d3ee", "#94a3b8"];

export function portfolioAllocation(report: ConsolidatedPortfolioReport): { holdings: Slice[]; sectors: Slice[] | null; reason?: string } {
  const total = report.metrics.market_value.value;
  if (total == null || !Number.isFinite(total)) return { holdings: [], sectors: null, reason: "Complete holdings values are unavailable. No partial allocation pie is shown." };
  const holdings = report.positions.map(position => ({ name: `${position.symbol}${position.exchange ? ` · ${position.exchange}` : ""}${position.quote_unit ? ` · ${position.quote_unit}` : ""}`, value: position.metrics.market_value.value }));
  if (holdings.some(row => row.value == null || !Number.isFinite(row.value) || row.value < 0)) return { holdings: [], sectors: null, reason: "This allocation requires complete, non-negative holdings values." };
  const nonzero = holdings.filter(row => row.value! > 0) as Slice[];
  const matches = (value: number) => Math.abs(value - total) <= Math.max(1e-6, Math.abs(total) * 1e-8);
  if (!matches(nonzero.reduce((sum, row) => sum + row.value, 0))) return { holdings: [], sectors: null, reason: "Position values do not cover the reported holdings total." };
  const grouped = new Map<string, number>();
  let sectorsAvailable = true;
  for (const member of report.portfolios) {
    if (member.accounting.base_currency !== report.reporting_currency || !Array.isArray(member.accounting.allocation_by_sector)) { sectorsAvailable = false; break; }
    for (const row of member.accounting.allocation_by_sector) {
      if (!Number.isFinite(row.value) || row.value < 0) { sectorsAvailable = false; break; }
      const name = row.name?.trim() || "Unknown";
      grouped.set(name, (grouped.get(name) || 0) + row.value);
    }
  }
  const sectors = [...grouped].map(([name, value]) => ({ name, value })).filter(row => row.value > 0).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return { holdings: nonzero.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)), sectors: sectorsAvailable && matches(sectors.reduce((sum, row) => sum + row.value, 0)) ? sectors : null };
}

export function PortfolioAllocation({ report }: { report: ConsolidatedPortfolioReport }) {
  const allocation = portfolioAllocation(report);
  const total = report.metrics.market_value.value;
  const chart = (title: string, data: Slice[] | null) => <section aria-label={title} className="min-w-0 rounded border border-terminal-border bg-terminal-panel p-3">
    <h3 className="text-sm font-semibold text-terminal-text">{title}</h3>
    {!data ? <p role="status" className="mt-3 text-xs text-terminal-muted">Sector coverage is unavailable for this scope. No partial sector pie is shown.</p>
      : !data.length ? <p className="mt-3 text-xs text-terminal-muted">No positive holdings value to allocate.</p> : <>
        <div className="h-40 min-w-0" aria-hidden="true"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="name" isAnimationActive={false} innerRadius={38} outerRadius={66}>{data.map((row, i) => <Cell key={`${row.name}:${i}`} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip formatter={value => portfolioMoney(Number(value), report.reporting_currency)} /></PieChart></ResponsiveContainer></div>
        <ul className="max-h-44 space-y-1 overflow-y-auto text-xs text-terminal-muted" aria-label={`${title} values`}>
          {data.map((row, i) => <li key={`${row.name}:${i}`} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2"><span className="min-w-0 break-words"><span aria-hidden="true" style={{ backgroundColor: COLORS[i % COLORS.length] }} className="mr-1 inline-block h-2 w-2 rounded-full" />{row.name}</span><span>{portfolioMoney(row.value, report.reporting_currency)} · {total && total > 0 ? (row.value / total * 100).toFixed(1) : "0.0"}%</span></li>)}
        </ul>
      </>}
  </section>;
  return <section aria-label="Holdings allocation" className="space-y-2">
    <p className="text-xs text-terminal-muted">Allocation of current holdings value · {report.reporting_currency} · excludes cash</p>
    {allocation.reason ? <TerminalDataState kind="unavailable" title="Allocation unavailable">{allocation.reason}</TerminalDataState>
      : <div className="grid min-w-0 gap-3 sm:grid-cols-2">{chart("Allocation by sector", allocation.sectors)}{chart("Holdings by current value", allocation.holdings)}</div>}
  </section>;
}
