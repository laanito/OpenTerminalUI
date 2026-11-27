import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { fetchChart } from "../api/client";
import { AnalyticsTable, analyticsNumber } from "../components/terminal/AnalyticsRead";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TickerDropdown } from "../components/chart-workstation/TickerDropdown";
import { terminalChartTheme } from "../shared/chart/chartTheme";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";
import { terminalColors } from "../theme/terminal";
import type { ChartPoint } from "../types";
import { normalizeTicker } from "../utils/ticker";

type ChartMode = "candles" | "line";
type IndicatorPeriod = 20 | 50 | 200;
type TimeframeLabel = "1m" | "5m" | "15m" | "1H" | "4H" | "D" | "W" | "M";
type PanelRole = "long-term" | "medium-term" | "short-term" | "execution";
type TrendDirection = "up" | "down" | "sideways";

type PresetKey = "position" | "swing" | "day-trade" | "scalp";

type TimeframeConfig = {
  label: TimeframeLabel;
  interval: string;
  range: string;
};

type Preset = {
  key: PresetKey;
  label: string;
  frames: [TimeframeConfig, TimeframeConfig, TimeframeConfig, TimeframeConfig];
};

type PanelDataset = {
  interval: TimeframeConfig;
  data: ChartPoint[];
  loading: boolean;
  error: string | null;
};

type TrendSummary = {
  price: number | null;
  ema20: number | null;
  diffPct: number | null;
  direction: TrendDirection;
};

type MtaChartPanelProps = {
  panelId: PanelRole;
  symbol: string;
  intervalLabel: TimeframeLabel;
  data: ChartPoint[];
  loading: boolean;
  error: string | null;
  chartMode: ChartMode;
  indicatorPeriod: IndicatorPeriod;
  syncEnabled: boolean;
  sharedCrosshairTime: number | null;
  onHoverTimeChange: (time: number | null) => void;
  onChartModeChange: (mode: ChartMode) => void;
  onIndicatorPeriodChange: (period: IndicatorPeriod) => void;
};

const PRESETS: Preset[] = [
  {
    key: "position",
    label: "Position",
    frames: [
      { label: "M", interval: "1mo", range: "max" },
      { label: "W", interval: "1wk", range: "5y" },
      { label: "D", interval: "1d", range: "1y" },
      { label: "4H", interval: "4h", range: "6mo" },
    ],
  },
  {
    key: "swing",
    label: "Swing",
    frames: [
      { label: "W", interval: "1wk", range: "5y" },
      { label: "D", interval: "1d", range: "1y" },
      { label: "4H", interval: "4h", range: "6mo" },
      { label: "1H", interval: "1h", range: "3mo" },
    ],
  },
  {
    key: "day-trade",
    label: "Day Trade",
    frames: [
      { label: "D", interval: "1d", range: "1y" },
      { label: "1H", interval: "1h", range: "3mo" },
      { label: "15m", interval: "15m", range: "1mo" },
      { label: "5m", interval: "5m", range: "1mo" },
    ],
  },
  {
    key: "scalp",
    label: "Scalp",
    frames: [
      { label: "1H", interval: "1h", range: "3mo" },
      { label: "15m", interval: "15m", range: "1mo" },
      { label: "5m", interval: "5m", range: "1mo" },
      { label: "1m", interval: "1m", range: "5d" },
    ],
  },
];

const PANEL_ROLES: PanelRole[] = ["long-term", "medium-term", "short-term", "execution"];
const PANEL_TITLES: Record<PanelRole, string> = {
  "long-term": "Long-term",
  "medium-term": "Medium-term",
  "short-term": "Short-term",
  execution: "Execution",
};
const PANEL_CROSSHAIR_COLORS: Record<PanelRole, string> = {
  "long-term": "rgba(255, 107, 0, 0.75)",
  "medium-term": "rgba(78, 161, 255, 0.75)",
  "short-term": "rgba(0, 193, 118, 0.75)",
  execution: "rgba(255, 183, 77, 0.85)",
};
const INDICATOR_PERIODS: IndicatorPeriod[] = [20, 50, 200];

function marketToDropdown(value: string): "IN" | "US" {
  return value === "NSE" || value === "BSE" ? "IN" : "US";
}

function marketToApi(value: string): "NSE" | "NASDAQ" {
  return value === "NSE" || value === "BSE" ? "NSE" : "NASDAQ";
}

function formatPrice(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: value >= 1000 ? 1 : 2,
    maximumFractionDigits: value >= 1000 ? 1 : 2,
  });
}

function formatDiffPct(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatTrendMessage(summary: TrendSummary): string {
  if (summary.price === null || summary.ema20 === null || summary.diffPct === null) {
    return "EMA20 unavailable";
  }
  if (summary.direction === "sideways") {
    return `Near EMA20 (${formatDiffPct(summary.diffPct)})`;
  }
  return `${summary.diffPct >= 0 ? "Above" : "Below"} EMA20 by ${Math.abs(summary.diffPct).toFixed(1)}%`;
}

function trendVisual(direction: TrendDirection): { arrow: string; tone: string } {
  if (direction === "up") {
    return { arrow: "↑", tone: "text-terminal-pos border-terminal-pos/40 bg-terminal-pos/10" };
  }
  if (direction === "down") {
    return { arrow: "↓", tone: "text-terminal-neg border-terminal-neg/40 bg-terminal-neg/10" };
  }
  return { arrow: "→", tone: "text-terminal-warn border-terminal-warn/40 bg-terminal-warn/10" };
}

function computeEma(data: ChartPoint[], period: number): Array<{ time: number; value: number }> {
  if (!data.length) return [];
  const alpha = 2 / (period + 1);
  const result: Array<{ time: number; value: number }> = [];
  let ema = Number(data[0]?.c);
  if (!Number.isFinite(ema)) return [];
  for (const point of data) {
    const close = Number(point.c);
    if (!Number.isFinite(close)) continue;
    ema += alpha * (close - ema);
    result.push({ time: Number(point.t), value: ema });
  }
  return result;
}

function findClosestPoint(data: ChartPoint[], targetTime: number | null): ChartPoint | null {
  if (!data.length) return null;
  if (targetTime === null || !Number.isFinite(targetTime)) {
    return data[data.length - 1] ?? null;
  }
  let low = 0;
  let high = data.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const time = Number(data[mid]?.t);
    if (time === targetTime) return data[mid] ?? null;
    if (time < targetTime) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const left = high >= 0 ? data[high] : null;
  const right = low < data.length ? data[low] : null;
  if (!left) return right;
  if (!right) return left;
  return Math.abs(Number(left.t) - targetTime) <= Math.abs(Number(right.t) - targetTime) ? left : right;
}

function computeTrendSummary(data: ChartPoint[]): TrendSummary {
  if (!data.length) {
    return { price: null, ema20: null, diffPct: null, direction: "sideways" };
  }
  const price = Number(data[data.length - 1]?.c);
  if (!Number.isFinite(price)) {
    return { price: null, ema20: null, diffPct: null, direction: "sideways" };
  }
  const ema20Series = computeEma(data, 20);
  const ema20 = ema20Series[ema20Series.length - 1]?.value ?? null;
  if (ema20 === null || !Number.isFinite(ema20) || ema20 === 0) {
    return { price, ema20: null, diffPct: null, direction: "sideways" };
  }
  const diffPct = ((price - ema20) / ema20) * 100;
  const absDiff = Math.abs(diffPct);
  const direction: TrendDirection = absDiff <= 0.5 ? "sideways" : diffPct > 0 ? "up" : "down";
  return { price, ema20, diffPct, direction };
}

function alignmentBadge(trends: TrendSummary[]): { label: "ALIGNED" | "MIXED" | "UNAVAILABLE"; className: string } {
  if (trends.some(trend => trend.price === null || trend.ema20 === null || trend.diffPct === null)) return { label: "UNAVAILABLE", className: "border-terminal-border text-terminal-muted" };
  const firstDirectional = trends.find((trend) => trend.direction !== "sideways")?.direction ?? null;
  const aligned =
    firstDirectional !== null &&
    trends.every((trend) => trend.direction === firstDirectional);
  return aligned
    ? { label: "ALIGNED", className: "border-terminal-pos/40 bg-terminal-pos/10 text-terminal-pos" }
    : { label: "MIXED", className: "border-terminal-warn/40 bg-terminal-warn/10 text-terminal-warn" };
}

function chartPointSeriesData(data: ChartPoint[]) {
  return data
    .map((point) => ({
      time: Number(point.t) as UTCTimestamp,
      open: Number(point.o),
      high: Number(point.h),
      low: Number(point.l),
      close: Number(point.c),
    }))
    .filter(
      (point) =>
        Number.isFinite(Number(point.time)) &&
        Number.isFinite(point.open) &&
        Number.isFinite(point.high) &&
        Number.isFinite(point.low) &&
        Number.isFinite(point.close),
    );
}

function priceLineData(data: ChartPoint[]) {
  return data
    .map((point) => ({
      time: Number(point.t) as UTCTimestamp,
      value: Number(point.c),
    }))
    .filter((point) => Number.isFinite(Number(point.time)) && Number.isFinite(point.value));
}

function MtaChartPanel({
  panelId,
  symbol,
  intervalLabel,
  data,
  loading,
  error,
  chartMode,
  indicatorPeriod,
  syncEnabled,
  sharedCrosshairTime,
  onHoverTimeChange,
  onChartModeChange,
  onIndicatorPeriodChange,
}: MtaChartPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const dataRef = useRef(data);
  const syncEnabledRef = useRef(syncEnabled);
  const hoverTimeChangeRef = useRef(onHoverTimeChange);
  const [crosshairStyle, setCrosshairStyle] = useState<CSSProperties>({ opacity: 0 });
  const [hover, setHover] = useState<{ source: ChartPoint[]; price: number; time: number } | null>(null);
  const chartData = useMemo(() => chartPointSeriesData(data), [data]);
  const lineData = useMemo(() => priceLineData(data), [data]);
  const emaData = useMemo(
    () =>
      computeEma(data, indicatorPeriod).map((point) => ({
        time: point.time as UTCTimestamp,
        value: point.value,
      })),
    [data, indicatorPeriod],
  );
  const inspected = hover?.source === data ? hover : null;
  const latestPrice = inspected ? inspected.price : data.length ? Number(data[data.length - 1]?.c) : null;
  const inspectedTime = inspected ? inspected.time : data.length ? Number(data[data.length - 1]?.t) : null;
  const emaByTime = useMemo(() => new Map(emaData.map(point => [Number(point.time),point.value])), [emaData]);
  const observationTime = (value: number | null) => value !== null && Number.isFinite(value) && !Number.isNaN(new Date(value*1000).getTime()) ? new Date(value*1000).toISOString().replace("T"," ").replace(".000Z"," UTC") : "Unavailable";


  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    syncEnabledRef.current = syncEnabled;
  }, [syncEnabled]);

  useEffect(() => {
    hoverTimeChangeRef.current = onHoverTimeChange;
  }, [onHoverTimeChange]);

  useEffect(() => {
    if (!hostRef.current || chartApiRef.current) return;
    const chart = createChart(hostRef.current, {
      ...terminalChartTheme,
      layout: {
        ...terminalChartTheme.layout,
        fontSize: 12,
        background: {
          type: ColorType.Solid,
          color: terminalColors.panel,
        },
      },
      width: hostRef.current.clientWidth,
      height: hostRef.current.clientHeight || 320,
      grid: {
        vertLines: { color: "rgba(45, 55, 69, 0.35)" },
        horzLines: { color: "rgba(45, 55, 69, 0.35)" },
      },
      timeScale: {
        ...terminalChartTheme.timeScale,
        rightOffset: 4,
        barSpacing: 8,
      },
      rightPriceScale: {
        borderColor: terminalColors.border,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: terminalColors.candleUp,
      downColor: terminalColors.candleDown,
      borderVisible: false,
      wickUpColor: terminalColors.candleUp,
      wickDownColor: terminalColors.candleDown,
      visible: chartMode === "candles",
    });
    const line = chart.addSeries(LineSeries, {
      color: terminalColors.accent,
      lineWidth: 2,
      visible: chartMode === "line",
      priceLineVisible: true,
      crosshairMarkerVisible: false,
    });
    const ema = chart.addSeries(LineSeries, {
      color: terminalColors.info,
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    chartApiRef.current = chart;
    candleSeriesRef.current = candles;
    lineSeriesRef.current = line;
    emaSeriesRef.current = ema;

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      const nextTime = typeof param.time === "number" ? Number(param.time) : null;
      const matched = findClosestPoint(dataRef.current, nextTime);
      startTransition(() => {
        setHover(nextTime !== null && matched ? { source: dataRef.current, price: Number(matched.c), time: Number(matched.t) } : null);
      });
      if (syncEnabledRef.current) {
        hoverTimeChangeRef.current(nextTime);
      }
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    resizeObserverRef.current = new ResizeObserver(() => {
      const host = hostRef.current;
      if (!host) return;
      chart.applyOptions({
        width: host.clientWidth,
        height: host.clientHeight || 320,
      });
    });
    resizeObserverRef.current.observe(hostRef.current);

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      emaSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    candleSeriesRef.current?.applyOptions({ visible: chartMode === "candles" });
    lineSeriesRef.current?.applyOptions({ visible: chartMode === "line" });
  }, [chartMode]);

  useEffect(() => {
    candleSeriesRef.current?.setData(chartData);
    lineSeriesRef.current?.setData(lineData);
    emaSeriesRef.current?.setData(emaData);
    if (chartData.length > 0) {
      chartApiRef.current?.timeScale().fitContent();
    }
  }, [chartData, emaData, lineData]);

  useEffect(() => {
    if (!syncEnabled || sharedCrosshairTime === null) {
      setCrosshairStyle({ opacity: 0 });
      return;
    }
    const chart = chartApiRef.current;
    if (!chart) return;
    const matched = findClosestPoint(data, sharedCrosshairTime);
    if (!matched) {
      setCrosshairStyle({ opacity: 0 });
      return;
    }
    const coordinate = chart.timeScale().timeToCoordinate(Number(matched.t) as UTCTimestamp);
    if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) {
      setCrosshairStyle({ opacity: 0 });
      return;
    }
    setCrosshairStyle({
      opacity: 1,
      transform: `translateX(${coordinate}px)`,
    });
  }, [data, sharedCrosshairTime, syncEnabled]);

  return <section aria-label={`${PANEL_TITLES[panelId]} chart context`} aria-busy={loading} data-testid={`mta-panel-${panelId}`} className="min-w-0 rounded border border-terminal-border bg-terminal-panel">
    <header className="min-w-0 space-y-3 border-b border-terminal-border p-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1 basis-48"><h2 className="text-sm font-semibold text-terminal-text">{PANEL_TITLES[panelId]} · <span data-testid={`mta-interval-${panelId}`}>{intervalLabel}</span></h2><p className="mt-1 break-words text-sm text-terminal-muted">{symbol}</p></div><dl className="min-w-0"><dt className="text-xs text-terminal-muted">{inspected ? "Inspected close" : "Latest close"}</dt><dd className="mt-1 break-words text-base tabular-nums text-terminal-text" data-testid={`mta-close-${panelId}`}>{formatPrice(latestPrice)}</dd><dd className="mt-1 text-xs text-terminal-muted">{observationTime(inspectedTime)}</dd></dl></div>
      <details><summary className="cursor-pointer text-xs text-terminal-text">Chart controls · {chartMode === "candles" ? "Candles" : "Line"} · EMA {indicatorPeriod}</summary><div className="mt-3 flex min-w-0 flex-wrap gap-3"><label className="min-w-0 flex-1 basis-40 space-y-2 text-xs text-terminal-text">Chart style<TerminalInput as="select" className="block text-sm" value={chartMode} onChange={event => onChartModeChange(event.target.value as ChartMode)}><option value="candles">Candles</option><option value="line">Line</option></TerminalInput></label><label className="min-w-0 flex-1 basis-40 space-y-2 text-xs text-terminal-text">EMA overlay<TerminalInput as="select" className="block text-sm" value={indicatorPeriod} onChange={event => onIndicatorPeriodChange(Number(event.target.value) as IndicatorPeriod)}>{INDICATOR_PERIODS.map(period => <option key={period} value={period}>EMA {period}</option>)}</TerminalInput></label></div></details>
    </header>
    <div className="relative h-80 min-w-0 overflow-hidden">
      <div ref={hostRef} role="img" aria-label={`${PANEL_TITLES[panelId]} ${intervalLabel} price chart`} className="h-full w-full" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 top-0 z-[4] w-px" style={{ ...(data.length ? crosshairStyle : { opacity: 0 }), background: PANEL_CROSSHAIR_COLORS[panelId], boxShadow: `0 0 12px ${PANEL_CROSSHAIR_COLORS[panelId]}` }} />
      {loading ? <p role="status" className="absolute inset-0 flex items-center justify-center bg-terminal-panel/90 p-4 text-sm text-terminal-muted">Loading {intervalLabel} history…</p> : error ? <p role="alert" className="absolute inset-0 flex items-center justify-center bg-terminal-panel/90 p-4 text-center text-sm text-terminal-neg">{error}</p> : !data.length ? <p role="status" className="absolute inset-0 flex items-center justify-center bg-terminal-panel/90 p-4 text-sm text-terminal-muted">No chart data returned for this context.</p> : null}
    </div>
    <details className="min-w-0 border-t border-terminal-border p-3"><summary className="cursor-pointer text-sm text-terminal-text">Exact observations · EMA {indicatorPeriod}</summary><div className="mt-3"><AnalyticsTable name={`${PANEL_TITLES[panelId]} exact observations`} headers={["UTC observation","Open","High","Low","Close","Volume",`EMA ${indicatorPeriod}`]} rows={data.map(point => [observationTime(Number(point.t)),analyticsNumber(point.o,4),analyticsNumber(point.h,4),analyticsNumber(point.l,4),analyticsNumber(point.c,4),analyticsNumber(point.v,0),analyticsNumber(emaByTime.get(Number(point.t)),4)])} /></div></details>
  </section>;

}

export function MultiTimeframePage() {
  const selectedMarket = useSettingsStore((state) => state.selectedMarket);
  const persistedTicker = useStockStore((state) => state.ticker);
  const setPersistedTicker = useStockStore((state) => state.setTicker);
  const [symbol, setSymbol] = useState(() => normalizeTicker(persistedTicker || "AAPL"));
  const [presetKey, setPresetKey] = useState<PresetKey>("swing");
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [sharedCrosshairTime, setSharedCrosshairTime] = useState<number | null>(null);
  const [chartModes, setChartModes] = useState<Record<PanelRole, ChartMode>>({
    "long-term": "candles",
    "medium-term": "candles",
    "short-term": "candles",
    execution: "candles",
  });
  const [indicatorPeriods, setIndicatorPeriods] = useState<Record<PanelRole, IndicatorPeriod>>({
    "long-term": 20,
    "medium-term": 20,
    "short-term": 20,
    execution: 20,
  });
  const [revision,setRevision] = useState(0);
  const [companyName,setCompanyName] = useState<string | null>(null);
  const market = useMemo(() => marketToApi(selectedMarket), [selectedMarket]);
  const dropdownMarket = useMemo(() => marketToDropdown(selectedMarket), [selectedMarket]);
  const preset = useMemo(() => PRESETS.find(item => item.key === presetKey) ?? PRESETS[1], [presetKey]);
  const scope = JSON.stringify([symbol,market,presetKey,revision]);
  const emptyPanels = useMemo<Record<PanelRole,PanelDataset>>(() => { const panel = (index: number): PanelDataset => ({ interval: preset.frames[index],data: [],loading: true,error: null }); return { "long-term": panel(0),"medium-term": panel(1),"short-term": panel(2),execution: panel(3) }; }, [preset]);
  const [read,setRead] = useState<{ scope: string; panels: Record<PanelRole,PanelDataset> }>({ scope: "",panels: emptyPanels });
  const datasets = read.scope === scope ? read.panels : emptyPanels;

  useEffect(() => { const next = normalizeTicker(symbol); if (next) setPersistedTicker(next); }, [symbol,setPersistedTicker]);
  useEffect(() => { setSharedCrosshairTime(null); }, [scope]);
  useEffect(() => {
    let active = true;
    setRead({ scope,panels: emptyPanels });
    PANEL_ROLES.forEach(async (role,index) => {
      const interval = preset.frames[index];
      let data: ChartPoint[] = [],error: string | null = null;
      try { const response = await fetchChart(symbol,interval.interval,interval.range,market); data = Array.isArray(response.data) ? response.data : []; }
      catch { error = "Could not load this context. Refresh charts to retry; no previous values are shown."; }
      if (active) setRead(current => current.scope === scope ? { scope,panels: { ...current.panels,[role]: { interval,data,loading: false,error } } } : current);
    });
    return () => { active = false; };
  }, [scope,emptyPanels,market,preset,symbol]);

  const trendSummaries = useMemo(
    () =>
      PANEL_ROLES.map((role) => ({
        role,
        intervalLabel: datasets[role].interval.label,
        summary: computeTrendSummary(datasets[role].data),
      })),
    [datasets],
  );

  const alignment = useMemo(
    () => alignmentBadge(trendSummaries.map((item) => item.summary)),
    [trendSummaries],
  );

  return <main aria-label="Multi-timeframe workspace" data-testid="mta-page" className="min-w-0 space-y-4 p-3 text-terminal-text sm:p-4">
    <header className="space-y-2"><h1 className="text-lg font-semibold">Multi-Timeframe Analysis</h1><p className="text-sm text-terminal-muted">Four chart contexts for structural trend, intermediate setup, timing and execution.</p></header>
    <section aria-label="Timeframe scope" className="min-w-0 space-y-3 rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="flex min-w-0 flex-wrap items-end gap-3"><div className="min-w-0 flex-1 basis-64 space-y-2"><p className="text-xs">Chart symbol</p><TickerDropdown key={dropdownMarket} value={symbol} market={dropdownMarket} placeholder="Search symbol" inputTestId="mta-symbol-input" className="w-full min-w-0 [&_.ticker-dropdown-results]:w-full [&_.ticker-dropdown-results]:max-w-full [&_.ticker-dropdown-item]:flex-col [&_.ticker-dropdown-item]:items-start [&_.ticker-dropdown-item]:break-words" inputClassName="w-full !min-w-0 !text-sm" onChange={(ticker,_context,name) => { const next = normalizeTicker(ticker); if (!next) return; setSharedCrosshairTime(null); setSymbol(next); setCompanyName(name || null); }} /></div><label data-testid="mta-crosshair-toggle" className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={syncEnabled} onChange={event => { setSyncEnabled(event.target.checked); if (!event.target.checked) setSharedCrosshairTime(null); }} />Crosshair sync</label><TerminalButton type="button" onClick={() => setRevision(value => value+1)} className="normal-case tracking-normal">Refresh charts</TerminalButton></div>
      <p className="break-words text-sm text-terminal-muted">{symbol} · {market} · {preset.label}{companyName ? ` · ${companyName}` : ""}</p>
      <nav aria-label="Timeframe presets" className="flex min-w-0 flex-wrap gap-2">{PRESETS.map(item => <TerminalButton key={item.key} type="button" data-testid={`mta-preset-${item.key}`} aria-pressed={presetKey === item.key} variant={presetKey === item.key ? "accent" : "default"} className="normal-case tracking-normal" onClick={() => { setPresetKey(item.key); setSharedCrosshairTime(null); }}>{item.label}<span className="ml-2 text-xs normal-case">{item.frames.map(frame => frame.label).join(" / ")}</span></TerminalButton>)}</nav>
    </section>
    <div data-testid="mta-grid" className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-2">{PANEL_ROLES.map(role => <MtaChartPanel key={role} panelId={role} symbol={symbol} intervalLabel={datasets[role].interval.label} data={datasets[role].data} loading={datasets[role].loading} error={datasets[role].error} chartMode={chartModes[role]} indicatorPeriod={indicatorPeriods[role]} syncEnabled={syncEnabled} sharedCrosshairTime={sharedCrosshairTime} onHoverTimeChange={time => { if (syncEnabled) setSharedCrosshairTime(time); }} onChartModeChange={mode => setChartModes(current => ({ ...current,[role]: mode }))} onIndicatorPeriodChange={period => setIndicatorPeriods(current => ({ ...current,[role]: period }))} />)}</div>
    <details data-testid="mta-trend-summary" className="min-w-0 rounded border border-terminal-border bg-terminal-panel p-3"><summary className="cursor-pointer text-sm font-semibold">Trend summary · <span className={`rounded border px-2 py-1 text-xs ${alignment.className}`}>{alignment.label}</span></summary><p className="mt-3 text-sm text-terminal-muted">Latest closes versus EMA20 across the selected stack. This summary always uses EMA20, independently of each chart’s selected overlay.</p><div className="mt-3 flex min-w-0 flex-wrap gap-3">{trendSummaries.map(({ role,intervalLabel,summary }) => { const ready = summary.price !== null && summary.ema20 !== null && summary.diffPct !== null; const visual = ready ? trendVisual(summary.direction) : { arrow: "—",tone: "border-terminal-border text-terminal-muted" }; return <section key={role} aria-label={`${PANEL_TITLES[role]} trend`} data-testid={`mta-trend-${role}`} className="min-w-0 flex-1 basis-48 rounded border border-terminal-border p-3"><div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">{PANEL_TITLES[role]} · {intervalLabel}</h2><span data-testid={`mta-trend-arrow-${role}`} className={`rounded border px-2 py-1 text-sm ${visual.tone}`}>{visual.arrow}</span></div><p className="mt-3 break-words text-sm">{formatPrice(summary.price)}</p><p className="mt-2 text-xs text-terminal-muted">{datasets[role].loading ? "Loading history…" : datasets[role].error ? "History unavailable" : formatTrendMessage(summary)}</p></section>; })}</div></details>
    <details className="rounded border border-terminal-border p-3 text-sm"><summary className="cursor-pointer">Context and interpretation</summary><div className="mt-3 space-y-2 text-terminal-muted"><p>These are historical chart observations, not live execution signals. M = monthly, W = weekly, D = daily, H = hours, m = minutes. Crosshair sync marks the nearest available bar in each context; different observation times do not imply simultaneous prices.</p><p>EMA20 alignment is the retained trend heuristic, not a validated trading conclusion. Search retains its US/India context, and chart requests retain the existing NASDAQ/NSE market mapping. Listing coverage, interval availability and adjusted-price/currency basis depend on the existing data service. No display-currency conversion is applied here.</p></div></details>
  </main>;
}
