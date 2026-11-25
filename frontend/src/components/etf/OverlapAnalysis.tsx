import { TerminalTable, type TerminalTableColumn } from "../terminal/TerminalTable";
import { formatPercent } from "../../lib/format";
import { useETFResource } from "./useETFResource";
import type { DegradedInfo } from "../../api/types";
import { DegradedBanner } from "../common/DegradedBanner";

interface CommonHolding {
  symbol: string;
  name: string;
  weight: number;
}

interface OverlapData {
  tickers: string[];
  overlap_pct: number;
  common_holdings: CommonHolding[];
  degraded?: DegradedInfo;
}

interface Props {
  tickers: string[];
}

export function OverlapAnalysis({ tickers }: Props) {
  const { data, loading, error, retry } = useETFResource<OverlapData>("/etf/overlap", { tickers: tickers.join(",") }, tickers.length >= 2);

  const columns: TerminalTableColumn<CommonHolding>[] = [
    {
      key: "symbol",
      label: "Symbol",
      sortable: true,
      sortValue: h => h.symbol,
      render: (h) => <span className="font-medium text-terminal-accent">{h.symbol}</span>,
    },
    {
      key: "name",
      label: "Name",
      sortable: true,
      widthClassName: "min-w-[250px]",
      sortValue: h => h.name,
      render: (h) => <span className="whitespace-normal break-words text-sm text-terminal-text">{h.name}</span>,
    },
    {
      key: "weight",
      label: "Overlap Weight (%)",
      align: "right",
      sortable: true,
      sortValue: h => h.weight,
      render: (h) => <span className="text-terminal-pos">{formatPercent(h.weight)}</span>,
    },
  ];

  if (tickers.length < 2) return <div className="p-4 text-center text-terminal-muted">Select at least two ETFs for overlap analysis</div>;
  if (loading) return <div role="status" className="p-4 text-center text-terminal-muted">Loading overlap analysis...</div>;
  if (error) return <p role="alert" className="p-3 text-sm text-terminal-neg">Could not read this overlap comparison. No previous scope is shown. <button type="button" onClick={retry} className="underline">Retry overlap</button></p>;
  if (!data) return null;

  return (
    <div className="min-w-0 space-y-2 rounded border border-terminal-border bg-terminal-panel p-1 [&_.ot-type-table-cell]:text-xs [&_.ot-type-table-header]:text-xs">
      <div className="mb-2 px-3 py-2 flex flex-wrap gap-2 justify-between items-center">
        <div className="text-xs font-semibold uppercase text-terminal-muted">
          Overlap: {data.tickers.join(" vs ")}
        </div>
        <div className="text-sm font-bold text-terminal-accent">
          {formatPercent(data.overlap_pct)} Overlap
        </div>
      </div>
      <DegradedBanner info={data.degraded} className="mx-3 mb-2 !text-xs" />
      <TerminalTable
        tableClassName="min-w-[520px] [&_th]:whitespace-nowrap"
        columns={columns}
        rows={data.common_holdings}
        rowKey={(h) => h.symbol}
        emptyText="No common holdings found"
        density="compact"
      />
    </div>
  );
}
