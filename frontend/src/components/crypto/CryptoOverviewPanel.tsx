import { useQuery } from "@tanstack/react-query";

import { fetchCryptoCoinDetail } from "../../api/crypto";
import { useDisplayCurrency } from "../../hooks/useDisplayCurrency";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-terminal-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums text-terminal-text">{value}</div>
    </div>
  );
}

export function CryptoOverviewPanel({ symbol }: { symbol: string }) {
  // Crypto is quoted in USD upstream; the display hooks convert to the selected currency.
  const { formatMoney, formatCompactMoney } = useDisplayCurrency();
  const money = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : formatMoney(v, "USD"));
  const compact = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : formatCompactMoney(v, "USD"));

  const { data, isLoading, error } = useQuery({
    queryKey: ["crypto-coin-detail", symbol],
    queryFn: () => fetchCryptoCoinDetail(symbol),
    enabled: !!symbol,
    staleTime: 60 * 1000,
    retry: 1,
  });

  if (isLoading) {
    return <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs text-terminal-muted">Loading overview…</div>;
  }
  if (error || !data) {
    return <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs text-terminal-muted">Overview is unavailable for this asset.</div>;
  }

  const change = data.change_24h;
  const changeClass = change === null || change === undefined ? "text-terminal-muted" : change >= 0 ? "text-terminal-pos" : "text-terminal-neg";
  const changeText = change === null || change === undefined || !Number.isFinite(change) ? "-" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;

  return (
    <div className="space-y-3">
      <div className="rounded border border-terminal-border bg-terminal-panel p-4">
        <div className="text-xs text-terminal-muted">{data.symbol} | Crypto</div>
        <div className="text-xl font-semibold">{data.name || data.symbol}</div>
        <div className="mt-3 flex items-end gap-3">
          <div className="text-2xl font-bold tabular-nums">{money(data.price)}</div>
          <div className={`text-sm font-semibold ${changeClass}`}>{changeText} <span className="text-terminal-muted">24h</span></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Market Cap" value={compact(data.market_cap)} />
        <Stat label="24h Volume" value={compact(data.volume_24h)} />
        <Stat label="24h High" value={money(data.high_24h)} />
        <Stat label="24h Low" value={money(data.low_24h)} />
      </div>

      <p className="text-[11px] leading-snug text-terminal-muted">
        Tokenomics, on-chain TVL &amp; fees, and valuation ratios are in the <span className="text-terminal-accent">Fundamentals</span> tab.
      </p>
    </div>
  );
}
