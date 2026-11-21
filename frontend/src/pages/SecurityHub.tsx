import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import {
  fetchNewsByTicker,
  fetchNewsSentiment,
  fetchSecurityHubEsg,
  fetchSecurityHubEstimates,
  fetchSecurityHubOwnership,
  fetchChartComparison,
  generateAdvancedReport,
} from "../api/client";
import { CatalystConvictionPanel } from "../components/dashboard/CatalystConvictionPanel";
import { GuidedEmptyState } from "../components/dashboard/GuidedEmptyState";
import { TradingChart } from "../components/chart/TradingChart";
import { TimeAndSales } from "../components/market/TimeAndSales";
import { InsiderStockDetail } from "../components/security/InsiderStockDetail";
import { DenseTable } from "../components/terminal/DenseTable";
import { SentimentBadge } from "../components/terminal/SentimentBadge";
import { SentimentChart } from "../components/terminal/SentimentChart";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalTabs, type TerminalTabItem } from "../components/terminal/TerminalTabs";
import { X, FileText } from "lucide-react";
import { useAnalystConsensus, useFinancials, usePeerComparison, useStock, useStockHistory } from "../hooks/useStocks";
import { quickAddToFirstPortfolio } from "../shared/portfolioQuickAdd";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";
import type { ChartPoint } from "../types";

type HubTab = "overview" | "financials" | "chart" | "news" | "ownership" | "estimates" | "peers" | "esg" | "tape" | "insider";

const HUB_TABS: TerminalTabItem[] = [
  { id: "overview", label: "Overview" },
  { id: "financials", label: "Financials" },
  { id: "chart", label: "Chart" },
  { id: "news", label: "News" },
  { id: "ownership", label: "Ownership" },
  { id: "estimates", label: "Estimates" },
  { id: "peers", label: "Peers" },
  { id: "esg", label: "ESG" },
];

const HUB_TAB_IDS: readonly HubTab[] = [
  ...HUB_TABS.map((item) => item.id as HubTab),
  // Compatibility-only tabs: accepted in old links, but not advertised while
  // their production data families are classified hidden by the v1.4 audit.
  "tape",
  "insider",
];

function MiniRangeBar({ low, high, current }: { low: number | null; high: number | null; current: number | null }) {
  if (low == null || high == null || current == null || !Number.isFinite(low + high + current) || high <= low) {
    return <div className="h-2 rounded bg-terminal-panel" />;
  }
  const pct = Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100));
  return (
    <div className="relative h-2 rounded bg-[#1A2332]">
      <div className="absolute inset-y-0 left-0 rounded bg-[#FF6B00]/20" style={{ width: `${pct}%` }} />
      <div className="absolute top-[-3px] h-3 w-[2px] bg-[#FF6B00]" style={{ left: `${pct}%` }} />
    </div>
  );
}

function TinyPriceChart({ points, ticker, loading, failed }: { points: ChartPoint[]; ticker: string; loading: boolean; failed: boolean }) {
  const values = points.map((point) => asNumber(point.c)).filter((value): value is number => value !== null);
  if (loading || failed || !values.length) return <p role={failed ? "alert" : "status"} className="rounded border border-terminal-border bg-terminal-bg p-3 text-xs text-terminal-muted">
    {loading ? "Loading price history…" : failed ? "Price history unavailable. Try again later." : "No price history is available for this security."}
  </p>;
  const width = 420;
  const height = 110;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-9, max - min);
  const poly = values
    .map((v, i) => `${(i / Math.max(1, values.length - 1)) * width},${height - ((v - min) / span) * height}`)
    .join(" ");
  const last = values[values.length - 1];
  const first = values[0];
  const up = last >= first;
  return (
    <svg role="img" aria-label={`${ticker} six-month price history`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-40 w-full rounded border border-terminal-border bg-terminal-bg">
      <polyline fill="none" stroke={up ? "#00e676" : "#ff3d3d"} strokeWidth="2" vectorEffect="non-scaling-stroke" points={poly} />
    </svg>
  );
}

function MetricCell({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <dl className="min-w-0 rounded-sm border border-terminal-border bg-terminal-panel px-2 py-2">
      <dt className="ot-type-label text-terminal-muted">{label}</dt>
      <dd className={`mt-1 break-words ${accent ? "text-terminal-accent" : "text-terminal-text"} ot-type-data text-sm`}>{value}</dd>
    </dl>
  );
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fmtNum(v: unknown) {
  const n = asNumber(v);
  if (n === null) return "-";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtPct(v: unknown) {
  const n = asNumber(v);
  if (n === null) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function TableSection({ title, count, loading, error, children }: { title: string; count: number; loading?: boolean; error?: unknown; children: ReactNode }) {
  return <section className="grid min-w-0 content-start gap-2" aria-label={title}>
    <h3 className="text-sm font-semibold text-terminal-text">{title}</h3>
    {loading ? <p role="status" className="text-xs text-terminal-muted">Loading {title.toLowerCase()}…</p>
      : error ? <p role="alert" className="text-xs text-terminal-neg">{title} unavailable. Try again later.</p>
        : count ? children : <p className="text-xs text-terminal-muted">No {title.toLowerCase()} available.</p>}
  </section>;
}

function tableHeight(count: number, maximum: number) {
  return Math.max(144, Math.min(maximum, 44 + count * 32));
}

export function SecurityHubPage() {
  const navigate = useNavigate();
  const { ticker: tickerParam } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const storeTicker = useStockStore((s) => s.ticker);
  const setTicker = useStockStore((s) => s.setTicker);
  const loadTicker = useStockStore((s) => s.load);
  const activeTicker = (tickerParam || searchParams.get("ticker") || storeTicker || "AAPL").toUpperCase();
  const tabFromUrl = (searchParams.get("tab") || "overview").toLowerCase() as HubTab;
  const tab = HUB_TAB_IDS.includes(tabFromUrl) ? tabFromUrl : "overview";
  const [newsSelectedIndex, setNewsSelectedIndex] = useState(0);
  const [compareSymbols, setCompareSymbols] = useState<string[]>(() => {
    const comp = searchParams.get("compare");
    if (!comp) return [];
    return comp.split(",").filter(Boolean).map(s => s.trim().toUpperCase());
  });
  const [compareInput, setCompareInput] = useState("");

  useEffect(() => {
    setTicker(activeTicker);
    void loadTicker();
  }, [activeTicker, loadTicker, setTicker]);

  const compareQuery = useQuery({
    queryKey: ["security-hub", "compare", activeTicker, compareSymbols.join(",")],
    queryFn: () => fetchChartComparison([activeTicker, ...compareSymbols], "1y", "1d"),
    enabled: tab === "chart" && compareSymbols.length > 0,
    staleTime: 60_000,
  });

  const comparisonSeriesData = useMemo(() => {
    if (!compareQuery.data || !compareQuery.data.dates) return [];
    const { dates, series } = compareQuery.data;
    const res: Array<{ symbol: string; data: ChartPoint[]; color?: string }> = [];
    const palette = ["#FF6B00", "#2196F3", "#00C853", "#FF1744", "#FFA726", "#9C27B0"];

    // Series keys should match what we sent
    [activeTicker, ...compareSymbols].forEach((sym, idx) => {
      const vals = series[sym];
      if (!vals) return;
      const data = dates.map((d, i) => {
        return {
          t: new Date(d).getTime() / 1000,
          c: vals[i],
          o: vals[i],
          h: vals[i],
          l: vals[i],
          v: 0
        };
      });
      res.push({
        symbol: sym,
        data,
        color: palette[idx % palette.length]
      });
    });
    return res;
  }, [compareQuery.data, activeTicker, compareSymbols]);

  const stockQuery = useStock(activeTicker);
  const historyQuery = useStockHistory(activeTicker, "6mo", "1d");
  const annualFinancialsQuery = useFinancials(activeTicker, "annual");
  const quarterlyFinancialsQuery = useFinancials(activeTicker, "quarterly");
  const peersQuery = usePeerComparison(activeTicker);
  const analystConsensusQuery = useAnalystConsensus(activeTicker);
  const tickerNewsQuery = useQuery({
    queryKey: ["security-hub", "news", selectedMarket, activeTicker],
    queryFn: () => fetchNewsByTicker(activeTicker, 20, selectedMarket),
    enabled: tab === "news",
    staleTime: 30_000,
  });
  const tickerSentimentQuery = useQuery({
    queryKey: ["security-hub", "news-sentiment", selectedMarket, activeTicker],
    queryFn: () => fetchNewsSentiment(activeTicker, 30, selectedMarket),
    enabled: tab === "news" || tab === "overview",
    staleTime: 60_000,
  });
  const ownershipQuery = useQuery({
    queryKey: ["security-hub", "ownership", activeTicker],
    queryFn: () => fetchSecurityHubOwnership(activeTicker, 25),
    enabled: tab === "ownership",
    staleTime: 60_000,
  });
  const estimatesQuery = useQuery({
    queryKey: ["security-hub", "estimates", activeTicker],
    queryFn: () => fetchSecurityHubEstimates(activeTicker, 24),
    enabled: tab === "estimates",
    staleTime: 60_000,
  });
  const esgQuery = useQuery({
    queryKey: ["security-hub", "esg", activeTicker],
    queryFn: () => fetchSecurityHubEsg(activeTicker, 10),
    enabled: tab === "esg",
    staleTime: 5 * 60_000,
  });

  const stock = (stockQuery.data ?? {}) as Record<string, unknown>;
  const histData = ((historyQuery.data as { data?: ChartPoint[] } | undefined)?.data ?? []) as ChartPoint[];
  const analyst = (analystConsensusQuery.data ?? {}) as Record<string, unknown>;
  const annual = (annualFinancialsQuery.data ?? {}) as Record<string, unknown>;
  const quarterly = (quarterlyFinancialsQuery.data ?? {}) as Record<string, unknown>;
  const peerPayload = (peersQuery.data ?? {}) as { peers?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> };
  const peerRows = (peerPayload.peers || peerPayload.items || []) as Array<Record<string, unknown>>;
  const ownershipPayload = (ownershipQuery.data ?? {}) as Record<string, unknown>;
  const ownershipShareholding = (ownershipPayload.shareholding ?? {}) as Record<string, unknown>;
  const institutionalHolders = ((ownershipPayload.institutional_holders ?? []) as Array<Record<string, unknown>>).slice(0, 25);
  const insiderRows = ((ownershipPayload.insider_transactions ?? []) as Array<Record<string, unknown>>).slice(0, 25);
  const estimatesPayload = (estimatesQuery.data ?? {}) as Record<string, unknown>;
  const analystEstimateRows = ((estimatesPayload.analyst_estimates ?? []) as Array<Record<string, unknown>>).slice(0, 24);
  const recommendationRows = ((estimatesPayload.recommendation_trends ?? []) as Array<Record<string, unknown>>).slice(0, 12);
  const priceTarget = (estimatesPayload.price_target ?? {}) as Record<string, unknown>;
  const esgPayload = (esgQuery.data ?? {}) as Record<string, unknown>;
  const esgLatest = (esgPayload.latest ?? {}) as Record<string, unknown>;
  const esgHistory = ((esgPayload.history ?? []) as Array<Record<string, unknown>>).slice(0, 20);
  const ownershipLoading = ownershipQuery.isLoading;
  const estimatesLoading = estimatesQuery.isLoading;
  const esgLoading = esgQuery.isLoading;
  const ownershipError = ownershipQuery.error instanceof Error ? ownershipQuery.error.message : null;
  const estimatesError = estimatesQuery.error instanceof Error ? estimatesQuery.error.message : null;
  const esgError = esgQuery.error instanceof Error ? esgQuery.error.message : null;

  useEffect(() => {
    if (tab !== "news") return;
    const maxIndex = Math.max(0, (tickerNewsQuery.data?.length ?? 0) - 1);
    setNewsSelectedIndex((v) => Math.max(0, Math.min(v, maxIndex)));
  }, [tab, tickerNewsQuery.data?.length]);

  const currentPrice = asNumber(stock.current_price);
  const week52Low = asNumber(stock["52w_low"] ?? stock.low_52_week);
  const week52High = asNumber(stock["52w_high"] ?? stock.high_52_week);
  const marketCap = stock.market_cap ?? stock.mcap;
  const peRatio = stock.pe ?? stock.pe_ratio;
  const dividendYield = stock.dividend_yield;
  const logoUrl = String(stock.logo || stock.image || stock.logo_url || stock.company_logo || "").trim();

  const financialRows = useMemo(() => {
    const periods = ((annual as { rows?: Array<Record<string, unknown>> }).rows ||
      (annual as { income_statement?: Array<Record<string, unknown>> }).income_statement ||
      (annual as { statements?: Array<Record<string, unknown>> }).statements ||
      []) as Array<Record<string, unknown>>;
    return periods.slice(0, 12);
  }, [annual]);

  const quarterlyRows = useMemo(() => {
    const periods = ((quarterly as { rows?: Array<Record<string, unknown>> }).rows ||
      (quarterly as { income_statement?: Array<Record<string, unknown>> }).income_statement ||
      (quarterly as { statements?: Array<Record<string, unknown>> }).statements ||
      []) as Array<Record<string, unknown>>;
    return periods.slice(0, 16);
  }, [quarterly]);

  return (
    <main aria-label="Security research" className="ot-security-hub min-h-full min-w-0 p-3 md:p-4">
      <div className="grid gap-2">
        <div className="rounded-sm border border-terminal-border bg-terminal-panel px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={`${activeTicker} logo`}
                    className="h-6 w-6 rounded-sm border border-terminal-border bg-terminal-bg object-contain"
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : null}
                <h1 className="break-words text-xl font-semibold text-terminal-text">{activeTicker}</h1>
                <TerminalBadge variant="accent">{String(stock.exchange || selectedMarket)}</TerminalBadge>
                {tickerSentimentQuery.data ? (
                  <SentimentBadge
                    label={tickerSentimentQuery.data.overall_label}
                    score={tickerSentimentQuery.data.average_score}
                    confidence={Math.abs(Number(tickerSentimentQuery.data.average_score || 0))}
                  />
                ) : null}
              </div>
              <div className="mt-1 text-sm text-terminal-muted">{String(stock.company_name || stock.name || "Security Hub")}</div>
            </div>
            <div role="group" aria-label="Current quote" className="grid w-full min-w-0 grid-cols-3 gap-2 sm:w-auto sm:min-w-[300px]">
              <MetricCell label="Last" value={fmtNum(currentPrice)} accent />
              <MetricCell label="Change %" value={fmtPct(stock.change_pct)} />
              <MetricCell label="Volume" value={fmtNum(stock.volume)} />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <TerminalTabs
              ariaLabel="Security research sections"
              panelId="security-research-panel"
              items={HUB_TABS}
              value={tab}
              onChange={(id) => {
                const next = new URLSearchParams(searchParams);
                next.set("tab", id);
                setSearchParams(next, { replace: true });
              }}
              variant="accent"
            />
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <TerminalButton
                size="sm"
                variant="default"
                onClick={() => navigate(`/equity/market-context?symbol=${encodeURIComponent(activeTicker)}`)}
              >
                CROSS-MARKET CONTEXT
              </TerminalButton>
              <TerminalButton
                size="sm"
                variant="default"
                leftIcon={<FileText size={14} />}
                onClick={async () => {
                  try {
                    const blob = await generateAdvancedReport("stock", { ticker: activeTicker });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `Report_${activeTicker}.pdf`;
                    a.click();
                    window.URL.revokeObjectURL(url);
                  } catch (e) {
                    console.error("Export failed", e);
                  }
                }}
              >
                EXPORT REPORT
              </TerminalButton>
            </div>
          </div>
        </div>

        {stockQuery.isError ? <p role="alert" className="text-xs text-terminal-neg">Quote data unavailable for {activeTicker}. Other research sections remain available.</p> : null}
        <div role="tabpanel" id="security-research-panel" aria-label={`${activeTicker} ${HUB_TABS.find(item => item.id === tab)?.label || tab}`} tabIndex={0} className="min-w-0">
        {tab === "overview" ? (
          <div className="ot-security-overview">
            <div className="grid min-w-0 content-start gap-3">
            <TerminalPanel title="Overview" subtitle="Valuation and trading range" bodyClassName="grid gap-3">
              <div className="ot-security-metrics">
                <MetricCell label="Market Cap" value={fmtNum(marketCap)} />
                <MetricCell label="P/E" value={fmtNum(peRatio)} />
                <MetricCell label="Div Yield" value={fmtPct(dividendYield)} />
                <MetricCell label="52-week range" value={`${fmtNum(week52Low)} – ${fmtNum(week52High)}`} />
              </div>
              <div className="grid min-w-0 gap-3">
                <div>
                  <div className="mb-1 ot-type-label text-terminal-muted">52-Week Position</div>
                  <MiniRangeBar low={Number.isFinite(week52Low) ? week52Low : null} high={Number.isFinite(week52High) ? week52High : null} current={Number.isFinite(currentPrice) ? currentPrice : null} />
                </div>
                <div className="grid min-w-0 grid-cols-3 gap-2">
                <MetricCell label="Open" value={fmtNum(stock.open)} />
                <MetricCell label="High" value={fmtNum(stock.day_high ?? stock.high)} />
                <MetricCell label="Low" value={fmtNum(stock.day_low ?? stock.low)} />
                </div>
              </div>

            </TerminalPanel>

              <CatalystConvictionPanel
                key={activeTicker}
                symbol={activeTicker}
                market={selectedMarket}
                onOpenScreener={() => navigate(`/equity/screener?symbol=${encodeURIComponent(activeTicker)}`)}
              />
            </div>
            <aside aria-label="Security context" className="grid min-w-0 content-start gap-3">
            <TerminalPanel title="6M Price Chart" subtitle="Compact overview chart" bodyClassName="space-y-2">
              <TinyPriceChart points={histData} ticker={activeTicker} loading={historyQuery.isLoading} failed={historyQuery.isError} />
              <div className="grid min-w-0 grid-cols-3 gap-2">
                <MetricCell label="Prev Close" value={fmtNum(stock.previous_close)} />
                <MetricCell label="Avg Volume" value={fmtNum(stock.avg_volume)} />
                <MetricCell label="Beta" value={fmtNum(stock.beta)} />
              </div>
            </TerminalPanel>
              <div className="grid min-w-0 gap-3">
                <div className="rounded-sm border border-terminal-border bg-terminal-bg p-2">
                  <div className="mb-1 ot-type-label text-terminal-muted">Analyst Consensus</div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <div className="relative h-3 flex-1 rounded bg-[#1A2332]">
                      <div className="absolute inset-y-0 left-0 bg-emerald-500/35" style={{ width: `${Math.min(100, Math.max(0, Number(analyst.buy_pct) || 0))}%` }} />
                      <div className="absolute inset-y-0 bg-amber-500/35" style={{ left: `${Math.min(100, Math.max(0, Number(analyst.buy_pct) || 0))}%`, width: `${Math.min(100, Math.max(0, Number(analyst.hold_pct) || 0))}%` }} />
                      <div className="absolute inset-y-0 bg-rose-500/35" style={{ left: `${Math.min(100, Math.max(0, (Number(analyst.buy_pct) || 0) + (Number(analyst.hold_pct) || 0)))}%`, width: `${Math.min(100, Math.max(0, Number(analyst.sell_pct) || 0))}%` }} />
                    </div>
                    <TerminalBadge variant="neutral">{String(analyst.consensus || "N/A")}</TerminalBadge>
                  </div>
                </div>
                <div className="rounded-sm border border-terminal-border bg-terminal-bg p-2">
                  <div className="mb-1 ot-type-label text-terminal-muted">Classification</div>
                  <div className="grid min-w-0 gap-2 text-xs">
                    <div><span className="text-terminal-muted">Sector:</span> <span>{String(stock.sector || "-")}</span></div>
                    <div><span className="text-terminal-muted">Industry:</span> <span>{String(stock.industry || "-")}</span></div>
                    <div><span className="text-terminal-muted">Country:</span> <span>{String(stock.country || stock.country_code || "-")}</span></div>
                    <div><span className="text-terminal-muted">Currency:</span> <span>{String(stock.currency || "-")}</span></div>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        ) : null}

        {tab === "financials" ? (
          <div className="grid gap-2">
            <TerminalPanel title="Financials" subtitle="Reported annual and quarterly statements">
              <div className="grid gap-3">
                <TableSection title="Annual financial statements" count={financialRows.length} loading={annualFinancialsQuery.isLoading} error={annualFinancialsQuery.error}>
                  <DenseTable
                    ariaLabel="Annual financial statements"
                    rowHeight={32}
                    headerHeight={44}
                    id={`sec-hub-fin-annual-${activeTicker}`}
                    rows={financialRows}
                    columns={[
                      { key: "date", title: "Period", type: "text", frozen: true, width: 120, sortable: true, getValue: (r) => r.date || r.fiscalDateEnding || r.period },
                      { key: "revenue", title: "Revenue", type: "large-number", align: "right", sortable: true, getValue: (r) => r.revenue ?? r.totalRevenue },
                      { key: "netIncome", title: "Net Income", type: "large-number", align: "right", sortable: true, getValue: (r) => r.netIncome ?? r.net_income },
                      { key: "eps", title: "EPS", type: "number", align: "right", sortable: true, getValue: (r) => r.eps ?? r.epsDiluted },
                    ]}
                    rowKey={(row, idx) => `${String(row.date || row.fiscalDateEnding || idx)}`}
                    height={tableHeight(financialRows.length, 300)}
                  />
                </TableSection>
                <TableSection title="Quarterly financial statements" count={quarterlyRows.length} loading={quarterlyFinancialsQuery.isLoading} error={quarterlyFinancialsQuery.error}>
                  <DenseTable
                    ariaLabel="Quarterly financial statements"
                    rowHeight={32}
                    headerHeight={44}
                    id={`sec-hub-fin-quarter-${activeTicker}`}
                    rows={quarterlyRows}
                    columns={[
                      { key: "date", title: "Quarter", type: "text", frozen: true, width: 120, sortable: true, getValue: (r) => r.date || r.fiscalDateEnding || r.period },
                      { key: "revenue", title: "Revenue", type: "large-number", align: "right", sortable: true, getValue: (r) => r.revenue ?? r.totalRevenue },
                      { key: "ebitda", title: "EBITDA", type: "large-number", align: "right", sortable: true, getValue: (r) => r.ebitda },
                      { key: "netIncome", title: "Net Income", type: "large-number", align: "right", sortable: true, getValue: (r) => r.netIncome ?? r.net_income },
                    ]}
                    rowKey={(row, idx) => `q-${String(row.date || row.fiscalDateEnding || idx)}`}
                    height={tableHeight(quarterlyRows.length, 320)}
                  />
                </TableSection>
              </div>
            </TerminalPanel>
          </div>
        ) : null}

        {tab === "chart" ? (
          <TerminalPanel
            title="Chart"
            subtitle="Security price history"
            actions={
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  {compareSymbols.map(sym => (
                    <div key={sym} className="flex items-center gap-1 rounded bg-terminal-accent/20 px-2 py-0.5 text-xs text-terminal-accent">
                      {sym}
                      <button type="button" aria-label={`Remove ${sym} comparison`} onClick={() => setCompareSymbols(p => p.filter(s => s !== sym))} className="rounded p-1 hover:text-terminal-accent focus-visible:outline focus-visible:outline-terminal-accent"><X size={14} /></button>
                    </div>
                  ))}
                </div>
                {compareSymbols.length < 5 && (
                  <form onSubmit={(e) => { e.preventDefault(); const val = compareInput.trim().toUpperCase(); if (val && !compareSymbols.includes(val)) { setCompareSymbols(p => [...p, val]); } setCompareInput(""); }} className="flex min-w-0 flex-wrap items-center gap-1">
                    <input
                      aria-label="Add comparison symbol" className="w-40 max-w-full rounded border border-terminal-border bg-terminal-bg px-2 py-0.5 text-xs outline-none placeholder:text-terminal-muted focus:border-terminal-accent"
                      placeholder="+ Compare"
                      value={compareInput}
                      onChange={(e) => setCompareInput(e.target.value)}
                    />
                    <TerminalButton type="submit" size="sm">Add</TerminalButton>
                  </form>
                )}
              </div>
            }
          >
            <div className="grid gap-2">
              <div className="h-[min(520px,65vh)] min-h-[280px]">
                <TradingChart
                  ticker={activeTicker}
                  data={compareSymbols.length > 0 ? (comparisonSeriesData.find(s => s.symbol === activeTicker)?.data || histData) : histData}
                  mode="candles"
                  timeframe="1D"
                  panelId={`security-hub-chart-${activeTicker}`}
                  crosshairSyncGroupId="security-hub"
                  comparisonSeries={compareSymbols.length > 0 ? comparisonSeriesData.filter(s => s.symbol !== activeTicker) : []}
                  onAddToPortfolio={(symbol, priceHint) => {
                    void quickAddToFirstPortfolio(symbol, priceHint, "Added from Security Hub chart", String(stock?.currency || "") || null);
                  }}
                />
              </div>
            </div>
          </TerminalPanel>
        ) : null}

        {tab === "news" ? (
          <TerminalPanel title="News" subtitle={`Ticker-specific news (${activeTicker})`}>
            <div className="mb-2">
              <SentimentChart data={tickerSentimentQuery.data?.daily_sentiment ?? []} height={140} />
            </div>
            <div
              role="region"
              aria-label="Security headlines"
              className="max-h-[480px] min-w-0 overflow-auto"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key.toLowerCase() === "j") {
                  event.preventDefault();
                  setNewsSelectedIndex((v) => Math.min((tickerNewsQuery.data?.length ?? 1) - 1, v + 1));
                } else if (event.key.toLowerCase() === "k") {
                  event.preventDefault();
                  setNewsSelectedIndex((v) => Math.max(0, v - 1));
                }
              }}
            >
              {(tickerNewsQuery.data ?? []).length ? (
                <div className="grid gap-1">
                  {(tickerNewsQuery.data ?? []).map((item, idx) => (
                    (() => {
                      const sentimentLabel = String((item as Record<string, unknown>).sentiment_label || (item as Record<string, unknown>).sentiment || "");
                      const publishedAt = typeof item.published_at === "string" ? item.published_at : "";
                      return (
                    <a
                      key={`${item.id}-${item.published_at}`}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className={`grid gap-1 rounded-sm border px-2 py-2 hover:border-terminal-accent ${idx === newsSelectedIndex ? "border-terminal-accent bg-terminal-accent/10" : "border-terminal-border bg-terminal-bg"}`}
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <TerminalBadge variant="neutral">{String(item.source || "NEWS")}</TerminalBadge>
                        {sentimentLabel ? (
                          <SentimentBadge
                            label={sentimentLabel}
                            score={Number((item as Record<string, unknown>).sentiment_score ?? 0)}
                            confidence={Number((item as Record<string, unknown>).sentiment_confidence ?? 0)}
                          />
                        ) : null}
                        <span className="text-xs text-terminal-muted">{publishedAt ? new Date(publishedAt).toLocaleString() : "N/A"}</span>
                      </div>
                      <div className="text-sm text-terminal-text">{item.title}</div>
                    </a>
                      );
                    })()
                  ))}
                </div>
              ) : (
                <GuidedEmptyState
                  title={tickerNewsQuery.isLoading ? "Loading news" : tickerNewsQuery.error ? "News feed degraded" : "No ticker news yet"}
                  message="Create an alert or use the screener to put this symbol into an active research workflow."
                  icon="NEWS"
                  actions={[
                    { label: "Alerts", href: "/equity/alerts" },
                    { label: "Screener", href: "/equity/screener" },
                  ]}
                />
              )}
            </div>
          </TerminalPanel>
        ) : null}

        {tab === "ownership" ? (
          <TerminalPanel title="Ownership" subtitle="Institutional holders + insider transactions">
            {ownershipLoading ? (
              <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-3 text-xs text-terminal-muted">Loading ownership data...</div>
            ) : ownershipError ? (
              <div className="rounded border border-rose-500/50 bg-rose-500/10 px-2 py-3 text-xs text-rose-300">Ownership data unavailable: {ownershipError}</div>
            ) : (
            <div className="grid gap-2">
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <MetricCell label="Promoter %" value={fmtNum(ownershipShareholding.promoter_holding)} />
                <MetricCell label="FII %" value={fmtNum(ownershipShareholding.fii_holding)} />
                <MetricCell label="DII %" value={fmtNum(ownershipShareholding.dii_holding)} />
                <MetricCell label="Public %" value={fmtNum(ownershipShareholding.public_holding)} />
              </div>
              <TableSection title="Institutional holders" count={institutionalHolders.length}>
                <DenseTable
                  ariaLabel="Institutional holders"
                  rowHeight={32}
                  headerHeight={44}
                  id={`sec-hub-ownership-inst-${activeTicker}`}
                  rows={institutionalHolders}
                  columns={[
                    { key: "holder", title: "Holder", type: "text", width: 440, sortable: true, getValue: (r) => r.holder || r.holderName || r.investorName },
                    { key: "shares", title: "Shares", type: "volume", align: "right", sortable: true, getValue: (r) => r.shares ?? r.sharesNumber ?? r.position },
                    { key: "change", title: "Change", type: "number", align: "right", sortable: true, getValue: (r) => r.change ?? r.changeInShares },
                    { key: "date", title: "Reported", type: "text", width: 140, sortable: true, getValue: (r) => r.date_reported || r.reportDate || r.dateReported },
                  ]}
                  rowKey={(row, idx) => String(row.holder || row.holderName || idx)}
                  height={tableHeight(institutionalHolders.length, 280)}
                />
              </TableSection>
              <TableSection title="Insider transactions" count={insiderRows.length}>
                <DenseTable
                  ariaLabel="Insider transactions"
                  rowHeight={32}
                  headerHeight={44}
                  id={`sec-hub-ownership-insider-${activeTicker}`}
                  rows={insiderRows}
                  columns={[
                    { key: "name", title: "Insider", type: "text", width: 340, sortable: true, getValue: (r) => r.name || r.insiderName || r.shareholder },
                    { key: "transactionDate", title: "Date", type: "text", width: 130, sortable: true, getValue: (r) => r.transactionDate || r.filingDate },
                    { key: "transactionCode", title: "Type", type: "text", width: 90, sortable: true, getValue: (r) => r.transactionCode || r.transactionType },
                    { key: "change", title: "Change", type: "volume", align: "right", sortable: true, getValue: (r) => r.change ?? r.share },
                    { key: "price", title: "Price", type: "currency", align: "right", sortable: true, getValue: (r) => r.transactionPrice ?? r.price },
                  ]}
                  rowKey={(row, idx) => `ins-${String(row.name || row.insiderName || idx)}-${String(row.transactionDate || row.filingDate || idx)}`}
                  height={tableHeight(insiderRows.length, 260)}
                />
              </TableSection>
            </div>
            )}
          </TerminalPanel>
        ) : null}

        {tab === "estimates" ? (
          <TerminalPanel title="Estimates" subtitle="Analyst estimates + targets">
            {estimatesLoading ? (
              <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-3 text-xs text-terminal-muted">Loading estimates...</div>
            ) : estimatesError ? (
              <div className="rounded border border-rose-500/50 bg-rose-500/10 px-2 py-3 text-xs text-rose-300">Estimates unavailable: {estimatesError}</div>
            ) : (
            <div className="grid gap-2 lg:grid-cols-2">
              <div className="rounded-sm border border-terminal-border bg-terminal-bg p-2">
                <div className="mb-1 ot-type-label text-terminal-muted">Consensus Snapshot</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <MetricCell label="Consensus" value={String(analyst.consensus || "N/A")} />
                  <MetricCell label="Target Px" value={fmtNum(priceTarget.targetMean ?? priceTarget.targetMedian ?? analyst.target_price ?? analyst.price_target)} />
                  <MetricCell label="Buy %" value={fmtPct(analyst.buy_pct)} />
                  <MetricCell label="Hold %" value={fmtPct(analyst.hold_pct)} />
                </div>
              </div>
              <TableSection title="Analyst recommendations" count={recommendationRows.length}>
                <DenseTable
                  ariaLabel="Analyst recommendations"
                  rowHeight={32}
                  headerHeight={44}
                  id={`sec-hub-est-rec-${activeTicker}`}
                  rows={recommendationRows}
                  columns={[
                    { key: "period", title: "Period", type: "text", frozen: true, width: 120, sortable: true, getValue: (r) => r.period },
                    { key: "buy", title: "Buy", type: "number", align: "right", sortable: true, getValue: (r) => r.buy ?? r.strongBuy },
                    { key: "hold", title: "Hold", type: "number", align: "right", sortable: true, getValue: (r) => r.hold },
                    { key: "sell", title: "Sell", type: "number", align: "right", sortable: true, getValue: (r) => r.sell || r.strongSell },
                  ]}
                  rowKey={(row, idx) => `rec-${String(row.period || idx)}`}
                  height={tableHeight(recommendationRows.length, 180)}
                />
              </TableSection>
              <div className="lg:col-span-2">
                <TableSection title="Analyst estimates" count={analystEstimateRows.length}>
                  <DenseTable
                    ariaLabel="Analyst estimates"
                    rowHeight={32}
                    headerHeight={44}
                    id={`sec-hub-est-fmp-${activeTicker}`}
                    rows={analystEstimateRows}
                    columns={[
                      { key: "date", title: "Date", type: "text", frozen: true, width: 130, sortable: true, getValue: (r) => r.date || r.period },
                      { key: "estimatedRevenueAvg", title: "Mean revenue estimate", width: 200, type: "large-number", align: "right", sortable: true, getValue: (r) => r.estimatedRevenueAvg ?? r.revenueAvgEstimate },
                      { key: "estimatedEpsAvg", title: "Mean EPS estimate", width: 180, type: "number", align: "right", sortable: true, getValue: (r) => r.estimatedEpsAvg ?? r.epsAvgEstimate },
                      { key: "numberAnalystEstimatedRevenue", title: "Revenue analysts", width: 170, type: "number", align: "right", sortable: true, getValue: (r) => r.numberAnalystEstimatedRevenue ?? r.numberAnalysts },
                      { key: "numberAnalystsEstimatedEps", title: "EPS analysts", width: 150, type: "number", align: "right", sortable: true, getValue: (r) => r.numberAnalystsEstimatedEps ?? r.numberAnalysts },
                    ]}
                    rowKey={(row, idx) => `fmp-est-${String(row.date || row.period || idx)}`}
                    height={tableHeight(analystEstimateRows.length, 260)}
                  />
                </TableSection>
              </div>
            </div>
            )}
          </TerminalPanel>
        ) : null}

        {tab === "peers" ? (
          <TerminalPanel title="Peers" subtitle="Comparable companies">
            <TableSection title="Comparable companies" count={peerRows.length} loading={peersQuery.isLoading} error={peersQuery.error}>
              <DenseTable
                ariaLabel="Comparable companies"
                rowHeight={32}
                headerHeight={44}
                id={`sec-hub-peers-${activeTicker}`}
                rows={peerRows}
                columns={[
                  { key: "symbol", title: "Symbol", type: "text", frozen: true, width: 110, sortable: true, getValue: (r) => r.symbol || r.ticker },
                  { key: "name", title: "Name", type: "text", width: 440, sortable: true, getValue: (r) => r.name || r.company_name },
                  { key: "marketCap", title: "Market cap", type: "large-number", align: "right", sortable: true, getValue: (r) => r.market_cap ?? r.mcap },
                  { key: "pe", title: "P/E", type: "number", align: "right", sortable: true, getValue: (r) => r.pe ?? r.pe_ratio },
                  { key: "chgPct", title: "Change %", type: "percent", align: "right", sortable: true, getValue: (r) => r.change_pct },
                ]}
                rowKey={(row, idx) => String(row.symbol || row.ticker || idx)}
                height={tableHeight(peerRows.length, 420)}
                onRowOpenInChart={(row) => {
                  const symbol = String((row as Record<string, unknown>).symbol || (row as Record<string, unknown>).ticker || "").toUpperCase();
                  if (!symbol) return;
                  setTicker(symbol);
                  void loadTicker();
                }}
              />
            </TableSection>
          </TerminalPanel>
        ) : null}

        {tab === "esg" ? (
          <TerminalPanel title="ESG" subtitle="ESG ratings and scores">
            {esgLoading ? (
              <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-3 text-xs text-terminal-muted">Loading ESG data...</div>
            ) : esgError ? (
              <div className="rounded border border-rose-500/50 bg-rose-500/10 px-2 py-3 text-xs text-rose-300">ESG data unavailable: {esgError}</div>
            ) : (
            <div className="grid gap-2 lg:grid-cols-3">
              <MetricCell label="Environmental" value={fmtNum(esgLatest.environmentalScore ?? esgLatest.environmental_score ?? (stock as Record<string, unknown>).esg_environment)} />
              <MetricCell label="Social" value={fmtNum(esgLatest.socialScore ?? esgLatest.social_score ?? (stock as Record<string, unknown>).esg_social)} />
              <MetricCell label="Governance" value={fmtNum(esgLatest.governanceScore ?? esgLatest.governance_score ?? (stock as Record<string, unknown>).esg_governance)} />
              <MetricCell label="Total ESG" value={fmtNum(esgLatest.ESGScore ?? esgLatest.esgScore ?? esgLatest.esg_score)} />
              <MetricCell label="Risk Rating" value={String(esgLatest.rating || esgLatest.esgRiskRating || "N/A")} />
              <MetricCell label="Date" value={String(esgLatest.date || esgLatest.asOfDate || "N/A")} />
              <div className="lg:col-span-3">
                <TableSection title="ESG history" count={esgHistory.length}>
                  <DenseTable
                    ariaLabel="ESG history"
                    rowHeight={32}
                    headerHeight={44}
                    id={`sec-hub-esg-${activeTicker}`}
                    rows={esgHistory}
                    columns={[
                      { key: "date", title: "Date", type: "text", frozen: true, width: 130, sortable: true, getValue: (r) => r.date || r.asOfDate },
                      { key: "environmental", title: "Environmental", width: 160, type: "number", align: "right", sortable: true, getValue: (r) => r.environmentalScore ?? r.environmental_score },
                      { key: "social", title: "Social", type: "number", align: "right", sortable: true, getValue: (r) => r.socialScore ?? r.social_score },
                      { key: "governance", title: "Governance", width: 150, type: "number", align: "right", sortable: true, getValue: (r) => r.governanceScore ?? r.governance_score },
                      { key: "esg", title: "Total", type: "number", align: "right", sortable: true, getValue: (r) => r.ESGScore ?? r.esgScore ?? r.esg_score },
                    ]}
                    rowKey={(row, idx) => `esg-${String(row.date || row.asOfDate || idx)}`}
                    height={tableHeight(esgHistory.length, 260)}
                  />
                </TableSection>
              </div>
            </div>
            )}
          </TerminalPanel>
        ) : null}

        {tab === "tape" ? (
          <div className="min-h-[780px]">
            <TimeAndSales ticker={activeTicker} className="min-h-[780px]" />
          </div>
        ) : null}

        {tab === "insider" ? <InsiderStockDetail ticker={activeTicker} /> : null}
        </div>
      </div>
    </main>
  );
}
