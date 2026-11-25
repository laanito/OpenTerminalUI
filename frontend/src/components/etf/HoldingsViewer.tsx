import { TerminalTable, type TerminalTableColumn } from "../terminal/TerminalTable";
import { formatPercent } from "../../lib/format";
import { useETFResource } from "./useETFResource";
import type { DegradedInfo } from "../../api/types";
import { DegradedBanner } from "../common/DegradedBanner";

interface Holding {
  symbol: string;
  name: string;
  weight: number;
}

interface Props {
  ticker: string;
}

export function HoldingsViewer({ ticker }: Props) {
  const { data, loading, error, retry } = useETFResource<{ holdings: Holding[]; degraded?: DegradedInfo }>("/etf/holdings", { ticker }, Boolean(ticker));
  const holdings = data?.holdings ?? [];
  const degraded = data?.degraded;

  const columns: TerminalTableColumn<Holding>[] = [
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
      label: "Weight (%)",
      align: "right",
      sortable: true,
      sortValue: h => h.weight,
      render: (h) => <span className="text-terminal-pos">{formatPercent(h.weight / 100)}</span>,
    },
  ];

  if (!ticker) return <p className="p-3 text-sm text-terminal-muted">Enter an ETF ticker to load data.</p>;
  if (loading) return <div role="status" className="p-4 text-center text-terminal-muted">Loading holdings...</div>;
  if (error) return <p role="alert" className="p-3 text-sm text-terminal-neg">Could not read this ETF holdings. No previous scope is shown. <button type="button" onClick={retry} className="underline">Retry holdings</button></p>;

  return (
    <div className="min-w-0 space-y-2 rounded border border-terminal-border bg-terminal-panel p-1 [&_.ot-type-table-cell]:text-xs [&_.ot-type-table-header]:text-xs">
      <div className="mb-2 px-3 py-2 text-xs font-semibold uppercase text-terminal-muted">
        Top Holdings: {ticker}
      </div>
      <DegradedBanner info={degraded} className="mx-3 mb-2 !text-xs" />
      <TerminalTable
        tableClassName="min-w-[520px] [&_th]:whitespace-nowrap"
        columns={columns}
        rows={holdings}
        rowKey={(h) => h.symbol}
        emptyText="No holdings data available"
        density="compact"
      />
    </div>
  );
}
