export type CryptoDerivativesRow = {
  symbol: string;
  funding_rate_8h: number;
  open_interest_usd: number;
  long_liquidations_24h: number;
  short_liquidations_24h: number;
  liquidations_24h: number;
};

export type CryptoDerivativesTotals = {
  open_interest_usd: number;
  long_liquidations_24h: number;
  short_liquidations_24h: number;
  liquidations_24h: number;
};

export function CryptoDerivativesPanel({
  rows,
  totals,
  onSelect,
}: {
  rows: CryptoDerivativesRow[];
  totals?: CryptoDerivativesTotals | null;
  onSelect?: (symbol: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]" data-testid="crypto-derivatives-panel">
      <div className="grid min-w-0 grid-cols-2 gap-2 2xl:grid-cols-4">
        <div className="min-w-0 rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">Open Interest</div>
          <div className="text-terminal-text">{totals?.open_interest_usd == null ? "Unavailable" : `$${Math.round(totals.open_interest_usd).toLocaleString()}`}</div>
        </div>
        <div className="min-w-0 rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">Liquidations</div>
          <div className="text-terminal-text">{totals?.liquidations_24h == null ? "Unavailable" : `$${Math.round(totals.liquidations_24h).toLocaleString()}`}</div>
        </div>
        <div className="min-w-0 rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">Long liquidations</div>
          <div className="text-terminal-neg">{totals?.long_liquidations_24h == null ? "Unavailable" : `$${Math.round(totals.long_liquidations_24h).toLocaleString()}`}</div>
        </div>
        <div className="min-w-0 rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
          <div className="text-terminal-muted">Short liquidations</div>
          <div className="text-terminal-pos">{totals?.short_liquidations_24h == null ? "Unavailable" : `$${Math.round(totals.short_liquidations_24h).toLocaleString()}`}</div>
        </div>
      </div>

      <div role="region" aria-label="Crypto derivatives table" tabIndex={0} className="min-w-0 max-w-full overflow-x-auto"><table className="min-w-[620px] w-full text-xs [&_th]:whitespace-nowrap [&_td]:p-2 [&_th]:p-2">
        <thead className="text-terminal-muted">
          <tr>
            <th className="text-left">Symbol</th>
            <th className="text-right">Funding (8h)</th>
            <th className="text-right">Open Interest</th>
            <th className="text-right">24h Liq</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.symbol} className="border-t border-terminal-border/50">
              <td>
                {onSelect ? (
                  <button type="button" className="text-terminal-accent hover:underline" onClick={() => onSelect(row.symbol)}>
                    {row.symbol}
                  </button>
                ) : (
                  <span className="text-terminal-accent">{row.symbol}</span>
                )}
              </td>
              <td className={`text-right ${row.funding_rate_8h >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                {(row.funding_rate_8h * 100).toFixed(3)}%
              </td>
              <td className="text-right">${Math.round(row.open_interest_usd).toLocaleString()}</td>
              <td className="text-right">${Math.round(row.liquidations_24h).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
