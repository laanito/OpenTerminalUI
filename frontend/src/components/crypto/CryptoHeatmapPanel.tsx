export type CryptoHeatmapCell = {
  symbol: string;
  name: string;
  sector: string;
  change_24h: number;
  market_cap: number;
  depth_imbalance: number;
  bucket: string;
};

function bucketClass(bucket: string): string {
  switch (bucket) {
    case "surge":
      return "border-terminal-pos/60 bg-terminal-pos/15";
    case "bullish":
      return "border-terminal-pos/40 bg-terminal-pos/10";
    case "up":
      return "border-terminal-pos/30 bg-terminal-pos/5";
    case "flush":
      return "border-terminal-neg/60 bg-terminal-neg/15";
    case "bearish":
      return "border-terminal-neg/40 bg-terminal-neg/10";
    case "down":
      return "border-terminal-neg/30 bg-terminal-neg/5";
    default:
      return "border-terminal-border bg-terminal-bg";
  }
}

export function CryptoHeatmapPanel({
  items,
  onSelect,
}: {
  items: CryptoHeatmapCell[];
  onSelect: (symbol: string) => void;
}) {
  return (
    <div className="grid min-w-0 gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }} data-testid="crypto-heatmap-panel">
      {items.map((item) => (
        <button
          key={item.symbol}
          type="button"
          className={`min-w-0 rounded border p-2 text-left text-xs transition hover:border-terminal-accent ${bucketClass(item.bucket)}`}
          onClick={() => onSelect(item.symbol)}
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-terminal-accent">{item.symbol}</span>
            <span className={item.change_24h >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{item.change_24h.toFixed(2)}%</span>
          </div>
          <div className="mt-2 text-sm text-terminal-text">{item.name}</div>
          <div className="mt-1 text-terminal-muted">{item.sector}</div>
          <div className="mt-1 text-xs text-terminal-muted">Market cap ${Math.round(item.market_cap).toLocaleString()}</div>
          <div className="mt-1 text-xs text-terminal-text">Depth {(item.depth_imbalance * 100).toFixed(1)}%</div>
        </button>
      ))}
    </div>
  );
}
