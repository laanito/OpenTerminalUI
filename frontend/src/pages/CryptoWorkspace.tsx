import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import {
  fetchCryptoDominance,
  fetchCryptoIndex,
  fetchCryptoMarkets,
  fetchCryptoMovers,
  fetchCryptoSectors,
  type CryptoMarketRow,
  type CryptoMarketsQuery,
  type CryptoMoverRow,
} from "../api/client";
import { DegradedBanner } from "../components/common/DegradedBanner";
import type { DegradedInfo } from "../api/types";
import { CryptoCorrelationMatrixPanel } from "../components/crypto/CryptoCorrelationMatrixPanel";
import { CryptoDefiPanel } from "../components/crypto/CryptoDefiPanel";
import { CryptoDerivativesPanel } from "../components/crypto/CryptoDerivativesPanel";
import { CryptoHeatmapPanel } from "../components/crypto/CryptoHeatmapPanel";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { useStockStore } from "../store/stockStore";

type CryptoTab = "markets" | "movers" | "index" | "sectors" | "heatmap" | "derivatives" | "defi" | "correlation";

type HeatmapResponse = {
  ts?: string;
  items: Array<{
    symbol: string;
    name: string;
    sector: string;
    change_24h: number;
    market_cap: number;
    depth_imbalance: number;
    bucket: string;
  }>;
  degraded?: DegradedInfo | null;
};

type DerivativesResponse = {
  ts?: string;
  items: Array<{
    symbol: string;
    funding_rate_8h: number;
    open_interest_usd: number;
    long_liquidations_24h: number;
    short_liquidations_24h: number;
    liquidations_24h: number;
  }>;
  totals: {
    open_interest_usd: number;
    long_liquidations_24h: number;
    short_liquidations_24h: number;
    liquidations_24h: number;
  };
  degraded?: DegradedInfo | null;
};

type DefiResponse = {
  ts?: string;
  degraded?: DegradedInfo | null;
  headline: {
    tvl_usd: number;
    dex_volume_24h: number;
    lending_borrowed_usd: number;
    defi_change_24h: number;
  };
  protocols: Array<{
    symbol: string;
    name: string;
    change_24h: number;
    dominance_pct: number;
    tvl_proxy_usd: number;
  }>;
};

type CorrelationResponse = {
  ts?: string;
  degraded?: DegradedInfo | null;
  symbols: string[];
  matrix: number[][];
  window: number;
};

const TAB_META: Record<CryptoTab, { title: string; subtitle: string }> = {
  markets: { title: "Market Board", subtitle: "Search, rank, and route the liquid crypto universe" },
  movers: { title: "Movers", subtitle: "Leaders, laggards, and tape pressure" },
  index: { title: "Index Monitor", subtitle: "Top basket proxy for index-level positioning" },
  sectors: { title: "Sector Rotation", subtitle: "Current 24h sector baskets, not historical rotation" },
  heatmap: { title: "Heatmap", subtitle: "Asset grid with returned market cap and depth imbalance" },
  derivatives: { title: "Derivatives", subtitle: "Funding, open interest, and liquidation pressure" },
  defi: { title: "DeFi", subtitle: "Modelled market-cap and volume proxies, not observed on-chain activity" },
  correlation: { title: "Correlation", subtitle: "Rolling return relationship map" },
};

function pctClass(v: number): string {
  if (!Number.isFinite(v)) return "text-terminal-muted";
  return v >= 0 ? "text-terminal-pos" : "text-terminal-neg";
}

function normalizeChartSymbol(symbol: string): string {
  return symbol.replace("-USD", "").toUpperCase();
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatCurrencyCompact(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return `$${formatCompact(value)}`;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "--";
  const maximumFractionDigits = value >= 1000 ? 2 : value >= 1 ? 2 : 4;
  return value.toLocaleString("en-US", { maximumFractionDigits });
}

function fixed(value: unknown, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "Unavailable";
}

function signedPct(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

async function fetchCryptoAdvanced<T>(path: string): Promise<T> {
  const base = import.meta.env.VITE_API_BASE_URL || "/api";
  const response = await fetch(`${base}${path}`);
  if (!response.ok) {
    throw new Error(`Crypto endpoint failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function MetricCard({
  label,
  value,
  detail,
  tone = "text-terminal-text",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 rounded border border-terminal-border bg-terminal-bg/80 p-3">
      <div className="text-xs uppercase text-terminal-muted">{label}</div>
      <div className={`mt-1 text-lg ${tone}`}>{value}</div>
      <div className="mt-1 text-xs text-terminal-muted">{detail}</div>
    </div>
  );
}

export function CryptoWorkspacePage() {
  const navigate = useNavigate();
  const setTicker = useStockStore((s) => s.setTicker);
  const moduleRef = useRef<HTMLElement>(null);
  const focusRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<CryptoTab>("markets");
  const [moversMetric, setMoversMetric] = useState("gainers");
  const [corrWindow, setCorrWindow] = useState(30);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("all");
  const [sortBy, setSortBy] = useState<NonNullable<CryptoMarketsQuery["sortBy"]>>("market_cap");
  const [sortOrder, setSortOrder] = useState<NonNullable<CryptoMarketsQuery["sortOrder"]>>("desc");

  const marketsQuery = useQuery({
    queryKey: ["crypto", "markets", query, sector, sortBy, sortOrder],
    queryFn: () =>
      fetchCryptoMarkets({
        limit: 120,
        q: query || undefined,
        sector: sector === "all" ? undefined : sector,
        sortBy,
        sortOrder,
      }),
    retry: false,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const moversQuery = useQuery({
    queryKey: ["crypto", "movers", moversMetric],
    queryFn: () => fetchCryptoMovers(moversMetric, 20),
    retry: false,
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
  const dominanceQuery = useQuery({
    queryKey: ["crypto", "dominance"],
    queryFn: fetchCryptoDominance,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const indexQuery = useQuery({
    queryKey: ["crypto", "index"],
    queryFn: () => fetchCryptoIndex(10),
    retry: false,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const sectorsQuery = useQuery({
    queryKey: ["crypto", "sectors"],
    queryFn: fetchCryptoSectors,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const heatmapQuery = useQuery({
    queryKey: ["crypto", "heatmap"],
    queryFn: () => fetchCryptoAdvanced<HeatmapResponse>("/v1/crypto/heatmap?limit=48"),
    retry: false,
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
  const derivativesQuery = useQuery({
    queryKey: ["crypto", "derivatives"],
    queryFn: () => fetchCryptoAdvanced<DerivativesResponse>("/v1/crypto/derivatives?limit=24"),
    retry: false,
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
  const defiQuery = useQuery({
    queryKey: ["crypto", "defi"],
    queryFn: () => fetchCryptoAdvanced<DefiResponse>("/v1/crypto/defi"),
    retry: false,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const correlationQuery = useQuery({
    queryKey: ["crypto", "correlation", corrWindow],
    queryFn: () => fetchCryptoAdvanced<CorrelationResponse>(`/v1/crypto/correlation?window=${corrWindow}&limit=8`),
    retry: false,
    staleTime: 45_000,
    refetchInterval: 45_000,
  });

  const marketRows = marketsQuery.data || [];
  const moverRows = moversQuery.data || [];

  useEffect(() => {
    if (marketsQuery.data === undefined) return;
    if (!marketRows.length) {
      setSelectedSymbol("");
      return;
    }
    if (!selectedSymbol || !marketRows.some((row) => row.symbol === selectedSymbol)) {
      setSelectedSymbol(marketRows[0].symbol);
    }
  }, [marketRows, selectedSymbol, marketsQuery.data]);

  const selectedAsset = useMemo(
    () => marketRows.find((row) => row.symbol === selectedSymbol) ?? marketRows[0] ?? null,
    [marketRows, selectedSymbol],
  );
  const totalMarketCap = useMemo(
    () => marketRows.reduce((sum, row) => sum + (Number(row.market_cap) || 0), 0),
    [marketRows],
  );
  const totalVolume = useMemo(
    () => marketRows.reduce((sum, row) => sum + (Number(row.volume_24h) || 0), 0),
    [marketRows],
  );
  const advancers = useMemo(() => marketRows.filter((row) => row.change_24h >= 0).length, [marketRows]);
  const breadthPct = marketRows.length ? Math.round((advancers / marketRows.length) * 100) : 0;
  const sectorOptions = useMemo(() => {
    const fromSectors = (sectorsQuery.data || []).map((item) => item.sector).filter(Boolean);
    const fromMarkets = marketRows.map((row) => row.sector).filter(Boolean);
    return Array.from(new Set(["all", ...fromSectors, ...fromMarkets]));
  }, [marketRows, sectorsQuery.data]);
  const radarBoard = useMemo(() => {
    const seen = new Set<string>();
    const items: CryptoMarketRow[] = [];
    for (const row of marketRows.slice(0, 6)) {
      if (seen.has(row.symbol)) continue;
      seen.add(row.symbol);
      items.push(row);
    }
    for (const row of moverRows) {
      if (items.length >= 10) break;
      if (seen.has(row.symbol)) continue;
      seen.add(row.symbol);
      items.push({
        symbol: row.symbol,
        name: row.name,
        price: row.price,
        change_24h: row.change_24h,
        volume_24h: row.volume_24h,
        market_cap: row.market_cap,
        sector: "Rotation",
      });
    }
    return items;
  }, [marketRows, moverRows]);

  const openChart = (symbol: string) => {
    const normalized = normalizeChartSymbol(symbol);
    setSelectedSymbol(symbol);
    setTicker(normalized);
    navigate("/equity/chart-workstation");
  };

  const focusAsset = (symbol: string) => {
    setSelectedSymbol(symbol);
    if (!marketRows.some(row => row.symbol === symbol)) { setQuery(symbol); setSector("all"); }
    setTab("markets");
  };

  const activeMeta = TAB_META[tab];
  const focusShare = selectedAsset && totalMarketCap > 0 ? (selectedAsset.market_cap / totalMarketCap) * 100 : 0;
  const focusVolumeShare = selectedAsset && totalVolume > 0 ? (selectedAsset.volume_24h / totalVolume) * 100 : 0;

  function renderModule() {
    if (tab === "markets") {
      return (
        <TerminalPanel
          title={activeMeta.title}
          subtitle={activeMeta.subtitle}
          bodyClassName="space-y-3"
          actions={<TerminalBadge variant="info">{marketsQuery.data ? `${marketRows.length} symbols · first 28 shown` : "Board unavailable"}</TerminalBadge>}
        >
          <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">
            <label className="min-w-0 space-y-1 text-xs text-terminal-muted"><span className="block">Search assets</span><TerminalInput
              aria-label="Search crypto markets"
              placeholder="Search symbol or asset"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            /></label>
            <label className="min-w-0 space-y-1 text-xs text-terminal-muted"><span className="block">Sector</span><TerminalInput as="select" aria-label="Filter crypto sector" value={sector} onChange={(event) => setSector(event.target.value)}>
              {sectorOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All sectors" : option}
                </option>
              ))}
            </TerminalInput></label>
            <label className="min-w-0 space-y-1 text-xs text-terminal-muted"><span className="block">Sort by</span><TerminalInput
              as="select"
              aria-label="Sort crypto markets"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as NonNullable<CryptoMarketsQuery["sortBy"]>)}
            >
              <option value="market_cap">Market cap</option>
              <option value="volume_24h">Volume</option>
              <option value="change_24h">24h change</option>
              <option value="price">Price</option>
              <option value="symbol">Symbol</option>
            </TerminalInput></label>
            <label className="min-w-0 space-y-1 text-xs text-terminal-muted"><span className="block">Direction</span><TerminalInput
              as="select"
              aria-label="Sort direction"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as NonNullable<CryptoMarketsQuery["sortOrder"]>)}
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </TerminalInput></label>
          </div>

          <div role="region" aria-label="Crypto market board table" tabIndex={0} className="min-w-0 max-w-full overflow-x-auto">
            <table className="w-full min-w-[1120px] text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap [&_td]:px-2 [&_th]:px-2">
              <thead className="text-terminal-muted">
                <tr>
                  <th className="pb-2 text-left">Asset</th>
                  <th className="pb-2 text-right">Last (USD)</th>
                  <th className="pb-2 text-right">24h</th>
                  <th className="pb-2 text-right">Volume</th>
                  <th className="pb-2 text-right">Mkt Cap</th>
                  <th className="pb-2 text-left">Sector</th>
                  <th className="pb-2 text-right">Route</th>
                </tr>
              </thead>
              <tbody>
                {marketRows.slice(0, 28).map((row) => {
                  const isSelected = selectedAsset?.symbol === row.symbol;
                  return (
                    <tr
                      key={row.symbol}
                      className={`border-t border-terminal-border/50 ${isSelected ? "bg-terminal-accent/6" : ""}`}
                      onClick={() => setSelectedSymbol(row.symbol)}
                    >
                      <td className="min-w-[230px] max-w-xs py-2">
                        <button
                          type="button"
                          aria-pressed={isSelected} className="text-left text-sm text-terminal-accent hover:underline"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedSymbol(row.symbol);
                          }}
                        >
                          {row.symbol}
                        </button>
                        <div className="max-w-[260px] whitespace-normal text-sm text-terminal-muted">{row.name}</div>
                      </td>
                      <td className="py-2 text-right text-terminal-text">{formatPrice(row.price)}</td>
                      <td className={`py-2 text-right ${pctClass(row.change_24h)}`}>{signedPct(row.change_24h)}</td>
                      <td className="py-2 text-right">{formatCurrencyCompact(row.volume_24h)}</td>
                      <td className="py-2 text-right">{formatCurrencyCompact(row.market_cap)}</td>
                      <td className="max-w-[220px] whitespace-normal py-2">
                        <span className="inline-block max-w-full whitespace-normal rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted">
                          {row.sector || "General"}
                        </span>
                      </td>
                      <td className="min-w-[90px] py-2 text-right">
                        <TerminalButton
                          size="sm"
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation();
                            openChart(row.symbol);
                          }}
                        >
                          Chart
                        </TerminalButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TerminalPanel>
      );
    }

    if (tab === "movers") {
      return (
        <TerminalPanel
          title={activeMeta.title}
          subtitle={activeMeta.subtitle}
          bodyClassName="space-y-3"
          actions={(
            <label className="block min-w-0 space-y-1 text-xs text-terminal-muted"><span className="block">Mover metric</span><TerminalInput aria-label="Mover metric" as="select" value={moversMetric} onChange={(event) => setMoversMetric(event.target.value)} className="max-w-full">
              <option value="gainers">Gainers</option>
              <option value="losers">Losers</option>
              <option value="volume">Volume</option>
              <option value="market_cap">Market Cap</option>
            </TerminalInput></label>
          )}
        >
          <div className="grid min-w-0 gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}>
            {moverRows.map((row: CryptoMoverRow) => (
              <button
                key={`${moversMetric}-${row.symbol}`}
                type="button"
                className="min-w-0 rounded border border-terminal-border bg-terminal-bg px-3 py-3 text-left text-xs hover:border-terminal-accent"
                onClick={() => focusAsset(row.symbol)}
              >
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-terminal-accent">{row.symbol}</div>
                    <div className="text-terminal-text">{row.name}</div>
                  </div>
                  <TerminalBadge variant={row.change_24h >= 0 ? "success" : "danger"}>{signedPct(row.change_24h)}</TerminalBadge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-terminal-muted">Price</div>
                    <div className="text-terminal-text">{formatPrice(row.price)}</div>
                  </div>
                  <div>
                    <div className="text-terminal-muted">Volume</div>
                    <div className="text-terminal-text">{formatCurrencyCompact(row.volume_24h)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </TerminalPanel>
      );
    }

    if (tab === "index") {
      return (
        <TerminalPanel title={activeMeta.title} subtitle={activeMeta.subtitle} bodyClassName="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard
              label="Index Value"
              value={indexQuery.data ? fixed(indexQuery.data.index_value) : "--"}
              detail={indexQuery.data?.index_name || "Crypto market-cap index"}
              tone="text-terminal-accent"
            />
            <MetricCard
              label="24h Change"
              value={indexQuery.data ? signedPct(indexQuery.data.change_24h) : "--"}
              detail={indexQuery.data?.component_count == null ? "Component count unavailable" : `${indexQuery.data.component_count} components`}
              tone={indexQuery.data ? pctClass(indexQuery.data.change_24h) : "text-terminal-text"}
            />
            <MetricCard
              label="Index Market Cap"
              value={indexQuery.data ? formatCurrencyCompact(indexQuery.data.total_market_cap) : "--"}
              detail={indexQuery.data?.top_n == null ? "Basket size unavailable" : `Top ${indexQuery.data.top_n} weighted basket`}
            />
          </div>
          <p className="text-xs text-terminal-muted">Filtered market-board preview below; these rows do not establish membership in the index.</p>
          <div className="grid min-w-0 gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))" }}>
            {marketRows.slice(0, 10).map((row) => (
              <button
                key={row.symbol}
                type="button"
                className="min-w-0 rounded border border-terminal-border bg-terminal-bg p-3 text-left text-xs hover:border-terminal-accent"
                onClick={() => focusAsset(row.symbol)}
              >
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="text-terminal-accent">{row.symbol}</span>
                  <span className={pctClass(row.change_24h)}>{signedPct(row.change_24h)}</span>
                </div>
                <div className="mt-2 text-terminal-muted">{row.name}</div>
                <div className="mt-2 text-terminal-text">{formatCurrencyCompact(row.market_cap)}</div>
              </button>
            ))}
          </div>
        </TerminalPanel>
      );
    }

    if (tab === "sectors") {
      return (
        <TerminalPanel title={activeMeta.title} subtitle={activeMeta.subtitle}>
          <div className="grid min-w-0 gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}>
            {(sectorsQuery.data || []).map((row) => (
              <div key={row.sector} className="min-w-0 rounded border border-terminal-border bg-terminal-bg p-3 text-xs">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="text-terminal-accent">{row.sector}</span>
                  <span className={pctClass(row.change_24h)}>{signedPct(row.change_24h)}</span>
                </div>
                <div className="mt-2 text-terminal-text">{formatCurrencyCompact(row.market_cap)}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(row.components || []).slice(0, 4).map((component) => (
                    <button
                      key={`${row.sector}-${component.symbol}`}
                      type="button"
                      className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted hover:border-terminal-accent hover:text-terminal-text"
                      onClick={() => focusAsset(component.symbol)}
                    >
                      {component.symbol}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </TerminalPanel>
      );
    }

    if (tab === "heatmap") {
      return (
        <TerminalPanel title={activeMeta.title} subtitle={activeMeta.subtitle}>

          <CryptoHeatmapPanel items={heatmapQuery.data?.items || []} onSelect={openChart} />
        </TerminalPanel>
      );
    }

    if (tab === "derivatives") {
      return (
        <TerminalPanel title={activeMeta.title} subtitle={activeMeta.subtitle}>

          <CryptoDerivativesPanel
            rows={derivativesQuery.data?.items || []}
            totals={derivativesQuery.data?.totals}
            onSelect={openChart}
          />
        </TerminalPanel>
      );
    }

    if (tab === "defi") {
      return (
        <TerminalPanel title={activeMeta.title} subtitle={activeMeta.subtitle}>
          <CryptoDefiPanel
            headline={defiQuery.data?.headline}
            protocols={defiQuery.data?.protocols || []}
            onSelect={openChart}
          />
        </TerminalPanel>
      );
    }

    return (
      <TerminalPanel
        title={activeMeta.title}
        subtitle={activeMeta.subtitle}
        actions={(
          <label className="block min-w-0 space-y-1 text-xs text-terminal-muted"><span className="block">Return-history window</span><TerminalInput aria-label="Correlation window" as="select" value={corrWindow} onChange={(event) => setCorrWindow(Number(event.target.value))} className="max-w-full">
            <option value={14}>14d</option>
            <option value={30}>30d</option>
            <option value={60}>60d</option>
            <option value={90}>90d</option>
          </TerminalInput></label>
        )}
      >
        <p className="mb-3 text-xs text-terminal-muted">Returned window: {correlationQuery.data?.window ?? "Unavailable"} days. Missing cells are unavailable, not zero correlation.</p>
        <CryptoCorrelationMatrixPanel data={{ symbols: correlationQuery.data?.symbols || [], matrix: correlationQuery.data?.matrix || [] }} />
      </TerminalPanel>
    );
  }

  const activeQuery = { markets: marketsQuery, movers: moversQuery, index: indexQuery, sectors: sectorsQuery, heatmap: heatmapQuery, derivatives: derivativesQuery, defi: defiQuery, correlation: correlationQuery }[tab];
  const activeMetadata = activeQuery.data as { ts?: string; degraded?: DegradedInfo | null } | undefined;
  const empty = tab === "markets" ? !marketRows.length : tab === "movers" ? !moverRows.length : tab === "sectors" ? !sectorsQuery.data?.length : tab === "heatmap" ? !heatmapQuery.data?.items?.length : tab === "derivatives" ? !derivativesQuery.data?.items?.length : tab === "defi" ? !defiQuery.data?.protocols?.length : tab === "correlation" ? !correlationQuery.data?.symbols?.length : false;
  return <main aria-label="Crypto workspace" className="min-w-0 space-y-3 p-3 [overflow-wrap:anywhere] [&_input]:min-w-0 [&_input]:!text-sm [&_select]:min-w-0 [&_select]:!text-sm">
    <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-lg font-semibold text-terminal-accent">Crypto Command Center</h1></div>
      <div className="flex min-w-0 max-w-full flex-wrap items-end gap-2">
        <label className="block min-w-0 max-w-full space-y-1 text-xs text-terminal-muted"><span className="block">Active module</span><TerminalInput aria-label="Crypto module" as="select" value={tab} onChange={event => setTab(event.target.value as CryptoTab)}>{(Object.keys(TAB_META) as CryptoTab[]).map(id => <option key={id} value={id}>{TAB_META[id].title}</option>)}</TerminalInput></label>
        <TerminalButton disabled={activeQuery.isFetching} onClick={() => void activeQuery.refetch()}>Refresh module</TerminalButton>
      </div>
    </header>
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm"><p className="min-w-0">Focus: {selectedAsset ? selectedAsset.symbol : "Unavailable in the current market-board scope"}</p><a className="text-terminal-accent underline" href="#crypto-module" onClick={() => moduleRef.current?.focus()}>View active module</a>{selectedAsset ? <a className="text-terminal-accent underline" href="#crypto-focus" onClick={() => focusRef.current?.focus()}>View focus asset</a> : null}</div>
    <div className="grid min-w-0 grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
      <section id="crypto-module" ref={moduleRef} tabIndex={-1} aria-label="Active crypto module" className="min-w-0 space-y-3">
        <details className="min-w-0 rounded border border-terminal-border p-2"><summary className="cursor-pointer text-xs text-terminal-muted">Data scope · USD quote convention</summary>        <p className="text-xs text-terminal-muted">{activeMeta.title} · Response timestamp: {activeMetadata?.ts || "Unavailable for this response"}. {tab === "markets" ? `Search: ${query || "all"} · Sector: ${sector} · Requested order: ${sortBy}, ${sortOrder}.` : null}</p></details>
        {activeQuery.isFetching ? <p role="status" className="text-sm text-terminal-muted">Loading {activeMeta.title.toLowerCase()}…</p> : null}
        {activeQuery.isError ? <p role="alert" className="text-sm text-terminal-neg">Could not refresh {activeMeta.title.toLowerCase()}. Any displayed values are unrefreshed; use Refresh module to retry manually.</p> : null}
        <DegradedBanner info={activeMetadata?.degraded} className="!text-xs"/>
        {!activeQuery.isFetching && !activeQuery.isError && activeQuery.data !== undefined && empty ? <p className="text-sm text-terminal-muted">No {tab === "correlation" ? "correlation observations" : tab === "defi" ? "protocols" : "rows"} returned for this scope.</p> : null}
        {activeQuery.data !== undefined || ["markets", "movers", "correlation"].includes(tab) ? renderModule() : !activeQuery.isFetching ? <p className="text-sm text-terminal-muted">Module values are unavailable for this scope.</p> : null}
      </section>
      <aside className="min-w-0 space-y-3" aria-label="Crypto asset context">
        <section id="crypto-focus" ref={focusRef} tabIndex={-1} aria-label="Focus Asset" className="min-w-0 space-y-3 rounded border border-terminal-border bg-terminal-panel p-3">
          <h2 className="text-sm font-semibold text-terminal-accent">Focus Asset</h2>
          {marketsQuery.isFetching ? <p role="status" className="text-sm text-terminal-muted">Loading focus from the market board…</p> : null}
          {marketsQuery.isError ? <p role="alert" className="text-sm text-terminal-neg">Market-board focus could not be refreshed. Any displayed asset is unrefreshed.</p> : null}
          {selectedAsset ? <><div className="min-w-0 space-y-1"><h3 className="text-sm font-semibold">{selectedAsset.symbol}</h3><p className="text-sm">{selectedAsset.name}</p><p className="text-xs text-terminal-muted">{selectedAsset.sector}</p></div><p className="font-mono text-lg">{formatPrice(selectedAsset.price)} USD <span className={`text-sm ${pctClass(selectedAsset.change_24h)}`}>{signedPct(selectedAsset.change_24h)}</span></p>
            <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm">{[["24h volume (USD)", formatCurrencyCompact(selectedAsset.volume_24h)], ["Market cap (USD)", formatCurrencyCompact(selectedAsset.market_cap)], ["Share of filtered board cap", totalMarketCap > 0 ? `${fixed(focusShare)}%` : "Unavailable"], ["Share of filtered board volume", totalVolume > 0 ? `${fixed(focusVolumeShare)}%` : "Unavailable"]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-terminal-muted">{label}</dt><dd className="mt-1">{value}</dd></div>)}</dl>
            <div className="flex min-w-0 flex-wrap gap-2"><TerminalButton variant="accent" onClick={() => openChart(selectedAsset.symbol)}>Open Chart</TerminalButton><TerminalButton onClick={() => navigate(`/equity/market-context?symbol=${encodeURIComponent(selectedAsset.symbol)}`)}>Cross-market context</TerminalButton></div>
          </> : <p className="text-sm text-terminal-muted">No focus asset available for the current search and sector filter.</p>}
        </section>
        <details className="min-w-0 space-y-3 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Market snapshot</summary>
          {dominanceQuery.isError || indexQuery.isError ? <p role="alert" className="text-sm text-terminal-neg">Some snapshot data could not be refreshed. Previous values are unrefreshed.</p> : null}
          <div className="grid min-w-0 grid-cols-1 gap-2">
            <MetricCard label="Dominance" value={dominanceQuery.data ? `${fixed(dominanceQuery.data.btc_pct,1)} / ${fixed(dominanceQuery.data.eth_pct,1)}` : "Unavailable"} detail={dominanceQuery.data ? `BTC / ETH; ${fixed(dominanceQuery.data.others_pct,1)}% others` : "BTC / ETH / others unavailable"}/>
            <MetricCard label="Global market cap (USD)" value={dominanceQuery.data ? formatCurrencyCompact(dominanceQuery.data.total_market_cap) : "Unavailable"} detail="Dominance response; separate from filtered board totals"/>
            <MetricCard label="24h board breadth" value={marketRows.length ? `${breadthPct}%` : "Unavailable"} detail={marketRows.length ? `${advancers} non-negative / ${marketRows.length - advancers} negative, filtered board` : "No board rows to measure"}/>
            <MetricCard label="Index" value={indexQuery.data ? fixed(indexQuery.data.index_value) : "Unavailable"} detail={indexQuery.data ? signedPct(indexQuery.data.change_24h) : "Top-basket proxy unavailable"}/>
          </div>
        </details>
        <details className="min-w-0 space-y-3 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Radar board and mover queue</summary>
          {moversQuery.isError ? <p role="alert" className="text-sm text-terminal-neg">Mover data could not be refreshed. Any displayed movers are unrefreshed.</p> : null}
          <p className="text-xs text-terminal-muted">First board rows and movers, not a separate watchlist. Selecting an absent asset searches the board for that symbol.</p>
          <div className="space-y-2">{radarBoard.slice(0,8).map(row => <button key={row.symbol} onClick={() => focusAsset(row.symbol)} className="block w-full min-w-0 rounded border border-terminal-border p-2 text-left text-sm"><span className="block text-terminal-accent">{row.symbol} · {signedPct(row.change_24h)}</span><span className="block">{row.name}</span></button>)}</div>
          <label className="block min-w-0 space-y-1 text-xs text-terminal-muted"><span className="block">Mover queue metric</span><TerminalInput aria-label="Mover queue metric" as="select" value={moversMetric} onChange={event => setMoversMetric(event.target.value)}>{["gainers", "losers", "volume", "market_cap"].map(value => <option key={value} value={value}>{value}</option>)}</TerminalInput></label>
          <div className="space-y-2">{moverRows.slice(0,5).map(row => <button key={row.symbol} onClick={() => focusAsset(row.symbol)} className="block w-full min-w-0 rounded border border-terminal-border p-2 text-left text-sm">{row.symbol} · {row.name} · {signedPct(row.change_24h)}</button>)}</div>
        </details>
        <details className="min-w-0 space-y-3 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Sector context</summary><p className="text-xs text-terminal-muted">Current 24h baskets; not historical rotation. Selection applies a sector to the market board.</p>{sectorsQuery.isError ? <p role="alert" className="text-sm text-terminal-neg">Sector data could not be refreshed; previous values are unrefreshed.</p> : null}{(sectorsQuery.data || []).slice(0,4).map(row => <button key={row.sector} onClick={() => { setSector(row.sector); setQuery(""); setSelectedSymbol(""); setTab("markets"); }} className="block w-full min-w-0 rounded border border-terminal-border p-2 text-left text-sm"><span className="block">{row.sector}</span><span className="block text-xs text-terminal-muted">{signedPct(row.change_24h)} · {(row.components || []).slice(0,3).map(item => item.symbol).join(", ") || "No components"}</span></button>)}</details>
      </aside>
    </div>
  </main>;
}
