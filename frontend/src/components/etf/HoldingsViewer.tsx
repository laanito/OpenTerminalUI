import { useEffect, useState } from "react";
import { TerminalTable, type TerminalTableColumn } from "../terminal/TerminalTable";
import { formatPercent } from "../../lib/format";
import { api } from "../../api/base";
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
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [degraded, setDegraded] = useState<DegradedInfo | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;

    const fetchHoldings = async () => {
      setLoading(true);
      setError(null);
      try {
        // Use the shared api client so the bearer token is attached (a raw
        // fetch bypassed auth and 401'd on /api/etf/*).
        const { data } = await api.get<{ holdings: Holding[]; degraded?: DegradedInfo }>("/etf/holdings", {
          params: { ticker },
        });
        setHoldings(data.holdings ?? []);
        setDegraded(data.degraded);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchHoldings();
  }, [ticker]);

  const columns: TerminalTableColumn<Holding>[] = [
    {
      key: "symbol",
      label: "Symbol",
      sortable: true,
      render: (h) => <span className="font-medium text-terminal-accent">{h.symbol}</span>,
    },
    {
      key: "name",
      label: "Name",
      sortable: true,
      render: (h) => <span className="truncate text-terminal-text">{h.name}</span>,
    },
    {
      key: "weight",
      label: "Weight (%)",
      align: "right",
      sortable: true,
      render: (h) => <span className="text-terminal-pos">{formatPercent(h.weight / 100)}</span>,
    },
  ];

  if (loading) return <div className="p-4 text-center text-terminal-muted">Loading holdings...</div>;
  if (error) return <div className="p-4 text-center text-terminal-neg">{error}</div>;

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-1">
      <div className="mb-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-terminal-muted">
        Top Holdings: {ticker}
      </div>
      <DegradedBanner info={degraded} className="mx-3 mb-2" />
      <TerminalTable
        columns={columns}
        rows={holdings}
        rowKey={(h) => h.symbol}
        emptyText="No holdings data available"
        density="compact"
      />
    </div>
  );
}
