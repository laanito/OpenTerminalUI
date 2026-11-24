import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchDepth,
  fetchPaperOrders,
  fetchPaperPortfolios,
  fetchPaperPositions,
  placePaperOrder,
} from "../../api/client";
import type { PaperOrder, PaperPosition } from "../../types";
import { useQuotesStore } from "../../realtime/useQuotesStream";
import { useSettingsStore } from "../../store/settingsStore";
import { useStockStore } from "../../store/stockStore";

import { readPaperScope, writePaperScope } from "../../lib/paperScope";

type FlashState = "buy" | "sell" | null;
type OrderMode = "market" | "limit";

function formatPrice(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "--";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSignedPrice(value: number | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  return `${numeric >= 0 ? "+" : ""}${formatPrice(numeric)}`;
}

function formatSignedPct(value: number | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function formatCompact(value: number | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(numeric);
}

function emitToast(message: string, variant: "info" | "success" | "warning" | "danger" = "info") {
  window.dispatchEvent(
    new CustomEvent("ot:alert-toast", {
      detail: {
        title: "Paper Trading",
        message,
        variant,
        ttlMs: 3000,
      },
    }),
  );
}

function resolveQuoteToken(market: string, symbol: string) {
  return `${market.trim().toUpperCase()}:${symbol.trim().toUpperCase()}`;
}

export function HotKeyPanel({
  className = "",
  autoFocus = false,
  embedded = false,
  portfolioId,
  onPendingChange,
  disabled = false,
}: {
  className?: string;
  autoFocus?: boolean;
  embedded?: boolean;
  portfolioId?: string;
  onPendingChange?: (pending: boolean) => void;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const selectedMarket = useSettingsStore((state) => state.selectedMarket);
  const ticker = useStockStore((state) => state.ticker);
  const stock = useStockStore((state) => state.stock);
  const tick = useQuotesStore((state) => state.ticksByToken[resolveQuoteToken(selectedMarket, ticker || "AAPL")]);
  const [localPortfolioId, setSelectedPortfolioId] = useState<string>(readPaperScope);
  const selectedPortfolioId = portfolioId ?? localPortfolioId;
  const inFlight = useRef(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [focused, setFocused] = useState(autoFocus);
  const [quantity, setQuantity] = useState(1);
  const [orderMode, setOrderMode] = useState<OrderMode>("market");
  const [limitPrice, setLimitPrice] = useState(0);
  const [flash, setFlash] = useState<FlashState>(null);

  const activeTicker = (ticker || "AAPL").toUpperCase();

  const portfoliosQuery = useQuery({
    queryKey: ["paper", "portfolios"],
    queryFn: fetchPaperPortfolios,
    refetchInterval: 60_000,
  });

  const positionsQuery = useQuery({
    queryKey: ["paper", "positions", selectedPortfolioId],
    queryFn: () => fetchPaperPositions(selectedPortfolioId),
    enabled: Boolean(selectedPortfolioId),
    refetchInterval: 15_000,
  });

  const ordersQuery = useQuery({
    queryKey: ["paper", "orders", selectedPortfolioId],
    queryFn: () => fetchPaperOrders(selectedPortfolioId),
    enabled: Boolean(selectedPortfolioId),
    refetchInterval: 10_000,
  });

  const depthQuery = useQuery({
    queryKey: ["hotkey-panel", "depth", selectedMarket, activeTicker],
    queryFn: () => fetchDepth(activeTicker, selectedMarket, 5),
    staleTime: 1_000,
    refetchInterval: 3_000,
  });

  useEffect(() => {
    if (portfolioId !== undefined || !portfoliosQuery.data?.length) return;
    if (selectedPortfolioId && portfoliosQuery.data.some((row) => row.id === selectedPortfolioId)) return;
    const next = portfoliosQuery.data[0].id;
    setSelectedPortfolioId(next);
    writePaperScope(next);
  }, [portfoliosQuery.data, selectedPortfolioId, portfolioId]);

  useEffect(() => {
    if (!autoFocus) return;
    panelRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const fallback = Number(tick?.ltp ?? stock?.current_price ?? depthQuery.data?.last_price ?? 0);
    if (!Number.isFinite(fallback) || fallback <= 0) return;
    setLimitPrice((prev) => (prev > 0 ? prev : fallback));
  }, [depthQuery.data?.last_price, stock?.current_price, tick?.ltp]);

  useEffect(
    () => () => {
      if (flashTimerRef.current != null) {
        window.clearTimeout(flashTimerRef.current);
      }
    },
    [],
  );

  const selectedPortfolio = useMemo(
    () => portfoliosQuery.data?.find((row) => row.id === selectedPortfolioId) ?? null,
    [portfoliosQuery.data, selectedPortfolioId, portfolioId],
  );

  const activePosition = useMemo<PaperPosition | null>(() => {
    const normalized = `${selectedMarket}:${activeTicker}`;
    return (
      positionsQuery.data?.find((row) => String(row.symbol || "").toUpperCase() === normalized)
      ?? positionsQuery.data?.find((row) => String(row.symbol || "").toUpperCase().endsWith(`:${activeTicker}`))
      ?? null
    );
  }, [activeTicker, positionsQuery.data, selectedMarket]);

  const recentOrders = useMemo<PaperOrder[]>(
    () => (ordersQuery.data ?? []).filter((row) => String(row.symbol || "").toUpperCase().endsWith(`:${activeTicker}`)).slice(0, 5),
    [activeTicker, ordersQuery.data],
  );

  const lastPrice = Number(tick?.ltp ?? stock?.current_price ?? depthQuery.data?.last_price ?? activePosition?.mark_price ?? 0);
  const changePct = Number(tick?.change_pct ?? stock?.change_pct ?? 0);
  const previousClose = changePct !== -100 && lastPrice > 0 ? lastPrice / (1 + changePct / 100) : 0;
  const change = lastPrice > 0 ? lastPrice - previousClose : 0;
  const bestBid = Number(depthQuery.data?.bids?.[0]?.price ?? (lastPrice > 0 ? lastPrice - Math.max(0.01, lastPrice * 0.0005) : 0));
  const bestAsk = Number(depthQuery.data?.asks?.[0]?.price ?? (lastPrice > 0 ? lastPrice + Math.max(0.01, lastPrice * 0.0005) : 0));
  const maxQty = useMemo(() => {
    const cash = Number(selectedPortfolio?.current_cash ?? 0);
    const basis = orderMode === "limit" && limitPrice > 0 ? limitPrice : lastPrice;
    if (!Number.isFinite(cash) || !Number.isFinite(basis) || basis <= 0) return 0;
    return Math.max(0, Math.floor(cash / basis));
  }, [lastPrice, limitPrice, orderMode, selectedPortfolio?.current_cash]);

  const submitOrder = useMutation({
    mutationFn: async (payload: {
      portfolioId: string;
      symbol: string;
      ticker: string;
      side: "buy" | "sell";
      mode: OrderMode;
      quantity: number;
      limitPrice?: number;
    }) => {
      if (!payload.portfolioId) throw new Error("Select a paper portfolio first.");
      if (!payload.quantity || payload.quantity <= 0) throw new Error("Quantity must be greater than zero.");
      return placePaperOrder({
        portfolio_id: payload.portfolioId,
        symbol: payload.symbol,
        side: payload.side,
        order_type: payload.mode,
        quantity: payload.quantity,
        limit_price: payload.mode === "limit" ? payload.limitPrice : undefined,
      });
    },
    onSuccess: (result, variables) => {
      const keys = ["orders", "positions", "trades", "performance"].map(kind => ["paper", kind, variables.portfolioId]);
      keys.push(["paper", "portfolios"]);
      void Promise.allSettled(keys.map(queryKey => queryClient.cancelQueries({ queryKey }))).then(() => { for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey }); });
      setFlash(variables.side);
      if (flashTimerRef.current != null) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => setFlash(null), 450);
      const text = `Paper ${variables.side} order received · ${result.status} · ${variables.quantity} ${variables.ticker}.`;
      setFeedback({ error: false, text }); emitToast(text, "success");
    },
    onError: () => {
      const text = "Could not confirm the paper order. Draft kept; refresh Orders before retrying manually.";
      setFeedback({ error: true, text }); emitToast(text, "danger");
    },
    onSettled: () => { inFlight.current = false; onPendingChange?.(false); },
    retry: false,
  });
  const blocked = disabled || submitOrder.isPending;
  function executeOrder(payload: { side: "buy" | "sell"; mode: OrderMode; quantity: number; limitPrice?: number }) {
    if (inFlight.current || disabled) return;
    inFlight.current = true; onPendingChange?.(true); setFeedback(null);
    submitOrder.mutate({ ...payload, portfolioId: selectedPortfolioId, symbol: `${selectedMarket}:${activeTicker}`, ticker: activeTicker });
  }

  const handleSubmit = (side: "buy" | "sell", mode = orderMode) => {
    executeOrder({
      side,
      mode,
      quantity,
      limitPrice: mode === "limit" ? limitPrice || lastPrice : undefined,
    });
  };

  const handleFlatten = () => {
    if (positionsQuery.isPending || positionsQuery.isError) { emitToast("Position could not be verified. Refresh before flattening.", "warning"); return; }
    if (!activePosition || Math.abs(Number(activePosition.quantity || 0)) <= 0) {
      emitToast("No open position to flatten.", "warning");
      return;
    }
    const positionQty = Math.abs(Number(activePosition.quantity));
    const side = Number(activePosition.quantity) > 0 ? "sell" : "buy";
    executeOrder({
      side,
      mode: "market",
      quantity: positionQty,
    });
  };

  const handleReverse = () => {
    const qty = Math.abs(Number(activePosition?.quantity || 0));
    if (!qty) {
      emitToast("No position to reverse.", "warning");
      return;
    }
    emitToast("Paper engine is currently long-only. Reverse will flatten only.", "warning");
    handleFlatten();
  };

  const handleCancelDraft = () => {
    setOrderMode("market");
    setLimitPrice(lastPrice > 0 ? lastPrice : 0);
    emitToast("Pending-order cancel is not available in the current paper API. Draft cleared instead.", "warning");
  };

  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!focused || blocked || event.repeat && /^[bsfr]$/i.test(event.key)) return;
      const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      const inEditable = tag === "input" || tag === "textarea" || tag === "select";
      if (inEditable || (event.target as HTMLElement | null)?.isContentEditable) return;
      if (event.key === "Escape") {
        event.preventDefault();
        handleCancelDraft();
        return;
      }
      if (event.shiftKey && (event.key === "B" || event.key === "S")) {
        event.preventDefault();
        handleSubmit(event.key === "B" ? "buy" : "sell", "limit");
        return;
      }
      switch (event.key) {
        case "b":
        case "B":
          event.preventDefault();
          handleSubmit("buy", "market");
          break;
        case "s":
        case "S":
          event.preventDefault();
          handleSubmit("sell", "market");
          break;
        case "f":
        case "F":
          event.preventDefault();
          handleFlatten();
          break;
        case "r":
        case "R":
          event.preventDefault();
          handleReverse();
          break;
        case "+":
        case "=":
          event.preventDefault();
          setQuantity((prev) => Math.max(1, prev + 1));
          break;
        case "-":
          event.preventDefault();
          setQuantity((prev) => Math.max(1, prev - 1));
          break;
        default:
          break;
      }
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [focused, blocked, handleFlatten, handleReverse, lastPrice, limitPrice, orderMode, quantity]);

  const flashClass =
    flash === "buy"
      ? "border-emerald-400 shadow-[0_0_0_1px_rgba(16,185,129,0.6),0_0_26px_rgba(16,185,129,0.22)]"
      : flash === "sell"
        ? "border-red-400 shadow-[0_0_0_1px_rgba(248,113,113,0.65),0_0_26px_rgba(248,113,113,0.22)]"
        : focused
          ? "border-terminal-accent shadow-[0_0_0_1px_rgba(var(--terminal-accent-rgb,74_222_128),0.55),0_0_28px_rgba(56,189,248,0.14)]"
          : "border-terminal-border";

  return (
    <div
      ref={panelRef}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (panelRef.current?.contains(event.relatedTarget as Node | null)) return;
        setFocused(false);
      }}
      onMouseDown={event => {
        setFocused(true);
        if (!(event.target as HTMLElement).closest("input, select, textarea, button, a, label")) panelRef.current?.focus();
      }}
      className={`min-w-0 rounded-sm border bg-terminal-panel p-3 outline-none transition-colors [overflow-wrap:anywhere] ${flashClass} ${className}`.trim()}
      role="region" aria-label="Paper hotkey trading"
      data-testid="hotkey-panel"
    >
      {feedback ? <p role={feedback.error ? "alert" : "status"} className="mb-3 text-sm text-terminal-muted">{feedback.text}</p> : null}
      {portfoliosQuery.isError || positionsQuery.isError || ordersQuery.isError ? <p role="alert" className="mb-3 text-sm text-terminal-muted">Some hotkey account data could not be refreshed. Previously displayed values are unrefreshed; check activity before retrying an order.</p> : null}
      <fieldset disabled={blocked} className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase text-terminal-muted">Hot Key Trading</div>
          <div className="mt-1 flex items-center gap-2">
            <div className="text-2xl font-semibold text-terminal-text" data-testid="hotkey-symbol">{activeTicker}</div>
            <span className="rounded-sm border border-amber-500/70 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold uppercase text-amber-300">
              Paper
            </span>
            {focused ? <span className="text-xs uppercase text-terminal-accent">Focused</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-terminal-muted">
            <span aria-label="Hotkey last price" className="font-mono text-terminal-text">{lastPrice > 0 ? formatPrice(lastPrice) : "Unavailable"}</span>
            <span className={change >= 0 ? "text-emerald-300" : "text-red-300"}>{lastPrice > 0 ? `${formatSignedPrice(change)} (${formatSignedPct(changePct)})` : "Change unavailable"}</span>
            <span>{Number(depthQuery.data?.bids?.[0]?.price) > 0 ? "Bid" : "Estimated bid"}: {bestBid > 0 ? formatPrice(bestBid) : "Unavailable"}</span>
            <span>{Number(depthQuery.data?.asks?.[0]?.price) > 0 ? "Ask" : "Estimated ask"}: {bestAsk > 0 ? formatPrice(bestAsk) : "Unavailable"}</span>
          </div>
        </div>
        <div className="min-w-0 w-full space-y-1 sm:w-auto sm:max-w-[60%]">
          <div className="text-xs uppercase text-terminal-muted">Portfolio</div>
          {portfolioId !== undefined ? <p className="text-sm">{selectedPortfolio?.name || "Selected account unavailable"}</p> : <select
            aria-label="Hotkey paper portfolio"
            value={selectedPortfolioId}
            onChange={(event) => {
              setSelectedPortfolioId(event.target.value);
              writePaperScope(event.target.value);
            }}
            className="mt-1 w-full rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text outline-none"
          >
            <option value="">{portfoliosQuery.data?.length ? "Select" : "No portfolio"}</option>
            {portfoliosQuery.data?.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>}
          {!selectedPortfolio && !portfoliosQuery.isLoading ? (
            <div className="mt-1 text-xs text-terminal-muted">Create a paper portfolio on the Paper Trading page.</div>
          ) : null}
        </div>
      </div>

      {activePosition ? (
        <div className="mt-3 grid gap-2 rounded-sm border border-terminal-border bg-terminal-bg/60 p-2 text-xs grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
          <div>
            <div className="text-xs uppercase text-terminal-muted">Position</div>
            <div className={`mt-1 font-mono ${activePosition.quantity >= 0 ? "text-emerald-300" : "text-red-300"}`}>
              {activePosition.quantity >= 0 ? "+" : ""}{activePosition.quantity} {activePosition.quantity >= 0 ? "LONG" : "SHORT"}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-terminal-muted">Avg Entry</div>
            <div className="mt-1 font-mono text-terminal-text">{formatPrice(activePosition.avg_entry_price)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-terminal-muted">Unrealized</div>
            <div className={`mt-1 font-mono ${activePosition.unrealized_pnl >= 0 ? "text-emerald-300" : "text-red-300"}`}>
              {formatSignedPrice(activePosition.unrealized_pnl)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-terminal-muted">Market Value</div>
            <div className="mt-1 font-mono text-terminal-text">{formatPrice(activePosition.quantity * activePosition.mark_price)}</div>
          </div>
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        <div className="flex min-w-0 flex-wrap gap-3">
          <div className="min-w-0 flex-1 basis-56 space-y-2">
            <div className="text-xs uppercase text-terminal-muted">Quantity (asset units)</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQuantity((prev) => Math.max(1, prev - 1))}
                className="rounded-sm border border-terminal-border px-2 py-1 text-terminal-muted hover:text-terminal-text"
              >
                -
              </button>
              <input
                value={quantity}
                onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
                type="number"
                min={1}
                className="w-24 rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-terminal-text outline-none"
                aria-label="Quantity"
              />
              <button
                type="button"
                onClick={() => setQuantity((prev) => prev + 1)}
                className="rounded-sm border border-terminal-border px-2 py-1 text-terminal-muted hover:text-terminal-text"
              >
                +
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                { label: "1x", value: 1 },
                { label: "5x", value: 5 },
                { label: "10x", value: 10 },
                { label: "25x", value: 25 },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setQuantity(item.value)}
                  className="rounded-sm border border-terminal-border px-2 py-1 text-xs text-terminal-muted hover:text-terminal-text"
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setQuantity(Math.max(1, maxQty))}
                className="rounded-sm border border-terminal-border px-2 py-1 text-xs text-terminal-muted hover:text-terminal-text"
              >
                Max
              </button>
            </div>
          </div>
          <div className="min-w-0 flex-1 basis-56 space-y-2">
            <div className="text-xs uppercase text-terminal-muted">Order Type</div>
            <div className="flex items-center gap-1">
              {(["market", "limit"] as OrderMode[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setOrderMode(item)}
                  className={`rounded-sm border px-3 py-1 text-xs uppercase ${
                    orderMode === item
                      ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                      : "border-terminal-border text-terminal-muted hover:text-terminal-text"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            {orderMode === "limit" ? (
              <label className="block space-y-1"><span className="block text-xs text-terminal-muted">Limit price (quote units)</span><input
                value={limitPrice}
                onChange={(event) => setLimitPrice(Number(event.target.value) || 0)}
                type="number"
                step="0.05"
                className="w-full rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-terminal-text outline-none"
                aria-label="Limit Price"
              /></label>
            ) : null}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={!selectedPortfolioId || submitOrder.isPending}
            onClick={() => handleSubmit("buy", orderMode)}
            className="rounded-sm border border-emerald-500/60 bg-emerald-500/12 px-3 py-2 text-sm font-semibold text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            BUY ({orderMode === "market" ? "B" : "SHIFT+B"})
          </button>
          <button
            type="button"
            disabled={!selectedPortfolioId || submitOrder.isPending}
            onClick={() => handleSubmit("sell", orderMode)}
            className="rounded-sm border border-red-500/60 bg-red-500/12 px-3 py-2 text-sm font-semibold text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            SELL ({orderMode === "market" ? "S" : "SHIFT+S"})
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={handleFlatten}
            className="rounded-sm border border-terminal-border px-3 py-2 text-xs uppercase text-terminal-muted hover:text-terminal-text"
          >
            Flatten (F)
          </button>
          <button
            type="button"
            onClick={handleReverse}
            className="rounded-sm border border-terminal-border px-3 py-2 text-xs uppercase text-terminal-muted hover:text-terminal-text"
          >
            Reverse (R)
          </button>
          <button
            type="button"
            onClick={handleCancelDraft}
            className="rounded-sm border border-terminal-border px-3 py-2 text-xs uppercase text-terminal-muted hover:text-terminal-text"
          >
            Clear Draft (Esc)
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-sm border border-terminal-border bg-terminal-bg/50 p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs uppercase text-terminal-muted">Recent Orders</div>
          {embedded ? <div className="text-xs text-terminal-muted">Embedded on Paper Trading</div> : null}
        </div>
        <div className="mt-2 space-y-1 text-xs">
          {recentOrders.length ? (
            recentOrders.map((row) => (
              <div key={row.id} className="grid min-w-0 grid-cols-2 sm:grid-cols-4 gap-2 rounded-sm border border-terminal-border px-2 py-1">
                <div className="font-mono text-terminal-muted">{row.fill_time ? new Date(row.fill_time).toLocaleTimeString() : "--:--:--"}</div>
                <div className={`${row.side === "buy" ? "text-emerald-300" : "text-red-300"}`}>
                  {row.side.toUpperCase()} {row.quantity}
                </div>
                <div className="text-right font-mono text-terminal-text">{formatPrice(row.fill_price ?? row.limit_price)}</div>
                <div className="text-right uppercase text-terminal-muted">{row.status}</div>
              </div>
            ))
          ) : (
            <div className="rounded-sm border border-dashed border-terminal-border px-2 py-3 text-center text-terminal-muted">
              No recent orders for {activeTicker}.
            </div>
          )}
        </div>
      </div>
      </fieldset>
    </div>
  );
}
