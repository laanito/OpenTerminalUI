export type CryptoDefiHeadline = {
  tvl_usd: number;
  dex_volume_24h: number;
  lending_borrowed_usd: number;
  defi_change_24h: number;
};

export type CryptoDefiProtocol = {
  symbol: string;
  name: string;
  change_24h: number;
  dominance_pct: number;
  tvl_proxy_usd: number;
};

export function CryptoDefiPanel({
  headline,
  protocols,
  onSelect,
}: {
  headline?: CryptoDefiHeadline | null;
  protocols: CryptoDefiProtocol[];
  onSelect?: (symbol: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]" data-testid="crypto-defi-panel">
      <p className="text-xs text-terminal-muted">Modelled proxies from market cap and volume; these are not observed on-chain TVL, DEX volume or borrowing. Protocol dominance is within this returned basket.</p>
      <div className="grid min-w-0 grid-cols-2 gap-2 2xl:grid-cols-4">
        <div className="min-w-0 rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">TVL Proxy</div>
          <div className="text-terminal-text">{headline?.tvl_usd == null ? "Unavailable" : `$${Math.round(headline.tvl_usd).toLocaleString()}`}</div>
        </div>
        <div className="min-w-0 rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">DEX volume proxy (24h)</div>
          <div className="text-terminal-text">{headline?.dex_volume_24h == null ? "Unavailable" : `$${Math.round(headline.dex_volume_24h).toLocaleString()}`}</div>
        </div>
        <div className="min-w-0 rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">Borrowing proxy</div>
          <div className="text-terminal-text">{headline?.lending_borrowed_usd == null ? "Unavailable" : `$${Math.round(headline.lending_borrowed_usd).toLocaleString()}`}</div>
        </div>
        <div className="min-w-0 rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">DeFi Change</div>
          <div className={headline?.defi_change_24h == null ? "text-terminal-muted" : headline.defi_change_24h >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
            {headline?.defi_change_24h == null ? "Unavailable" : `${headline.defi_change_24h.toFixed(2)}%`}
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}>
        {protocols.map((row) => (
          <div key={row.symbol} className="min-w-0 rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              {onSelect ? (
                <button type="button" className="text-terminal-accent hover:underline" onClick={() => onSelect(row.symbol)}>
                  {row.symbol}
                </button>
              ) : (
                <span className="text-terminal-accent">{row.symbol}</span>
              )}
              <span className={row.change_24h >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{row.change_24h.toFixed(2)}%</span>
            </div>
            <div className="mt-1 text-sm text-terminal-muted">{row.name}</div>
            <div className="mt-1 text-terminal-text">Dominance {row.dominance_pct.toFixed(1)}%</div>
            <div className="text-terminal-muted">TVL proxy ${Math.round(row.tvl_proxy_usd).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
