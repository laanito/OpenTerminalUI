import { useEffect, useState } from "react";
import { TerminalTable, type TerminalTableColumn } from "../terminal/TerminalTable";
import { api } from "../../api/base";
import type { DegradedInfo } from "../../api/types";
import { DegradedBanner } from "../common/DegradedBanner";

interface FlowPoint {
  date: string;
  net_flow: number;
}

interface FlowData {
  ticker: string;
  flows: FlowPoint[];
  degraded?: DegradedInfo;
}

interface Props {
  ticker: string;
}

export function FlowTracker({ ticker }: Props) {
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;

    const fetchFlows = async () => {
      setLoading(true);
      setError(null);
      try {
        // Shared api client → bearer token attached (raw fetch 401'd on /api/etf/*).
        const { data: json } = await api.get<FlowData>("/etf/flows", { params: { ticker } });
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchFlows();
  }, [ticker]);

  const columns: TerminalTableColumn<FlowPoint>[] = [
    {
      key: "date",
      label: "Date",
      sortable: true,
      render: (f) => <span className="text-terminal-muted">{f.date}</span>,
    },
    {
      key: "net_flow",
      label: "Net Flow ($M)",
      align: "right",
      sortable: true,
      render: (f) => (
        <span className={f.net_flow >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
          {f.net_flow >= 0 ? "+" : ""}{f.net_flow.toFixed(2)}M
        </span>
      ),
    },
  ];

  if (loading) return <div className="p-4 text-center text-terminal-muted">Loading flows...</div>;
  if (error) return <div className="p-4 text-center text-terminal-neg">{error}</div>;
  if (!data) return null;

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-1">
      <div className="mb-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-terminal-muted">
        Fund Flows: {ticker} (Last 30 Days)
      </div>
      <DegradedBanner info={data.degraded} className="mx-3 mb-2" />
      <TerminalTable
        columns={columns}
        rows={data.flows}
        rowKey={(f) => f.date}
        emptyText="No flow data available"
        density="compact"
      />
    </div>
  );
}
