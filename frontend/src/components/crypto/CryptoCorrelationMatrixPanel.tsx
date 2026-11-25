export type CryptoCorrelationData = {
  symbols: string[];
  matrix: number[][];
};

function cellClass(value: number): string {
  if (value >= 0.7) return "bg-terminal-pos/20 text-terminal-pos";
  if (value >= 0.3) return "bg-terminal-pos/10 text-terminal-text";
  if (value <= -0.7) return "bg-terminal-neg/20 text-terminal-neg";
  if (value <= -0.3) return "bg-terminal-neg/10 text-terminal-text";
  return "bg-terminal-bg text-terminal-muted";
}

export function CryptoCorrelationMatrixPanel({ data }: { data: CryptoCorrelationData }) {
  const symbols = data.symbols || [];
  const matrix = data.matrix || [];

  return (
    <div role="region" aria-label="Crypto correlation table" tabIndex={0} className="min-w-0 max-w-full overflow-x-auto" data-testid="crypto-correlation-panel">
      <table className="w-full min-w-[560px] border-collapse text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
        <thead>
          <tr>
            <th className="border border-terminal-border p-2 text-left text-terminal-muted">Pair</th>
            {symbols.map((symbol) => (
              <th key={symbol} className="border border-terminal-border p-2 text-right text-terminal-muted">
                {symbol.replace("-USD", "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {symbols.map((left, i) => (
            <tr key={left}>
              <td className="border border-terminal-border p-2 text-terminal-accent">{left.replace("-USD", "")}</td>
              {symbols.map((right, j) => {
                const raw = matrix[i]?.[j];
                const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
                return (
                  <td
                    key={`${left}-${right}`}
                    className={`border border-terminal-border p-2 text-right ${value == null ? "bg-terminal-bg text-terminal-muted" : cellClass(value)}`}
                    data-testid={`corr-cell-${i}-${j}`}
                  >
                    {value == null ? "Unavailable" : value.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
