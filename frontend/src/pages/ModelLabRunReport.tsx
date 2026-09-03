import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { getModelRunReport } from "../api/client";
import { api } from "../api/base";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { InstallationWideLabNotice } from "../components/labs/InstallationWideLabNotice";

type ReportTab = "summary" | "robustness";
type MonteCarloJob = {
  job_id: string;
  status: string;
  progress?: number;
  probability_of_profit?: number;
  result?: Record<string, unknown>;
};
type ConeRow = { step: number; date?: string; p05: number; p25: number; p50: number; p75: number; p95: number };
type HistogramRow = { bucket: string; count: number };

function pct(value: number | undefined): string {
  if (!Number.isFinite(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

export function ModelLabRunReportPage() {
  const { runId = "" } = useParams();
  const [tab, setTab] = useState<ReportTab>("summary");
  const [mcJobId, setMcJobId] = useState<string | null>(null);

  const reportQuery = useQuery({
    queryKey: ["model-lab", "report", runId],
    queryFn: () => getModelRunReport(runId),
    enabled: Boolean(runId),
    refetchInterval: 2000,
  });

  const mergedEquity = useMemo(() => {
    const report = reportQuery.data;
    if (!report) return [] as Array<{ date: string; equity: number; benchmark: number | null }>;
    const benchByDate = new Map(report.series.benchmark_curve.map((item) => [item.date, item.value]));
    return report.series.equity_curve.map((item) => ({
      date: item.date,
      equity: item.value,
      benchmark: benchByDate.get(item.date) ?? null,
    }));
  }, [reportQuery.data]);

  const drawdownRows = reportQuery.data?.series?.drawdown || [];
  const rollingRows = useMemo(() => {
    const rows30 = reportQuery.data?.series?.rolling_sharpe_30 || [];
    const rows90 = reportQuery.data?.series?.rolling_sharpe_90 || [];
    const size = Math.max(rows30.length, rows90.length);
    return Array.from({ length: size }, (_, idx) => ({
      idx,
      sharpe30: rows30[idx] ?? null,
      sharpe90: rows90[idx] ?? null,
    }));
  }, [reportQuery.data]);

  const worstDrawdowns = useMemo(
    () => [...drawdownRows].sort((a, b) => Number(a.value) - Number(b.value)).slice(0, 8),
    [drawdownRows],
  );

  const monthlyMap = useMemo(() => {
    const rows = reportQuery.data?.series?.monthly_returns || [];
    const map = new Map<string, number>();
    for (const row of rows) map.set(`${row.year}-${row.month}`, row.return_pct);
    const years = Array.from(new Set(rows.map((item) => item.year))).sort((a, b) => a - b);
    return { map, years };
  }, [reportQuery.data]);

  const histogramRows = useMemo(() => {
    const hist = reportQuery.data?.series?.returns_histogram;
    if (!hist) return [] as Array<{ bin: number; count: number }>;
    return hist.bins.map((bin, idx) => ({ bin, count: hist.counts[idx] || 0 }));
  }, [reportQuery.data]);

  const startMonteCarlo = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<MonteCarloJob>(`/model-lab/runs/${encodeURIComponent(runId)}/monte-carlo`, {
        simulations: 1000,
        horizon_days: 252,
      });
      return data;
    },
    onSuccess: (data) => setMcJobId(data.job_id),
  });

  const monteCarloQuery = useQuery({
    queryKey: ["model-lab", "monte-carlo", mcJobId],
    queryFn: async () => {
      const { data } = await api.get<MonteCarloJob>(`/model-lab/monte-carlo/${encodeURIComponent(mcJobId || "")}`);
      return data;
    },
    enabled: Boolean(mcJobId),
    refetchInterval: (query) => {
      const status = String(query.state.data?.status || "").toLowerCase();
      return status === "succeeded" || status === "done" || status === "failed" ? false : 2000;
    },
  });

  const mcResult = monteCarloQuery.data?.result || {};
  const mcConeRows = useMemo<ConeRow[]>(() => {
    const raw = (mcResult.confidence_cone || mcResult.percentile_bands || mcResult.cone || []) as Array<Record<string, unknown>>;
    return raw.map((row, index) => ({
      step: Number(row.step ?? index),
      date: typeof row.date === "string" ? row.date : undefined,
      p05: Number(row.p05 ?? row.p5 ?? row["5"] ?? row.lower ?? 0),
      p25: Number(row.p25 ?? row["25"] ?? 0),
      p50: Number(row.p50 ?? row.median ?? row["50"] ?? 0),
      p75: Number(row.p75 ?? row["75"] ?? 0),
      p95: Number(row.p95 ?? row.p95 ?? row["95"] ?? row.upper ?? 0),
    })).filter((row) => Number.isFinite(row.p50));
  }, [mcResult]);

  const mcHistogramRows = useMemo<HistogramRow[]>(() => {
    const hist = mcResult.terminal_wealth_distribution || mcResult.wealth_distribution || mcResult.histogram;
    if (!hist || typeof hist !== "object") return [];
    const bins = ((hist as { bins?: unknown[] }).bins || []) as unknown[];
    const counts = ((hist as { counts?: unknown[] }).counts || []) as unknown[];
    return bins.map((bin, idx) => ({ bucket: String(bin), count: Number(counts[idx] || 0) }));
  }, [mcResult]);

  const mcProbabilityOfProfit = Number(
    monteCarloQuery.data?.probability_of_profit ??
    mcResult.probability_of_profit ??
    mcResult.profit_probability ??
    0,
  );
  const mcProfitPct = mcProbabilityOfProfit > 1 ? mcProbabilityOfProfit / 100 : mcProbabilityOfProfit;

  const openTearSheet = () => {
    if (!runId) return;
    window.open(`/api/reports/tearsheets/model-lab/${encodeURIComponent(runId)}?download=false`, "_blank", "noopener,noreferrer");
  };

  if (!runId) return <div className="p-3 text-sm text-terminal-neg">Missing run id.</div>;

  return (
    <div className="space-y-3 p-3">
      <InstallationWideLabNotice name="Model Lab" />
      <TerminalPanel title="Model Lab / Report" subtitle={runId}>
        {reportQuery.isLoading && <div className="text-xs text-terminal-muted">Loading report...</div>}
        {reportQuery.isError && <div className="text-xs text-terminal-neg">Failed to load report.</div>}
        {reportQuery.data && (
          <div className="flex items-center justify-between text-xs">
            <div>Status: <span className="text-terminal-accent">{reportQuery.data.status}</span></div>
            <div className="flex gap-2">
              {reportQuery.data.status === "succeeded" && <button type="button" className="rounded border border-terminal-border px-2 py-1" onClick={openTearSheet}>Tear-sheet</button>}
              {reportQuery.data.experiment_id && <Link className="rounded border border-terminal-border px-2 py-1" to={`/backtesting/model-lab/experiments/${reportQuery.data.experiment_id}`}>Experiment</Link>}
              <Link className="rounded border border-terminal-border px-2 py-1" to={`/backtesting/model-lab/compare?runs=${runId}`}>Compare</Link>
            </div>
          </div>
        )}
      </TerminalPanel>

      {reportQuery.data && (
        <>
          <div className="flex flex-wrap gap-1 text-xs">
            {[
              ["summary", "Summary"],
              ["robustness", "Robustness"],
            ].map(([id, label]) => (
              <button key={id} type="button" className={`rounded border px-3 py-1 ${tab === id ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent" : "border-terminal-border text-terminal-muted"}`} onClick={() => setTab(id as ReportTab)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "summary" && (
            <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8 text-xs">
            <div className="rounded border border-terminal-border p-2">CAGR<br /><span className="text-terminal-accent">{pct(reportQuery.data.metrics.cagr)}</span></div>
            <div className="rounded border border-terminal-border p-2">Sharpe<br /><span className="text-terminal-accent">{(reportQuery.data.metrics.sharpe || 0).toFixed(2)}</span></div>
            <div className="rounded border border-terminal-border p-2">Sortino<br /><span className="text-terminal-accent">{(reportQuery.data.metrics.sortino || 0).toFixed(2)}</span></div>
            <div className="rounded border border-terminal-border p-2">MaxDD<br /><span className="text-terminal-accent">{pct(reportQuery.data.metrics.max_drawdown)}</span></div>
            <div className="rounded border border-terminal-border p-2">Vol<br /><span className="text-terminal-accent">{pct(reportQuery.data.metrics.vol_annual)}</span></div>
            <div className="rounded border border-terminal-border p-2">Calmar<br /><span className="text-terminal-accent">{(reportQuery.data.metrics.calmar || 0).toFixed(2)}</span></div>
            <div className="rounded border border-terminal-border p-2">WinRate<br /><span className="text-terminal-accent">{pct(reportQuery.data.metrics.win_rate)}</span></div>
            <div className="rounded border border-terminal-border p-2">Turnover<br /><span className="text-terminal-accent">{(reportQuery.data.metrics.turnover || 0).toFixed(4)}</span></div>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <TerminalPanel title="Equity vs Benchmark" subtitle="Line chart">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mergedEquity}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" hide />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line dataKey="equity" stroke="#34d399" dot={false} strokeWidth={2} />
                    <Line dataKey="benchmark" stroke="#60a5fa" dot={false} strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Drawdown" subtitle="Area/line">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={drawdownRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" hide />
                    <YAxis />
                    <Tooltip />
                    <Area dataKey="value" stroke="#f87171" fill="#f87171" fillOpacity={0.3} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Underwater" subtitle="Drawdown over time">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={drawdownRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" hide />
                    <YAxis />
                    <Tooltip />
                    <Line dataKey="value" stroke="#fb923c" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Rolling Sharpe" subtitle="30/90 day">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rollingRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="idx" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line dataKey="sharpe30" stroke="#a78bfa" dot={false} />
                    <Line dataKey="sharpe90" stroke="#38bdf8" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Monthly Returns Heatmap" subtitle="Simple grid">
              <div className="overflow-auto">
                <table className="min-w-full text-[11px]">
                  <thead>
                    <tr>
                      <th className="px-1 py-1 text-left">Year</th>
                      {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m) => <th key={m} className="px-1 py-1">{m}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyMap.years.map((year) => (
                      <tr key={year} className="border-t border-terminal-border/40">
                        <td className="px-1 py-1">{year}</td>
                        {Array.from({ length: 12 }, (_, idx) => idx + 1).map((month) => {
                          const value = monthlyMap.map.get(`${year}-${month}`);
                          const cls = value == null
                            ? "bg-terminal-border/20"
                            : value >= 0
                              ? "bg-terminal-pos/20 text-terminal-pos"
                              : "bg-terminal-neg/20 text-terminal-neg";
                          return <td key={`${year}-${month}`} className="px-1 py-1"><div className={`rounded px-1 py-0.5 text-center ${cls}`}>{value == null ? "-" : value.toFixed(1)}</div></td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Returns Histogram" subtitle="Distribution">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histogramRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bin" hide />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#22c55e" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <TerminalPanel title="Worst Drawdowns" subtitle="Top N">
              <table className="min-w-full text-[11px]">
                <thead>
                  <tr className="border-b border-terminal-border/40">
                    <th className="px-1 py-1 text-left">Date</th>
                    <th className="px-1 py-1 text-right">Drawdown</th>
                  </tr>
                </thead>
                <tbody>
                  {worstDrawdowns.map((row) => (
                    <tr key={row.date} className="border-t border-terminal-border/30">
                      <td className="px-1 py-1">{row.date}</td>
                      <td className="px-1 py-1 text-right text-terminal-neg">{pct(row.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TerminalPanel>

            <TerminalPanel title="Trades" subtitle="Audit table">
              <table className="min-w-full text-[11px]">
                <thead>
                  <tr className="border-b border-terminal-border/40">
                    <th className="px-1 py-1 text-left">Date</th>
                    <th className="px-1 py-1 text-left">Action</th>
                    <th className="px-1 py-1 text-right">Qty</th>
                    <th className="px-1 py-1 text-right">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {((reportQuery.data as any).series?.trades || []).map((trade: any, idx: number) => (
                    <tr key={`${trade.date}-${idx}`} className="border-t border-terminal-border/30">
                      <td className="px-1 py-1">{trade.date}</td>
                      <td className="px-1 py-1">{trade.action}</td>
                      <td className="px-1 py-1 text-right">{Number(trade.quantity || 0).toFixed(2)}</td>
                      <td className="px-1 py-1 text-right">{Number(trade.price || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TerminalPanel>
          </div>

          <TerminalPanel title="Return vs MaxDD" subtitle="Risk-return scatter">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="x" name="Return" />
                  <YAxis type="number" dataKey="y" name="MaxDD" />
                  <ZAxis type="number" dataKey="z" range={[100, 100]} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                  <Scatter
                    name="Run"
                    data={[{ x: Number(reportQuery.data.metrics.total_return || 0), y: Number(reportQuery.data.metrics.max_drawdown || 0), z: 1 }]}
                    fill="#facc15"
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </TerminalPanel>
            </>
          )}

          {tab === "robustness" && (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_0.8fr]">
              <TerminalPanel
                title="Monte Carlo Robustness"
                subtitle={mcJobId ? `Job ${mcJobId}` : "1000 simulations / 252 sessions"}
                actions={
                  <button type="button" className="rounded border border-terminal-accent bg-terminal-accent/10 px-2 py-1 text-xs text-terminal-accent disabled:opacity-50" onClick={() => startMonteCarlo.mutate()} disabled={startMonteCarlo.isPending || !runId}>
                    {startMonteCarlo.isPending ? "Starting..." : "Run MC"}
                  </button>
                }
              >
                <div className="mb-2 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded border border-terminal-border bg-terminal-bg p-2">Status<br /><span className="text-terminal-accent">{monteCarloQuery.data?.status || (mcJobId ? "polling" : "idle")}</span></div>
                  <div className="rounded border border-terminal-border bg-terminal-bg p-2">Progress<br /><span className="text-terminal-accent">{Number(monteCarloQuery.data?.progress || 0).toFixed(0)}%</span></div>
                  <div className="rounded border border-terminal-border bg-terminal-bg p-2">Profit Prob<br /><span className="text-terminal-accent">{pct(mcProfitPct)}</span></div>
                </div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={mcConeRows}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" hide={!mcConeRows.some((row) => row.date)} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Area dataKey="p95" name="P95" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.08} dot={false} />
                      <Area dataKey="p75" name="P75" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.16} dot={false} />
                      <Area dataKey="p50" name="Median" stroke="#34d399" fill="#34d399" fillOpacity={0.08} dot={false} />
                      <Area dataKey="p25" name="P25" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.12} dot={false} />
                      <Area dataKey="p05" name="P05" stroke="#f87171" fill="#f87171" fillOpacity={0.08} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </TerminalPanel>

              <TerminalPanel title="Terminal Wealth" subtitle="Distribution histogram">
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={mcHistogramRows}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="bucket" hide />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#22c55e" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {!mcHistogramRows.length && <div className="text-xs text-terminal-muted">Run Monte Carlo to populate terminal-wealth buckets.</div>}
              </TerminalPanel>
            </div>
          )}
        </>
      )}
    </div>
  );
}
