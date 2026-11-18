import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { searchSymbols, type SearchSymbolItem } from "../../api/client";
import { CountryFlag } from "../common/CountryFlag";
import { NotificationBell } from "../notifications/NotificationBell";
import { useNavigationHistory } from "../../hooks/useNavigationHistory";
import { inferRecentSecurityAssetClass, inferRecentSecurityMarket, useRecentSecurities } from "../../hooks/useRecentSecurities";
import { useMarketStatus, useTopBarTickers } from "../../hooks/useStocks";
import { useQuotesStore } from "../../realtime/useQuotesStream";
import { useSettingsStore } from "../../store/settingsStore";
import { useStockStore } from "../../store/stockStore";
import { COUNTRY_DEFAULT_MARKET, COUNTRY_MARKETS } from "../../types";
import type { CountryCode, MarketCode } from "../../types";
import type { DisplayCurrency } from "../../store/settingsStore";

const COUNTRY_FLAGS: Record<CountryCode, string> = {
  IN: "🇮🇳",
  US: "🇺🇸",
  EU: "🇪🇺",
  CRYPTO: "🪙",
};

type TopBarProps = {
  hideTickerLoader?: boolean;
  hideMarketMarquee?: boolean;
};

const BRAND_ICON_SRC = "/favicon.png";

export function TopBar({ hideTickerLoader = false, hideMarketMarquee = false }: TopBarProps) {
  const navigate = useNavigate();
  const setTicker = useStockStore((s) => s.setTicker);
  const load = useStockStore((s) => s.load);
  const stock = useStockStore((s) => s.stock);
  const ticker = useStockStore((s) => s.ticker);
  const selectedCountry = useSettingsStore((s) => s.selectedCountry);
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const setSelectedCountry = useSettingsStore((s) => s.selectedCountry === "IN" ? s.setSelectedCountry : s.setSelectedCountry); // keep store reactive
  const setSelectedMarket = useSettingsStore((s) => s.setSelectedMarket);
  const setDisplayCurrency = useSettingsStore((s) => s.setDisplayCurrency);
  const { addRecent } = useRecentSecurities();
  const { breadcrumbs } = useNavigationHistory({ autoTrack: true });

  const { data: polledStatus } = useMarketStatus();
  const realtimeStatus = useQuotesStore((s) => s.marketStatus);
  const { data: topBarTickers } = useTopBarTickers();

  const [query, setQuery] = useState(ticker);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [results, setResults] = useState<SearchSymbolItem[]>([]);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchRequestRef = useRef(0);
  const suppressSuggestionsRef = useRef(false);
  const marketsForCountry = COUNTRY_MARKETS[selectedCountry];

  const statusPayload = (realtimeStatus || polledStatus) as {
    error?: string;
    marketState?: Array<{ marketStatus?: string; tradeDate?: string }>;
    nifty50?: number | null;
    sensex?: number | null;
    inrUsd?: number | null;
    usdInr?: number | null;
    sp500?: number | null;
    nikkei225?: number | null;
    hangseng?: number | null;
    nifty50Pct?: number | null;
    sensexPct?: number | null;
    usdInrPct?: number | null;
    sp500Pct?: number | null;
    nikkei225Pct?: number | null;
    hangsengPct?: number | null;
    fallbackEnabled?: boolean;
    source?: { nseIndices?: boolean };
  } | undefined;
  const marketError = statusPayload?.error;
  const inrUsd = typeof statusPayload?.inrUsd === "number" ? statusPayload.inrUsd : null;
  const usdInr = typeof statusPayload?.usdInr === "number" ? statusPayload.usdInr : null;
  const sp500 = typeof statusPayload?.sp500 === "number" ? statusPayload.sp500 : null;
  const nikkei225 = typeof statusPayload?.nikkei225 === "number" ? statusPayload.nikkei225 : null;
  const hangseng = typeof statusPayload?.hangseng === "number" ? statusPayload.hangseng : null;
  const usdInrPct = typeof statusPayload?.usdInrPct === "number" ? statusPayload.usdInrPct : null;
  const sp500Pct = typeof statusPayload?.sp500Pct === "number" ? statusPayload.sp500Pct : null;
  const nikkei225Pct = typeof statusPayload?.nikkei225Pct === "number" ? statusPayload.nikkei225Pct : null;
  const hangsengPct = typeof statusPayload?.hangsengPct === "number" ? statusPayload.hangsengPct : null;
  const hasIndexData = sp500 !== null;
  const hasGlobalData = sp500 !== null || nikkei225 !== null || hangseng !== null;
  const hasFxData = usdInr !== null || inrUsd !== null;
  const isFallback = Boolean(statusPayload?.fallbackEnabled) || !statusPayload?.source?.nseIndices;
  const marketStateLabel = String(statusPayload?.marketState?.[0]?.marketStatus || "").toUpperCase();
  const feedStateLabel = !hasIndexData
    ? "OFFLINE"
    : marketStateLabel === "CLOSE"
    ? "CLOSED"
    : isFallback
    ? "FALLBACK"
    : "LIVE";
  const backendHealthLabel = hasGlobalData && hasFxData ? "stream ok" : "partial feed";

  const formatFx = (value: number | null) => {
    if (value === null) return "83.15";
    return value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  };
  const formatGlobalIndex = (value: number | null) => {
    if (value === null) return "0.00";
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  };
  const formatPct = (value: number | null) => {
    const val = value ?? 0;
    const sign = val > 0 ? "+" : "";
    return `${sign}${val.toFixed(2)}%`;
  };
  const pctClass = (value: number | null) => {
    const val = value ?? 0;
    return val >= 0 ? "text-terminal-pos" : "text-terminal-neg";
  };
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapsedBreadcrumbs = useMemo(() => {
    if (breadcrumbs.length <= 5) return breadcrumbs;
    return [
      breadcrumbs[0],
      breadcrumbs[1],
      { label: "...", path: breadcrumbs[breadcrumbs.length - 2]?.path || breadcrumbs[0].path },
      ...breadcrumbs.slice(-2),
    ];
  }, [breadcrumbs]);

  useEffect(() => {
    setQuery(ticker);
  }, [ticker]);

  useEffect(() => {
    const normalizedTicker = ticker.trim().toUpperCase();
    if (!normalizedTicker) return;

    const resolvedSymbol = String(stock?.ticker || stock?.symbol || "").trim().toUpperCase();
    if (resolvedSymbol && resolvedSymbol !== normalizedTicker) return;

    addRecent(
      normalizedTicker,
      stock?.company_name || normalizedTicker,
      inferRecentSecurityAssetClass(normalizedTicker, stock?.exchange),
      inferRecentSecurityMarket(stock?.country_code || selectedCountry, stock?.exchange || selectedMarket),
      typeof stock?.current_price === "number" ? stock.current_price : undefined,
      typeof stock?.change_pct === "number" ? stock.change_pct : undefined,
    );
  }, [
    addRecent,
    selectedCountry,
    selectedMarket,
    stock?.change_pct,
    stock?.company_name,
    stock?.country_code,
    stock?.current_price,
    stock?.exchange,
    stock?.symbol,
    stock?.ticker,
    ticker,
  ]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || target?.closest?.('[role="dialog"]')) return;
      const tag = target?.tagName?.toLowerCase();
      const editing =
        tag === "input" || tag === "textarea" || tag === "select" || Boolean(target?.isContentEditable);

      if (event.key === "/" && !editing) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if ((event.key === "m" || event.key === "M") && !editing) {
        event.preventDefault();
        navigate("/equity/portfolio");
        return;
      }
      if (event.key === "Escape") {
        if (results.length > 0) {
          setResults([]);
          setIsSuggestionsOpen(false);
          return;
        }
        if (editing && tag === "input") {
          const inputEl = target as HTMLInputElement;
          inputEl.blur();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, results.length]);

  useEffect(() => {
    if (!marketsForCountry.includes(selectedMarket)) {
      setSelectedMarket(COUNTRY_DEFAULT_MARKET[selectedCountry]);
    }
  }, [marketsForCountry, selectedCountry, selectedMarket, setSelectedMarket]);

  const doSearch = useCallback(async (q: string) => {
    if (suppressSuggestionsRef.current) {
      setResults([]);
      setIsSuggestionsOpen(false);
      return;
    }
    if (q.length < 2) {
      setResults([]);
      setIsSuggestionsOpen(false);
      return;
    }
    const requestId = ++searchRequestRef.current;
    try {
      // Unified instrument search already covers crypto + EU + Yahoo fallback.
      const merged = await searchSymbols(q, selectedMarket);
      const seen = new Set<string>();
      const res = merged.filter((item) => {
        const key = `${(item.ticker || "").toUpperCase()}::${(item.name || "").toUpperCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (requestId !== searchRequestRef.current || suppressSuggestionsRef.current) {
        return;
      }
      setResults(res);
      setIsSuggestionsOpen(res.length > 0);
    } catch {
      if (requestId === searchRequestRef.current) {
        setResults([]);
        setIsSuggestionsOpen(false);
      }
    }
  }, [selectedMarket]);

  const handleLoad = useCallback(async () => {
    setResults([]);
    setIsSuggestionsOpen(false);
    try {
      await load();
    } catch {
      // Stock store handles errors internally
    }
  }, [load]);

  const selectTicker = useCallback((value: string | SearchSymbolItem) => {
    const item = typeof value === "string" ? null : value;
    const symbol = (typeof value === "string" ? value : value.ticker).trim().toUpperCase();
    if (!symbol) return;
    suppressSuggestionsRef.current = true;
    searchRequestRef.current += 1;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setResults([]);
    setIsSuggestionsOpen(false);
    setQuery(symbol);
    setTicker(symbol);
    addRecent(
      symbol,
      item?.name || symbol,
      inferRecentSecurityAssetClass(symbol, item?.exchange),
      inferRecentSecurityMarket(item?.country_code || selectedCountry, item?.exchange || selectedMarket),
    );
    void handleLoad();
  }, [addRecent, handleLoad, selectedCountry, selectedMarket, setTicker]);
  const safeTicker = (ticker || "AAPL").toUpperCase();

  return (
    <div className="ot-shell-topbar relative z-20 shrink-0 border-b border-terminal-border bg-terminal-panel" aria-label="Instrument toolbar">
      <div className="relative flex min-w-0 flex-wrap items-center gap-2 px-3 py-1.5">
        <Link
          to="/"
          className="hidden h-8 shrink-0 items-center rounded border border-terminal-border bg-terminal-bg px-1.5 2xl:inline-flex"
          aria-label="OpenTerminalUI Home"
        >
          <img src={BRAND_ICON_SRC} alt="OpenTerminalUI" className="h-5 w-5 object-contain" />
        </Link>
        <div className="hidden shrink-0 items-center gap-2 2xl:flex">
          <Link className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text" to="/">
            HOME
          </Link>
          <Link className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text" to="/equity/screener">
            SCREENER
          </Link>
          <Link className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text" to="/equity/compare">
            COMPARE
          </Link>
          <Link className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text" to={`/fno/heatmap?symbol=${encodeURIComponent(safeTicker)}`}>
            HEATMAP
          </Link>
          <Link className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text" to={`/fno?symbol=${encodeURIComponent(safeTicker)}`}>
            F&O -&gt;
          </Link>
        </div>
        {!hideTickerLoader ? (
          <div className="relative flex min-w-0 basis-40 flex-1 items-center gap-1">
            <input
              ref={searchInputRef}
              className="min-h-9 min-w-0 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs outline-none focus:border-terminal-accent"
              aria-label="Instrument symbol"
              placeholder={`Search ${selectedMarket} symbol ( / )`}
              value={query}
              onChange={(e) => {
                const next = e.target.value.toUpperCase();
                suppressSuggestionsRef.current = false;
                setQuery(next);
                setIsSuggestionsOpen(next.length >= 2);
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => {
                  void doSearch(next);
                }, 300);
              }}
              onFocus={() => {
                if (results.length > 0 && query.length >= 2) {
                  setIsSuggestionsOpen(true);
                }
              }}
              onBlur={() => {
                setTimeout(() => setIsSuggestionsOpen(false), 120);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  selectTicker(query);
                }
                if (e.key === "Escape") {
                  setResults([]);
                  setIsSuggestionsOpen(false);
                }
              }}
            />
            <button
              className="min-h-9 shrink-0 rounded bg-terminal-accent px-2 py-1 text-xs font-medium text-black"
              onClick={() => {
                selectTicker(query);
              }}
            >
              Load
            </button>
            {!hideTickerLoader && isSuggestionsOpen && results.length > 0 && (
              <div className="absolute inset-x-0 top-full mt-1 z-10 max-h-72 overflow-auto rounded border border-terminal-border bg-terminal-panel">
                {results.map((item) => (
                  <button
                    key={`${item.ticker}:${item.name}`}
                    className="block w-full border-b border-terminal-border px-3 py-2 text-left text-sm hover:bg-terminal-bg"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectTicker(item);
                    }}
                    onClick={() => {
                      selectTicker(item);
                    }}
                  >
                    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
                      <CountryFlag countryCode={item.country_code} flagEmoji={item.flag_emoji} size="sm" />
                      <span>{item.ticker}</span>
                      <span className="break-words text-terminal-muted">- {item.name}</span>
                      {item.exchange ? <span className="text-terminal-muted">({item.exchange})</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
        <NotificationBell />
        <button type="button" className="min-h-9 rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted xl:hidden"
          aria-expanded={controlsOpen} aria-controls="shell-market-controls" onClick={() => setControlsOpen(!controlsOpen)}>
          Market controls · {selectedCountry} / {selectedMarket} / {displayCurrency}
        </button>
        <div id="shell-market-controls" role="group" aria-label="Market controls"
          className={`${controlsOpen ? "flex" : "hidden"} min-w-0 basis-full flex-wrap items-center gap-2 xl:flex xl:basis-auto`}>
          <div className="flex shrink-0 items-center gap-1 border-l border-terminal-border pl-2">
            <select
              aria-label="Market region"
              className="min-h-9 w-[88px] rounded border border-terminal-border bg-terminal-bg px-1 py-1 text-[11px] uppercase text-terminal-text outline-none"
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value as CountryCode)}
            >
              <option value="IN">{COUNTRY_FLAGS.IN} IN</option>
              <option value="US">{COUNTRY_FLAGS.US} US</option>
              <option value="EU">{COUNTRY_FLAGS.EU} EU</option>
              <option value="CRYPTO">{COUNTRY_FLAGS.CRYPTO} CRYPTO</option>
            </select>
            <select
              aria-label="Exchange"
              className="min-h-9 w-[86px] rounded border border-terminal-border bg-terminal-bg px-1 py-1 text-[11px] uppercase text-terminal-text outline-none"
              value={selectedMarket}
              onChange={(e) => setSelectedMarket(e.target.value as MarketCode)}
            >
              {marketsForCountry.map((market) => (
                <option key={market} value={market}>
                  {market}
                </option>
              ))}
            </select>
          </div>
          <div className="flex shrink-0 items-center gap-1 border-l border-terminal-border pl-2">
            <select
              className="min-h-9 w-[72px] rounded border border-terminal-border bg-terminal-bg px-1 py-1 text-[11px] uppercase text-terminal-text outline-none"
              value={displayCurrency}
              onChange={(e) => setDisplayCurrency(e.target.value as DisplayCurrency)}
              title="Display currency"
              aria-label="Display currency"
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="INR">INR</option>
            </select>
          </div>
          <div className="hidden shrink-0 items-center gap-1 border-l border-terminal-border pl-2 text-[11px] uppercase tracking-wide text-terminal-muted 2xl:inline-flex">
            <CountryFlag countryCode={selectedCountry} size="sm" />
            <span>{selectedMarket}</span>
          </div>
        </div>
        <Link
          to="/"
          className="hidden h-7 shrink-0 items-center border-l border-terminal-border pl-2 2xl:inline-flex"
          aria-label="OpenTerminalUI Home (Top Right)"
          title="OpenTerminalUI"
        >
          <img src={BRAND_ICON_SRC} alt="OpenTerminalUI" className="h-5 w-5 object-contain" />
        </Link>
      </div>
      <div className="border-t border-terminal-border/60 px-3 py-1">
        <div className="flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-[0.12em]">
          {collapsedBreadcrumbs.map((crumb, index) => {
            const isCurrent = index === collapsedBreadcrumbs.length - 1;
            const isEllipsis = crumb.label === "...";
            return (
              <span key={`${crumb.path}:${index}`} className="inline-flex min-w-0 items-center gap-1 break-words">
                {isEllipsis ? (
                  <span className="text-terminal-muted/80">{crumb.label}</span>
                ) : isCurrent ? (
                  <span className="text-terminal-text">{crumb.label}</span>
                ) : (
                  <button
                    type="button"
                    className="text-terminal-muted hover:text-terminal-text"
                    onClick={() => navigate(crumb.path)}
                  >
                    {crumb.label}
                  </button>
                )}
                {!isCurrent ? <span className="text-terminal-muted/60">&gt;</span> : null}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
