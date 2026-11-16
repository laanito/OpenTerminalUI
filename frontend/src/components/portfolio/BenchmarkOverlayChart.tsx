import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { PortfolioBenchmarkOverlay } from "../../types";

export function BenchmarkOverlayChart({ data }: { data: PortfolioBenchmarkOverlay | null }) {
  const rows = data?.equity_curve ?? [];
  const percent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "Unavailable" : `${(value * 100).toFixed(2)}%`;
  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-terminal-accent">Benchmark Overlay</div>
          {rows[rows.length - 1]?.benchmark_as_of ? <div className="text-[10px] text-terminal-muted">Benchmark close used: {rows[rows.length - 1].benchmark_as_of}</div> : null}
          {data?.base_currency ? (
            <div className="text-[10px] text-terminal-muted">Returns and portfolio values in {data.base_currency}</div>
          ) : null}
        </div>
        <div className="text-xs text-terminal-muted">
          Alpha {percent(data?.alpha)} | Tracking Error {percent(data?.tracking_error)}
        </div>
      </div>
      {data?.status === "partial" ? (
        <div className="mb-2 rounded border border-terminal-neg/40 bg-terminal-neg/10 px-2 py-1 text-[11px] text-terminal-neg">
          Historical evidence is incomplete; no unsupported values were estimated.
        </div>
      ) : null}
      {!rows.length ? (
        <div className="text-xs text-terminal-muted">No benchmark overlay data.</div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows}>
              <XAxis dataKey="date" hide />
              <YAxis tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`} width={52} />
              <Tooltip formatter={(v: number | string | undefined) => `${(Number(v ?? 0) * 100).toFixed(2)}%`} />
              <Line type="monotone" dataKey="portfolio" stroke="#00c176" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="benchmark" stroke="#8e98a8" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
