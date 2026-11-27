import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  fetchBacktestV1Presets,
  fetchLatestNews,
  fetchPortfolio,
  fetchPortfolioHistory,
  fetchQuotesBatch,
  fetchWatchlist,
  type NewsLatestApiItem,
} from "../api/client";
import { ExposureHeatmap } from "../components/dashboard/ExposureHeatmap";
import { GuidedEmptyState } from "../components/dashboard/GuidedEmptyState";
import { IntelligenceTimeline } from "../components/dashboard/IntelligenceTimeline";
import { LiveClockStrip } from "../components/home/LiveClockStrip";
import { MarketHeatStrip, type MarketHeatStripItem } from "../components/home/MarketHeatStrip";
import { MetricCard } from "../components/home/MetricCard";
import { buildHomeHistory, emptyHomeHistory, type HomePortfolioHistory } from "../components/home/homePortfolioHistory";
import { PortfolioMiniChart } from "../components/home/PortfolioMiniChart";
import { ProfileCompletionRing } from "../components/home/ProfileCompletionRing";
import { QuickNavGrid, type QuickNavSection } from "../components/home/QuickNavGrid";
import { SystemHealthBar, type SystemHealthItem } from "../components/home/SystemHealthBar";
import { AiInsightCard } from "../components/terminal/AiInsightCard";
import { TerminalShell } from "../components/layout/TerminalShell";
import { PRIMARY_NAV_ITEMS } from "../components/layout/navigation";
import { useAuth } from "../contexts/AuthContext";
import { useDisplayCurrency } from "../hooks/useDisplayCurrency";
import { fetchChainSummary } from "../fno/api/fnoApi";
import { fetchCollectionBriefing } from "../api/client";
import { useSettingsStore } from "../store/settingsStore";
import type { PortfolioItem } from "../types";
import { asCurrencyCode, type CurrencyCode } from "../lib/currency";
import { getWorkspacePresetConfig, readWorkspacePreset } from "../workspace/presets";

type MarketRow = {
  symbol: string;
  label?: string;
  ltp: number;
  chg: number;
  chgPct: number;
  flash: "up" | "down" | null;
};

type DashboardSnapshot = {
  equityValue: number | null;
  equityCost: number | null;
  equityPnl: number | null;
  accountingStatus: "complete" | "degraded" | "partial" | null;
  holdingsCount: number;
  watchlistCount: number;
  watchlistDerivativesCount: number;
  backtestPresetCount: number;
  fnoSpot: number | null;
  fnoPcr: number | null;
  fnoSignal: string;
  updatedAt: number | null;
};

type NavCard = {
  label: string;
  to: string;
  badge: string;
  configuration?: string;
};

const CONFIGURATION_BY_PATH = new Map(
  PRIMARY_NAV_ITEMS.flatMap((item) => (item.configuration ? [[item.path, item.configuration.detail] as const] : [])),
);

const TRANSITION_FLAG_KEY = "ot-terminal-transition";
const NEWS_LIMIT = 15;

const NAV_CARD_SECTIONS: Array<{ title: string; cards: NavCard[] }> = [
  {
    title: "MARKETS",
    cards: [
      { label: "Equity", to: "/equity/stocks", badge: "M1" },
      {
        label: "F&O",
        to: "/fno",
        badge: "FO",
        configuration: "India live and historical derivatives data require server-side Kite credentials.",
      },
      { label: "Crypto", to: "/equity/crypto", badge: "CR" },
      { label: "Economics", to: "/equity/economics", badge: "EC", configuration: CONFIGURATION_BY_PATH.get("/equity/economics") },
      { label: "Yield Curve", to: "/equity/yield-curve", badge: "YC", configuration: CONFIGURATION_BY_PATH.get("/equity/yield-curve") },
      { label: "Rotation", to: "/equity/sector-rotation", badge: "ROT" },
      { label: "Heatmap", to: "/equity/heatmap", badge: "HM" },
      { label: "Depth of Market", to: "/equity/dom", badge: "DOM" },
    ],
  },
  {
    title: "DERIVATIVES",
    cards: [
      { label: "Option Chain", to: "/fno", badge: "OC" },
      { label: "Greeks", to: "/fno/greeks", badge: "GR" },
      { label: "Futures", to: "/fno/futures", badge: "FUT" },
      { label: "OI Analysis", to: "/fno/oi", badge: "OI" },
      { label: "Strategy", to: "/fno/strategy", badge: "STR" },
      { label: "PCR", to: "/fno/pcr", badge: "PCR" },
      { label: "Options Flow", to: "/fno/flow", badge: "FLW" },
      { label: "F&O Heatmap", to: "/fno/heatmap", badge: "FHM" },
      { label: "Expiry", to: "/fno/expiry", badge: "EXP" },
    ],
  },
  {
    title: "RESEARCH",
    cards: [
      { label: "Security Hub", to: "/equity/security", badge: "SH" },
      { label: "Screener", to: "/equity/screener", badge: "F2" },
      { label: "Saved Views", to: "/equity/saved-views", badge: "SV" },
      { label: "Factors", to: "/equity/factors", badge: "FAC" },
      { label: "Intelligence", to: "/equity/intelligence-timeline", badge: "INT" },
      { label: "Compare", to: "/equity/compare", badge: "CMP" },
      { label: "Multi-Timeframe Analysis", to: "/equity/mta", badge: "MT" },
    ],
  },
  {
    title: "LABS",
    cards: [
      { label: "Backtesting", to: "/backtesting", badge: "F9" },
      { label: "Stat Lab", to: "/equity/stat-lab", badge: "SL" },
      { label: "Pair Trading", to: "/equity/pair-trading", badge: "PT" },
    ],
  },
  {
    title: "PORTFOLIO",
    cards: [
      { label: "Holdings", to: "/equity/portfolio", badge: "F3" },
      { label: "Risk Desk", to: "/equity/risk", badge: "RSK" },
      { label: "Correlation", to: "/equity/correlation", badge: "COR" },
      { label: "Paper", to: "/equity/paper", badge: "PP" },
      { label: "Dividends", to: "/equity/dividends", badge: "DIV" },
      { label: "Mutual Funds", to: "/equity/mutual-funds", badge: "MF" },
      { label: "ETF Analytics", to: "/equity/etf-analytics", badge: "ETF" },
    ],
  },
  {
    title: "INTEL",
    cards: [
      { label: "News", to: "/equity/news", badge: "NW" },
      { label: "Alerts", to: "/equity/alerts", badge: "AL" },
      { label: "Watchlist", to: "/equity/watchlist", badge: "F4" },
      { label: "Data Quality", to: "/equity/data-quality", badge: "DQ" },
    ],
  },
  {
    title: "WORKSPACE",
    cards: [
      { label: "Launchpad", to: "/equity/launchpad", badge: "LP" },
      { label: "Workstation", to: "/equity/chart-workstation", badge: "WS" },
      { label: "Settings", to: "/equity/settings", badge: "F6" },
      { label: "Account", to: "/account", badge: "ACC" },
    ],
  },
];

const INITIAL_MARKET_ROWS: MarketRow[] = [
  { symbol: "^GSPC", label: "S&P 500", ltp: 0, chg: 0, chgPct: 0, flash: null },
  { symbol: "^IXIC", label: "NASDAQ", ltp: 0, chg: 0, chgPct: 0, flash: null },
  { symbol: "^DJI", label: "DOW", ltp: 0, chg: 0, chgPct: 0, flash: null },
  { symbol: "GC=F", label: "GOLD", ltp: 0, chg: 0, chgPct: 0, flash: null },
  { symbol: "SI=F", label: "SILVER", ltp: 0, chg: 0, chgPct: 0, flash: null },
  { symbol: "CL=F", label: "CRUDE OIL", ltp: 0, chg: 0, chgPct: 0, flash: null },
];

const MARKET_PULSE_SYMBOLS = INITIAL_MARKET_ROWS.map((row) => row.symbol);

const EMPTY_SNAPSHOT: DashboardSnapshot = {
  equityValue: null,
  equityCost: null,
  equityPnl: null,
  accountingStatus: null,
  holdingsCount: 0,
  watchlistCount: 0,
  watchlistDerivativesCount: 0,
  backtestPresetCount: 0,
  fnoSpot: null,
  fnoPcr: null,
  fnoSignal: "NA",
  updatedAt: null,
};

function formatPrice(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function getMetricTone(value: number | null): "accent" | "up" | "down" | "neutral" {
  if (value == null || !Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "up" : "down";
}

function getSignalTone(signal: string): "accent" | "up" | "down" | "neutral" {
  const normalized = signal.trim().toUpperCase();
  if (normalized.includes("BULL")) return "up";
  if (normalized.includes("BEAR")) return "down";
  if (normalized === "NA") return "neutral";
  return "accent";
}

function getSystemTone(signal: string): SystemHealthItem["tone"] {
  const normalized = signal.trim().toUpperCase();
  if (normalized.includes("BULL")) return "ok";
  if (normalized.includes("BEAR")) return "warning";
  if (normalized === "NA") return "neutral";
  return "info";
}

function getSentimentClass(label?: string): string {
  if (label === "Bullish") return "text-terminal-pos";
  if (label === "Bearish") return "text-terminal-neg";
  return "text-terminal-muted";
}

export function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { formatMoney, formatSignedMoney } = useDisplayCurrency();
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const realtimeMode = useSettingsStore((s) => s.realtimeMode);
  const newsAutoRefresh = useSettingsStore((s) => s.newsAutoRefresh);
  const newsRefreshSec = useSettingsStore((s) => s.newsRefreshSec);

  const [marketRows, setMarketRows] = useState<MarketRow[]>(INITIAL_MARKET_ROWS);
  const [newsLog, setNewsLog] = useState<NewsLatestApiItem[]>([]);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(EMPTY_SNAPSHOT);
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [portfolioCurrency, setPortfolioCurrency] = useState<CurrencyCode | null>(null);
  const [activePreset, setActivePreset] = useState(readWorkspacePreset);
  const [performance, setPerformance] = useState<HomePortfolioHistory>(() => ({ ...emptyHomeHistory("Loading historical comparison…"), status: "loading" }));
  const [primaryName, setPrimaryName] = useState<string | null>(null);
  const snapshotRequest = useRef(0);
  const snapshotInFlight = useRef(false);
  const [selectedHeatId, setSelectedHeatId] = useState<string | null>(INITIAL_MARKET_ROWS[0]?.symbol ?? null);
  const [initializing, setInitializing] = useState(() => sessionStorage.getItem(TRANSITION_FLAG_KEY) === "1");

  const loadSnapshot = useCallback(async () => {
    if (snapshotInFlight.current) return;
    snapshotInFlight.current = true;
    const request = ++snapshotRequest.current;
    setPerformance({ ...emptyHomeHistory("Loading historical comparison…"), status: "loading" });
    const portfolioTask = fetchPortfolio();
    const benchmarkTask = portfolioTask.then((portfolio) => {
      if (request !== snapshotRequest.current) return null;
      if (!portfolio.portfolio_id) throw new Error("Primary portfolio identity unavailable");
      return fetchPortfolioHistory(portfolio.portfolio_id);
    });
    const [portfolioRes, watchlistRes, backtestRes, chainRes, benchmarkRes] = await Promise.allSettled([
      portfolioTask,
      fetchWatchlist(),
      fetchBacktestV1Presets(),
      fetchChainSummary("SPY"),
      benchmarkTask,
    ]);

    if (request !== snapshotRequest.current) return;
    snapshotInFlight.current = false;
    let next = { ...EMPTY_SNAPSHOT };
    setPrimaryName(portfolioRes.status === "fulfilled" ? portfolioRes.value.portfolio_name : null);

    if (portfolioRes.status === "fulfilled") {
      const data = portfolioRes.value;
      setPortfolioItems(data.items || []);
      const resolvedPortfolioCurrency = asCurrencyCode(
        data.portfolio_currency || data.accounting?.base_currency || data.items[0]?.currency,
      );
      setPortfolioCurrency(resolvedPortfolioCurrency);
      next.equityValue = data.summary.net_liquidation_value;
      next.equityCost = data.summary.total_cost;
      next.equityPnl = data.summary.overall_pnl;
      next.accountingStatus = data.accounting?.status ?? null;
      next.holdingsCount = data.items.length;
    }

    if (watchlistRes.status === "fulfilled") {
      const items = watchlistRes.value;
      next.watchlistCount = items.length;
      next.watchlistDerivativesCount = items.filter((row) => row.has_futures || row.has_options).length;
    }

    if (backtestRes.status === "fulfilled") {
      next.backtestPresetCount = backtestRes.value.length;
    }

    if (chainRes.status === "fulfilled") {
      next.fnoSpot = Number.isFinite(chainRes.value.spot_price) ? chainRes.value.spot_price : null;
      next.fnoPcr = Number.isFinite(chainRes.value.pcr?.pcr_oi) ? chainRes.value.pcr.pcr_oi : null;
      next.fnoSignal = String(chainRes.value.pcr?.signal || "NA").toUpperCase();
    }

    const checkedAt = Date.now();
    setPerformance(portfolioRes.status === "rejected"
      ? emptyHomeHistory("Primary portfolio could not be loaded.", checkedAt)
      : !portfolioRes.value.portfolio_id
        ? emptyHomeHistory("Primary portfolio identity is unavailable.", checkedAt)
        : benchmarkRes.status === "rejected"
          ? emptyHomeHistory("Historical comparison could not be loaded. No previous curve is shown.", checkedAt)
          : buildHomeHistory(benchmarkRes.value, checkedAt));
    next.updatedAt = Date.now();
    setSnapshot(next);
  }, [selectedMarket]);

  useEffect(() => {
    void loadSnapshot();
    const timer = window.setInterval(() => {
      void loadSnapshot();
    }, 30000);
    return () => {
      window.clearInterval(timer);
      snapshotRequest.current++; snapshotInFlight.current = false;
    };
  }, [loadSnapshot]);

  useEffect(() => {
    let active = true;

    const loadMarketPulse = async () => {
      try {
        const payload = await fetchQuotesBatch(MARKET_PULSE_SYMBOLS, selectedMarket);
        if (!active) return;
        const quotesBySymbol = new Map(
          (payload?.quotes || []).map((quote) => [String(quote.symbol || "").toUpperCase(), quote]),
        );
        setMarketRows((prev) =>
          prev.map((row) => {
            const quote = quotesBySymbol.get(row.symbol.toUpperCase());
            if (!quote || !Number.isFinite(Number(quote.last))) {
              return row.flash ? { ...row, flash: null } : row;
            }
            const nextLtp = Number(quote.last);
            const nextChg = Number.isFinite(Number(quote.change)) ? Number(quote.change) : row.chg;
            const nextChgPct = Number.isFinite(Number(quote.changePct)) ? Number(quote.changePct) : row.chgPct;
            const flash: MarketRow["flash"] = nextLtp > row.ltp ? "up" : nextLtp < row.ltp ? "down" : null;
            return {
              ...row,
              ltp: nextLtp,
              chg: nextChg,
              chgPct: nextChgPct,
              flash,
            };
          }),
        );
      } catch {
        if (!active) return;
      }
    };

    void loadMarketPulse();
    const timer = window.setInterval(() => {
      void loadMarketPulse();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedMarket]);

  useEffect(() => {
    let active = true;

    const loadNews = async () => {
      try {
        const items = await fetchLatestNews(NEWS_LIMIT);
        if (active && items.length) {
          setNewsLog(items);
        }
      } catch {
        if (!active) return;
      }
    };

    void loadNews();
    if (newsAutoRefresh) {
      const timer = window.setInterval(() => {
        void loadNews();
      }, newsRefreshSec * 1000);
      return () => {
        active = false;
        window.clearInterval(timer);
      };
    }

    return () => {
      active = false;
    };
  }, [newsAutoRefresh, newsRefreshSec]);

  useEffect(() => {
    if (!initializing) return;
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem(TRANSITION_FLAG_KEY);
      setInitializing(false);
    }, 1300);
    return () => window.clearTimeout(timer);
  }, [initializing]);

  useEffect(() => {
    if (marketRows.some((row) => row.symbol === selectedHeatId)) return;
    setSelectedHeatId(marketRows[0]?.symbol ?? null);
  }, [marketRows, selectedHeatId]);

  const equityPnlPct = useMemo(() => {
    if (snapshot.equityPnl == null || snapshot.equityCost == null || snapshot.equityCost <= 0) return null;
    return (snapshot.equityPnl / snapshot.equityCost) * 100;
  }, [snapshot.equityCost, snapshot.equityPnl]);

  const heatItems = useMemo<MarketHeatStripItem[]>(
    () =>
      marketRows.map((row) => ({
        id: row.symbol,
        label: row.label || row.symbol,
        value: row.ltp > 0 ? row.ltp : null,
        changePct: row.ltp > 0 ? row.chgPct : null,
        changeLabel:
          row.ltp > 0
            ? `${row.chg >= 0 ? "+" : ""}${formatPrice(row.chg)} / ${formatPercent(row.chgPct)}`
            : "--",
        flash: row.flash,
      })),
    [marketRows],
  );

  const focusedMarket = useMemo(
    () => marketRows.find((row) => row.symbol === selectedHeatId) ?? marketRows[0] ?? null,
    [marketRows, selectedHeatId],
  );

  useEffect(() => {
    const onStorage = () => setActivePreset(readWorkspacePreset());
    window.addEventListener("storage", onStorage);
    window.addEventListener("ot:preset-change", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("ot:preset-change", onStorage);
    };
  }, []);

  const presetConfig = getWorkspacePresetConfig(activePreset);
  const showHomeSection = useCallback((section: string) => presetConfig.homeSections.includes(section), [presetConfig.homeSections]);

  const launchSections = useMemo<QuickNavSection[]>(
    () => {
      const preferred = new Set(presetConfig.quickLinks.map((link) => link.to));
      return NAV_CARD_SECTIONS.map((section) => ({
        id: slugify(section.title),
        title: section.title,
        // Show ALL nav cards — the workspace preset only reorders (preferred first),
        // it must never hide features from the launcher.
        items: section.cards
          .slice()
          .sort((a, b) => Number(preferred.has(b.to)) - Number(preferred.has(a.to)))
          .map((card) => ({
          id: `${slugify(section.title)}-${slugify(card.label)}`,
          label: card.label,
          shortcut: card.badge,
          description: card.configuration
            ? `${section.title} desk access. Configuration: ${card.configuration}`
            : `${section.title} desk access`,
          onSelect: () => navigate(card.to),
        })),
      })).filter((section) => section.items.length > 0);
    },
    [navigate, presetConfig.quickLinks],
  );

  const updatedLabel = snapshot.updatedAt
    ? new Date(snapshot.updatedAt).toLocaleTimeString(undefined, { hour12: false })
    : "--:--:--";

  const profileMissingFields = useMemo(() => {
    const missing: string[] = [];
    if (!user?.email) missing.push("Email");
    if (!user?.role) missing.push("Role");
    if (snapshot.updatedAt == null) missing.push("Snapshot");
    if (newsLog.length === 0) missing.push("News");
    return missing;
  }, [newsLog.length, snapshot.updatedAt, user?.email, user?.role]);

  const profileCompletion = Math.round(((4 - profileMissingFields.length) / 4) * 100);

  const systemHealthItems = useMemo<SystemHealthItem[]>(
    () => [
      {
        id: "auth",
        label: "AUTH",
        value: user ? `${user.role.toUpperCase()} READY` : "GUEST",
        tone: user ? "ok" : "warning",
      },
      {
        id: "relay",
        label: "RELAY",
        value: `${selectedMarket} ${realtimeMode.toUpperCase()}`,
        tone: realtimeMode === "ws" ? "ok" : "info",
      },
      {
        id: "snapshot",
        label: "SNAPSHOT",
        value: updatedLabel,
        tone: snapshot.updatedAt ? "stale" : "offline",
      },
      {
        id: "news",
        label: "NEWS",
        value: newsAutoRefresh ? `AUTO ${newsRefreshSec}s` : "MANUAL",
        tone: newsAutoRefresh ? "info" : "neutral",
      },
      {
        id: "fno",
        label: "F&O",
        value: `${snapshot.fnoSignal}${snapshot.fnoPcr != null ? ` | ${snapshot.fnoPcr.toFixed(2)}` : ""}`,
        tone: getSystemTone(snapshot.fnoSignal),
      },
    ],
    [newsAutoRefresh, newsRefreshSec, realtimeMode, selectedMarket, snapshot.fnoPcr, snapshot.fnoSignal, snapshot.updatedAt, updatedLabel, user],
  );

  const leadHeadline = newsLog[0] ?? null;

  return (
    <TerminalShell
      contentClassName="bg-terminal-bg"
      hideTickerLoader
      showMobileBottomNav
      showWorkspaceControls={false}
      statusBarTickerOverride="MISSION CONTROL"
    >
      <div className="relative min-h-full bg-terminal-bg">
        {initializing ? (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-terminal-bg/95" role="status" aria-live="polite">
            <p className="ot-type-panel-title uppercase tracking-normal text-terminal-accent">Initializing Mission Control</p>
            <div className="h-1.5 w-64 overflow-hidden rounded-full border border-terminal-border bg-terminal-panel/80">
              <span className="block h-full w-2/3 animate-pulse bg-terminal-accent/80" />
            </div>
          </div>
        ) : null}

        {!initializing ? (
          <main className="ot-home-dashboard flex min-h-full min-w-0 flex-col gap-3 p-3 md:p-4" aria-label="Mission Control Dashboard">
            <section className="rounded-sm border border-terminal-border bg-terminal-panel/80 p-3" aria-label="Home Header">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-2">
                  <h1 className="text-xl font-semibold text-terminal-text">{presetConfig.landing.headline}</h1>
                  <p className="text-xs text-terminal-muted">{selectedMarket} · {displayCurrency} · {presetConfig.label} preset</p>
                </div>

                <div className="flex flex-col gap-3 xl:items-end">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-sm border border-terminal-border px-3 py-1.5 text-xs uppercase tracking-normal text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                      onClick={() => navigate("/equity/portfolio")}
                    >
                      Portfolio HQ
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-terminal-accent px-3 py-1.5 text-xs uppercase tracking-normal text-terminal-accent hover:bg-terminal-accent/10"
                      onClick={() => navigate(presetConfig.landing.primaryRoute)}
                    >
                      {presetConfig.landing.primaryLabel}
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-terminal-border px-3 py-1.5 text-xs uppercase tracking-normal text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                      onClick={() => navigate("/equity/launchpad")}
                    >
                      Launchpad
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-terminal-border px-3 py-1.5 text-xs uppercase tracking-normal text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                      onClick={() => navigate("/equity/news")}
                    >
                      Intel Wire
                    </button>
                  </div>
                </div>
              </div>

              <details className="mt-3 text-xs text-terminal-muted">
                <summary className="w-fit cursor-pointer">Desk details and clocks</summary>
                  <p className="max-w-3xl text-sm text-terminal-muted">
                    {presetConfig.landing.description}
                  </p>
                <div className="mt-2 flex flex-wrap items-start gap-3">
                  <div className="flex flex-wrap gap-2 text-xs uppercase tracking-normal text-terminal-muted">
                    <span className="rounded-sm border border-terminal-border px-2 py-1">
                      Desk {(user?.email || "unknown").toUpperCase()}
                    </span>
                    <span className="rounded-sm border border-terminal-border px-2 py-1">
                      Market {selectedMarket}
                    </span>
                    <span className="rounded-sm border border-terminal-accent/60 px-2 py-1 text-terminal-accent">
                      Preset {presetConfig.label}
                    </span>
                    <span className="rounded-sm border border-terminal-border px-2 py-1">
                      Currency {displayCurrency}
                    </span>
                    <span className="rounded-sm border border-terminal-border px-2 py-1">
                      Refresh {newsAutoRefresh ? `${newsRefreshSec}s` : "Manual"}
                    </span>
                  </div>
                  <LiveClockStrip />
                </div>
              </details>

              <div className="mt-3">
                <MarketHeatStrip
                  ariaLabel="Market heat strip"
                  items={heatItems}
                  selectedItemId={selectedHeatId}
                  formatValue={(value) => (typeof value === "number" ? formatPrice(value) : "--")}
                  onSelect={(item) => setSelectedHeatId(item.id)}
                />
              </div>
            </section>


            <div className="ot-home-overview">
              <div className="grid min-w-0 content-start gap-3">
              {showHomeSection("portfolio") ? (
              <section className="min-w-0 rounded-sm border border-terminal-border bg-terminal-panel/80 p-3" aria-label="Portfolio HQ">
                <div className="flex flex-col gap-3 border-b border-terminal-border pb-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="ot-type-panel-title uppercase tracking-normal text-terminal-accent">Portfolio HQ</h2>
                    <p className="mt-1 text-sm text-terminal-muted">
                      Primary portfolio value and reconstructed history.
                    </p>
                  </div>
                  <ProfileCompletionRing
                    value={profileCompletion}
                    missingFields={profileMissingFields}
                    className="shrink-0"
                  />
                </div>

                <div className="mt-3">
                  <MetricCard
                    label="Net Liquidation"
                    value={formatMoney(snapshot.equityValue, portfolioCurrency ?? undefined)}
                    tone={getMetricTone(snapshot.equityPnl)}
                    sparklinePoints={performance.navPoints.map((point) => point.value)}
                    sparklineAriaLabel="Reconstructed daily portfolio value"
                    delta={
                      snapshot.equityPnl == null
                        ? undefined
                        : {
                            label: `${formatSignedMoney(snapshot.equityPnl, portfolioCurrency ?? undefined)} (${formatPercent(equityPnlPct)})`,
                            tone: getMetricTone(snapshot.equityPnl),
                          }
                    }
                    details={[
                      { label: "Holdings", value: String(snapshot.holdingsCount) },
                      { label: "Watchlist", value: String(snapshot.watchlistCount), tone: "accent" },
                      { label: "Backtests", value: String(snapshot.backtestPresetCount) },
                      {
                        label: "Accounting",
                        value: snapshot.accountingStatus?.toUpperCase() ?? "UNAVAILABLE",
                        tone: snapshot.accountingStatus === "complete" ? "up" : "accent",
                      },
                      { label: "Sync", value: updatedLabel, tone: "neutral" },
                    ]}
                    footer={
                      <div>
                      <p className="mb-2 text-xs text-terminal-muted">{performance.navPoints.length > 1
                        ? `Approximate ledger value · ${performance.start} to ${performance.end} · ${performance.baseCurrency}. Includes cash flows; this sparkline is value, not investment return.`
                        : "Reconstructed value history unavailable."}</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-sm border border-terminal-border px-2 py-1 text-xs uppercase tracking-normal text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                          onClick={() => navigate("/equity/portfolio")}
                        >
                          Open Portfolio
                        </button>
                        <button
                          type="button"
                          className="rounded-sm border border-terminal-border px-2 py-1 text-xs uppercase tracking-normal text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                          onClick={() => navigate("/backtesting")}
                        >
                          Run Backtests
                        </button>
                      </div>
                      </div>
                    }
                  />

                </div>

                <section aria-label="Primary portfolio historical comparison" className="mt-3 rounded-sm border border-terminal-border bg-terminal-bg/40 p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="ot-type-panel-title uppercase tracking-normal text-terminal-accent">30-day portfolio history</h3>
                      <p className="mt-1 text-xs text-terminal-muted">
                        Primary portfolio{primaryName ? ` · ${primaryName}` : ""}. Approximate daily reconstruction of recorded buys, sells, cash, fees and dividends. Includes closed positions while they were held.
                      </p>
                    </div>
                    <span className="rounded-sm border border-terminal-border px-2 py-1 text-xs uppercase tracking-normal text-terminal-muted">
                      {performance.status === "loading" ? "Loading history" : performance.status === "unavailable" ? "History unavailable" : "Approximate history"}
                    </span>
                  </div>
                  <PortfolioMiniChart
                    points={performance.points}
                    benchmarkPoints={performance.benchmarkPoints}
                    ariaLabel="Primary portfolio flow-adjusted comparison"
                    emptyLabel={performance.message}
                    seriesLabel="Portfolio (flow-adjusted)"
                    benchmarkLabel={performance.benchmark ? `Benchmark (${performance.benchmark})` : "Benchmark"}
                    valueFormatter={(value) => `${value.toFixed(2)} index`}
                  />
                  {performance.start && performance.end ? <>
                    <p className="mt-2 text-xs text-terminal-muted">
                      {performance.start} to {performance.end} · {performance.navPoints.length} daily valuations · {performance.baseCurrency}.
                      {performance.benchmarkAsOf ? ` Benchmark close used: ${performance.benchmarkAsOf}.` : ""}
                    </p>
                    <details className="mt-2 text-xs text-terminal-muted">
                      <summary className="w-fit cursor-pointer">Valuation method and coverage</summary>
                      <p className="mt-2">Return indices start at 100 on the first comparable funded date. Deposits/withdrawals are treated as end-of-day flows; intraday timing is unknown.
                        Daily UTC labels do not imply simultaneous quotes; non-trading dates can carry a prior close for up to 7 days. No corporate-action replay; provider adjustments or missing trades may distort reconstruction.</p>
                    </details>
                  </> : null}
                  {performance.checkedAt !== null ? <p className="mt-1 text-xs text-terminal-muted">History checked {new Date(performance.checkedAt).toLocaleTimeString()}; this is a retrieval check, not a live quote.</p> : null}
                  {performance.notes.length ? <ul className="mt-2 text-xs text-terminal-warn">{performance.notes.map((note, index) => <li key={index}>{note}</li>)}</ul> : null}
                  {performance.adjustmentDetails.length ? <details className="mt-2 text-xs text-terminal-muted">
                    <summary className="cursor-pointer">Legacy data adjusted for this estimate · Details</summary>
                    <ul className="mt-2 break-words">{performance.adjustmentDetails.map((detail, index) => <li key={index}>{detail}</li>)}</ul>
                  </details> : null}
                  {performance.valuations.length ? <details className="mt-3 text-xs text-terminal-muted">
                    <summary className="cursor-pointer text-terminal-accent">Inspect reconstructed daily values</summary>
                    <p className="my-2">Opening cash applies from the earliest ledger activity or portfolio creation. Cash uses transaction-date FX; securities use each valuation day’s FX. Legacy adjustments can be inspected separately; unrecorded add/remove dates are unknown. No missing trade or deposit is created. Values are recalculated from the current ledger and provider history, not preserved account snapshots.</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left" aria-label="Reconstructed daily portfolio values">
                        <thead><tr>{["UTC date", "Value", "Cash", "Holdings", "External flow", "Native close dates"].map((heading) => <th className="p-2" key={heading}>{heading}</th>)}</tr></thead>
                        <tbody>{performance.valuations.map((day) => <tr key={day.label} className="border-t border-terminal-border">
                          <th className="whitespace-nowrap p-2 font-normal">{day.label}</th>
                          {[day.value, day.cash, day.holdings, day.flow].map((value, i) => <td className="whitespace-nowrap p-2" key={i}>{formatMoney(value, asCurrencyCode(performance.baseCurrency) ?? undefined)}</td>)}
                          <td className="p-2">{Object.entries(day.priceDates).map(([symbol, date]) => `${symbol}: ${date}`).join("; ") || "Cash only"}</td>
                        </tr>)}</tbody>
                      </table>
                    </div>
                  </details> : null}
                </section>
                <section aria-label="Desk snapshot" className="mt-3">
                  <div className="ot-home-desk-metrics">
                    <MetricCard
                      label="Market Focus"
                      value={focusedMarket?.ltp && focusedMarket.ltp > 0 ? formatPrice(focusedMarket.ltp) : "--"}
                      tone={getMetricTone(focusedMarket?.chg ?? null)}
                      delta={
                        focusedMarket
                          ? {
                              label:
                                focusedMarket.ltp > 0
                                  ? `${focusedMarket.chg >= 0 ? "+" : ""}${formatPrice(focusedMarket.chg)} (${formatPercent(focusedMarket.chgPct)})`
                                  : "--",
                              tone: getMetricTone(focusedMarket.chg),
                            }
                          : undefined
                      }
                      details={[
                        { label: "Ticker", value: focusedMarket?.label || "--" },
                        { label: "Desk", value: selectedMarket, tone: "accent" },
                      ]}
                    />

                    <MetricCard
                      label="F&O Regime"
                      value={snapshot.fnoSignal}
                      tone={getSignalTone(snapshot.fnoSignal)}
                      details={[
                        {
                          label: "PCR",
                          value: snapshot.fnoPcr != null ? snapshot.fnoPcr.toFixed(2) : "--",
                          tone: getSignalTone(snapshot.fnoSignal),
                        },
                        {
                          label: "Spot",
                          value: snapshot.fnoSpot != null ? formatPrice(snapshot.fnoSpot) : "--",
                        },
                      ]}
                    />

                    <MetricCard
                      label="Watchlist Radar"
                      value={`${snapshot.watchlistCount} Symbols`}
                      tone={snapshot.watchlistCount > 0 ? "accent" : "neutral"}
                      delta={{
                        label: `${snapshot.watchlistDerivativesCount} F&O linked`,
                        tone: snapshot.watchlistDerivativesCount > 0 ? "up" : "neutral",
                      }}
                      details={[
                        { label: "Derivatives", value: String(snapshot.watchlistDerivativesCount) },
                        { label: "Relay", value: realtimeMode.toUpperCase() },
                      ]}
                    />

                    <MetricCard
                      label="Research Queue"
                      value={`${newsLog.length} Headlines`}
                      tone={leadHeadline?.sentiment?.label === "Bearish" ? "down" : leadHeadline ? "accent" : "neutral"}
                      delta={{
                        label: newsAutoRefresh ? `Auto refresh ${newsRefreshSec}s` : "Manual news sync",
                        tone: newsAutoRefresh ? "accent" : "neutral",
                      }}
                      details={[
                        { label: "Lead Source", value: leadHeadline?.source || "--" },
                        { label: "Headlines", value: String(newsLog.length) },
                      ]}
                    />
                  </div>
                </section>
              </section>
              ) : null}
            {showHomeSection("heatmap") || showHomeSection("timeline") ? (
            <section className="grid min-w-0 gap-3" aria-label="Dashboard Intelligence">
                {showHomeSection("heatmap") ? <ExposureHeatmap
                  title="Portfolio Exposure Heatmap"
                  market={selectedMarket}
                  items={portfolioItems}
                  defaultMode="sector"
                  onCreateWatchlist={() => navigate("/equity/watchlist")}
                  onOpenRisk={() => navigate("/equity/risk")}
                /> : null}
              {showHomeSection("timeline") ? <IntelligenceTimeline
                market={selectedMarket}
                symbols={portfolioItems.map((item) => item.ticker)}
                limit={10}
                title="Home Intelligence Timeline"
                onAddAlert={() => navigate("/equity/alerts")}
                onOpenScreener={() => navigate("/equity/screener")}
              /> : null}
            </section>
            ) : null}
              </div>
              <aside className="grid min-w-0 content-start gap-3" aria-label="Market outlook and desk context">
            <div className="grid grid-cols-1">
              <AiInsightCard
                title="AI Market Outlook"
                description="Provider-agnostic interpretation of the displayed cross-asset snapshot"
                disabled={!marketRows.some((row) => row.ltp > 0)}
                disabledMessage="Live market observations are unavailable; an outlook cannot be grounded yet."
                fetcher={(_, options) =>
                  fetchCollectionBriefing(
                    MARKET_PULSE_SYMBOLS,
                    "global markets",
                    marketRows
                      .filter((row) => row.ltp > 0)
                      .map((row) => ({
                        symbol: row.symbol,
                        label: row.label,
                        price: row.ltp,
                        change: row.chg,
                        change_pct: row.chgPct,
                      })),
                    options,
                  )
                }
              />
            </div>

                {showHomeSection("health") ? (
                <section className="rounded-sm border border-terminal-border bg-terminal-panel/80 p-3" aria-label="System Health">
                  <div className="mb-3">
                    <h2 className="ot-type-panel-title uppercase tracking-normal text-terminal-accent">System Health</h2>
                    <p className="mt-1 text-sm text-terminal-muted">
                      Connection, refresh and derivatives status.
                    </p>
                  </div>
                  <SystemHealthBar ariaLabel="System health indicators" items={systemHealthItems} />
                  <div className="mt-3 grid gap-2 text-xs text-terminal-muted sm:grid-cols-2">
                    <div className="rounded-sm border border-terminal-border bg-terminal-bg/40 px-2 py-2">
                      <span className="block text-xs uppercase tracking-normal">Focus Asset</span>
                      <span className="mt-1 block text-sm text-terminal-text">{focusedMarket?.label || "--"}</span>
                    </div>
                    <div className="rounded-sm border border-terminal-border bg-terminal-bg/40 px-2 py-2">
                      <span className="block text-xs uppercase tracking-normal">Desk Mode</span>
                      <span className="mt-1 block text-sm text-terminal-text">
                        {selectedMarket} / {displayCurrency}
                      </span>
                    </div>
                  </div>
                </section>
                ) : null}

                {showHomeSection("news") ? (
                <section className="rounded-sm border border-terminal-border bg-terminal-panel/80 p-3" aria-label="Intel Wire">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="ot-type-panel-title uppercase tracking-normal text-terminal-accent">Intel Wire</h2>
                      <p className="mt-1 text-sm text-terminal-muted">
                        Latest headlines and available sentiment.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-sm border border-terminal-border px-2 py-1 text-xs uppercase tracking-normal text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                      onClick={() => navigate("/equity/news")}
                    >
                      Open News
                    </button>
                  </div>

                  {newsLog.length > 0 ? (
                    <ol className="space-y-2" role="list" aria-label="Latest headlines">
                      {newsLog.slice(0, 5).map((entry) => (
                        <li key={String(entry.id)} className="rounded-sm border border-terminal-border bg-terminal-bg/40 p-2">
                          <a
                            href={entry.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block focus-visible:outline-none focus-visible:text-terminal-accent hover:text-terminal-accent"
                          >
                            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-xs uppercase tracking-normal text-terminal-muted">
                                  {entry.source}
                                  {entry.published_at
                                    ? ` • ${new Date(entry.published_at).toLocaleTimeString("en-US", {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                        hour12: false,
                                      })}`
                                    : ""}
                                </p>
                                <p className="mt-1 text-sm font-medium text-terminal-text">{entry.title}</p>
                              </div>
                              {entry.sentiment ? (
                                <span className={`shrink-0 text-xs font-medium uppercase tracking-normal ${getSentimentClass(entry.sentiment.label)}`}>
                                  {entry.sentiment.label} {Math.round(entry.sentiment.confidence * 100)}%
                                </span>
                              ) : null}
                            </div>
                          </a>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <GuidedEmptyState
                      title="Start the news radar"
                      message="Create a watchlist or open the news desk so the home wire has symbols and headlines to prioritize."
                      icon="NEWS"
                      actions={[
                        { label: "Create Watchlist", onClick: () => navigate("/equity/watchlist") },
                        { label: "Open News", onClick: () => navigate("/equity/news") },
                      ]}
                    />
                  )}
                </section>
                ) : null}
              </aside>
            </div>



            {showHomeSection("launch") ? (
            <section className="rounded-sm border border-terminal-border bg-terminal-panel/80 p-3" aria-label="Launch Matrix">
              <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="ot-type-panel-title uppercase tracking-normal text-terminal-accent">Launch Matrix</h2>
                  <p className="mt-1 text-sm text-terminal-muted">
                    Open a market, research or workspace tool.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-sm border border-terminal-border px-2 py-1 text-xs uppercase tracking-normal text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                    onClick={() => navigate("/equity/chart-workstation")}
                  >
                    Open Workstation
                  </button>
                  <button
                    type="button"
                    className="rounded-sm border border-terminal-border px-2 py-1 text-xs uppercase tracking-normal text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                    onClick={() => navigate("/equity/screener")}
                  >
                    Open Screener
                  </button>
                </div>
              </div>
              <QuickNavGrid ariaLabel="Launch matrix" sections={launchSections} columnCount={4} />
            </section>
            ) : null}
          </main>
        ) : null}
      </div>
    </TerminalShell>
  );
}
