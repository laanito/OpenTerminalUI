type TickerEntry = {
  symbol: string;
  value: string;
  delta: string;
  up: boolean;
};

const TICKER_DATA: TickerEntry[] = [
  { symbol: "S&P 500", value: "5,762.48", delta: "24.30", up: true },
  { symbol: "NASDAQ", value: "18,340.10", delta: "89.40", up: false },
  { symbol: "DOW", value: "42,120.00", delta: "310.55", up: true },
  { symbol: "AAPL", value: "227.50", delta: "1.30", up: true },
  { symbol: "MSFT", value: "415.80", delta: "2.90", up: false },
  { symbol: "NVDA", value: "120.20", delta: "1.45", up: true },
  { symbol: "EURUSD", value: "1.0842", delta: "0.0008", up: false },
];

function TickerRow() {
  return (
    <div className="ot-market-ticker-row">
      {TICKER_DATA.map((item) => (
        <span key={item.symbol} className="ot-market-ticker-item">
          <span className="ot-market-ticker-symbol">{item.symbol}</span>{" "}
          <span>{item.value}</span>{" "}
          <span className={item.up ? "ot-value-up" : "ot-value-down"}>{item.up ? "?" : "?"}{item.delta}</span>
          <span className="ot-market-ticker-separator">|</span>
        </span>
      ))}
    </div>
  );
}

export function MarketTicker() {
  return (
    <div className="ot-market-ticker" aria-hidden>
      <div className="ot-market-ticker-track">
        <TickerRow />
        <TickerRow />
      </div>
    </div>
  );
}
