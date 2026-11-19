import { useEffect, useMemo, useRef, useState } from "react";
import { fetchPortfolioAnalyticsV2, fetchPortfolioHoldings, fetchPortfolioRiskMetrics, fetchPortfolioCorrelation, fetchPortfolioDividends, fetchPortfolioBenchmarkOverlay, type MultiPortfolio, type MultiPortfolioAnalytics, type MultiPortfolioHolding } from "../../api/client";
import type { PortfolioRiskMetrics, PortfolioCorrelationResponse, PortfolioDividendTracker, PortfolioBenchmarkOverlay } from "../../types";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalDataState } from "../terminal/TerminalPage";
import { PortfolioEventsCalendar } from "../PortfolioEventsCalendar";
import { RiskMetricsPanel } from "./RiskMetricsPanel";
import { PortfolioRiskAssessment } from "./PortfolioRiskAssessment";
import { CorrelationHeatmap } from "./CorrelationHeatmap";
import { DividendTracker } from "./DividendTracker";
import { BenchmarkOverlayChart } from "./BenchmarkOverlayChart";
import { AttributionPanel } from "./AttributionPanel";
import { BacktestResults } from "./BacktestResults";

/** Single-account analysis follows the page scope; it owns no selector or forms. */
export function PortfolioManager({ portfolio }: { portfolio: MultiPortfolio }) {
  const [data, setData] = useState<{ id: string; holdings: MultiPortfolioHolding[]; analytics: MultiPortfolioAnalytics } | null>(null);
  const [risk, setRisk] = useState<PortfolioRiskMetrics | null>(null);
  const [correlation, setCorrelation] = useState<PortfolioCorrelationResponse | null>(null);
  const [dividends, setDividends] = useState<PortfolioDividendTracker | null>(null);
  const [benchmark, setBenchmark] = useState<PortfolioBenchmarkOverlay | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const version = useRef(0);
  const current = data?.id === portfolio.id ? data : null;
  useEffect(() => {
    const generation = ++version.current;
    setData(null); setError(""); setRisk(null); setCorrelation(null); setDividends(null); setBenchmark(null);
    const active = () => generation === version.current;
    Promise.all([fetchPortfolioHoldings(portfolio.id), fetchPortfolioAnalyticsV2(portfolio.id)]).then(([holdings, analytics]) => {
      if (!active()) return;
      setData({ id: portfolio.id, holdings, analytics });
      const params = { benchmark: portfolio.benchmark_symbol || "S&P500", risk_free_rate: 0.04 };
      void fetchPortfolioRiskMetrics(params, portfolio.id).then(value => { if (active()) setRisk(value); }).catch(() => { if (active()) setRisk(null); });
      void fetchPortfolioCorrelation({ window: 60 }, portfolio.id).then(value => { if (active()) setCorrelation(value); }).catch(() => { if (active()) setCorrelation(null); });
      void fetchPortfolioDividends({ days: 180 }, portfolio.id).then(value => { if (active()) setDividends(value); }).catch(() => { if (active()) setDividends(null); });
      void fetchPortfolioBenchmarkOverlay({ benchmark: params.benchmark }, portfolio.id).then(value => { if (active()) setBenchmark(value); }).catch(() => { if (active()) setBenchmark(null); });
    }).catch(() => { if (active()) setError("Analysis for this portfolio could not be loaded. Previous account results are hidden."); });
    return () => { version.current++; };
  }, [portfolio.id, portfolio.benchmark_symbol, retry]);
  const symbols = useMemo(() => Array.from(new Set((current?.holdings || []).map(row => row.symbol).filter(Boolean))), [current]);
  return <section aria-label="Portfolio analysis" className="min-w-0 space-y-3">
    <div><h2 className="text-sm font-semibold text-terminal-text">Analysis · {portfolio.name}</h2><p className="text-xs text-terminal-muted">Single-portfolio risk and historical methods; these are separate from consolidated current values.</p></div>
    {error ? <TerminalDataState kind="error" title="Portfolio analysis unavailable" action={<TerminalButton onClick={() => setRetry(value => value + 1)}>Retry analysis</TerminalButton>}>{error}</TerminalDataState>
      : !current ? <TerminalDataState kind="loading" title="Loading portfolio analysis">Reading this account’s holdings and analytics.</TerminalDataState> : <>
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          <RiskMetricsPanel metrics={risk} />
          <PortfolioRiskAssessment key={portfolio.id} portfolioId={portfolio.id} disabled={false} holdings={current.holdings} metricsAvailable={!!risk} metrics={{ risk_metrics: risk || {}, allocation_by_sector: current.analytics.allocation_by_sector || [], correlation: correlation?.matrix || [] }} />
          <BenchmarkOverlayChart data={benchmark} />
          <CorrelationHeatmap data={correlation} />
        </div>
        {current.analytics.annualized_return != null && <p className="text-xs text-terminal-muted">Current-basket annualized return: {current.analytics.annualized_return.toFixed(2)}%. This is not a consolidated transaction-ledger return.</p>}
        <DividendTracker data={dividends} />
        <AttributionPanel portfolioId={portfolio.id} />
        {symbols.length > 0 && <PortfolioEventsCalendar symbols={symbols} days={30} />}
        <BacktestResults initialTickers={symbols} />
      </>}
  </section>;
}
