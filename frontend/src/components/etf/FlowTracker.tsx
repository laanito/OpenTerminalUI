import { TerminalTable, type TerminalTableColumn } from "../terminal/TerminalTable";
import { useETFResource } from "./useETFResource";
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
  const { data, loading, error, retry } = useETFResource<FlowData>("/etf/flows", { ticker }, Boolean(ticker));

  const columns: TerminalTableColumn<FlowPoint>[] = [
    {
      key: "date",
      label: "Date",
      sortable: true,
      sortValue: f => f.date,
      render: (f) => <span className="text-terminal-muted">{f.date}</span>,
    },
    {
      key: "net_flow",
      label: "Net Flow ($M)",
      align: "right",
      sortable: true,
      sortValue: f => f.net_flow,
      render: (f) => (
        <span className={f.net_flow >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
          {f.net_flow >= 0 ? "+" : ""}{f.net_flow.toFixed(2)}M
        </span>
      ),
    },
  ];

  if (!ticker) return <p className="p-3 text-sm text-terminal-muted">Enter an ETF ticker to load data.</p>;
  if (loading) return <div role="status" className="p-4 text-center text-terminal-muted">Loading flows...</div>;
  if (error) return <p role="alert" className="p-3 text-sm text-terminal-neg">Could not read this ETF flow history. No previous scope is shown. <button type="button" onClick={retry} className="underline">Retry flows</button></p>;
  if (!data) return null;

  return (
    <div className="min-w-0 space-y-2 rounded border border-terminal-border bg-terminal-panel p-1 [&_.ot-type-table-cell]:text-xs [&_.ot-type-table-header]:text-xs">
      <div className="mb-2 px-3 py-2 text-xs font-semibold uppercase text-terminal-muted">
        Fund Flows: {ticker} (Last 30 Days)
      </div>
      <DegradedBanner info={data.degraded} className="mx-3 mb-2 !text-xs" />
      <TerminalTable
        tableClassName="min-w-[520px] [&_th]:whitespace-nowrap"
        columns={columns}
        rows={data.flows}
        rowKey={(f) => f.date}
        emptyText="No flow data available"
        density="compact"
      />
    </div>
  );
}
