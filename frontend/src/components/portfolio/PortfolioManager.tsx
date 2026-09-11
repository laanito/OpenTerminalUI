import { useEffect, useMemo, useRef, useState } from "react";
import { Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import {
  addPortfolioHolding,
  addPortfolioTransaction,
  createPortfolio,
  deletePortfolioById,
  fetchPortfolioAnalyticsV2,
  fetchPortfolioHoldings,
  fetchPortfolioTransactions,
  fetchPortfolios,
  fetchPortfolioRiskMetrics,
  fetchPortfolioCorrelation,
  fetchPortfolioDividends,
  fetchPortfolioBenchmarkOverlay,
  fetchAiRiskInsights,
  updatePortfolioById,
  type MultiPortfolio,
  type MultiPortfolioAnalytics,
  type MultiPortfolioHolding,
  type MultiPortfolioTransaction,
  type PortfolioTransactionType,
} from "../../api/client";
import type {
  PortfolioRiskMetrics,
  PortfolioCorrelationResponse,
  PortfolioDividendTracker,
  PortfolioBenchmarkOverlay,
} from "../../types";
import { DenseTable } from "../terminal/DenseTable";
import { NotesPanel } from "../notes/NotesPanel";
import { PortfolioEventsCalendar } from "../PortfolioEventsCalendar";
import { RiskMetricsPanel } from "./RiskMetricsPanel";
import { CorrelationHeatmap } from "./CorrelationHeatmap";
import { DividendTracker } from "./DividendTracker";
import { BenchmarkOverlayChart } from "./BenchmarkOverlayChart";
import { BacktestResults } from "./BacktestResults";
import { AttributionPanel } from "./AttributionPanel";
import { AiInsightCard } from "../terminal/AiInsightCard";
import { ExportButton } from "../common/ExportButton";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { useDisplayCurrency } from "../../hooks/useDisplayCurrency";
import { useSettingsStore } from "../../store/settingsStore";
import { asCurrencyCode, type CurrencyCode } from "../../lib/currency";
import { TX_TYPES, TX_NEEDS_SYMBOL, TX_NEEDS_SHARES, cashDeltaPreview } from "../../utils/portfolioCash";
import {
  CSV_SYMBOL_COLUMNS,
  CSV_SHARES_COLUMNS,
  CSV_COST_COLUMNS,
  CSV_DATE_COLUMNS,
  CSV_CURRENCY_COLUMNS,
} from "../../utils/portfolioMigration";

const BENCHMARKS = ["S&P500", "NASDAQ", "DOW", "MSCIWI", "NIFTY50"];

const CURRENCY_CODES: readonly CurrencyCode[] = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "INR", "HKD", "SEK", "DKK", "NOK"];

// UI selectors use the currencies with known formatting metadata. Older or
// malformed portfolio values fall back to USD until a user selects a valid base.
function toCurrencyCode(code: string | undefined | null): CurrencyCode {
  const up = (code || "USD").toUpperCase();
  return (CURRENCY_CODES as readonly string[]).includes(up) ? (up as CurrencyCode) : "USD";
}

function metricFmt(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "-";
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function PortfolioManager() {
  const { formatMoney, formatCompactMoney, nativeForInstrument } = useDisplayCurrency();
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  // Each holding's price is in its instrument's native currency; convert to the
  // active display currency (and show the right symbol) instead of rendering
  // bare numbers. Suffixed symbols (e.g. .DE -> EUR) resolve precisely; bare
  // symbols fall back to the selected market's currency.
  const currencyFor = (holding: Pick<MultiPortfolioHolding, "symbol" | "currency">) =>
    nativeForInstrument(holding.currency, holding.symbol, selectedMarket);
  const [portfolios, setPortfolios] = useState<MultiPortfolio[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [holdings, setHoldings] = useState<MultiPortfolioHolding[]>([]);
  const [notesSymbol, setNotesSymbol] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<MultiPortfolioAnalytics | null>(null);
  const [riskMetrics, setRiskMetrics] = useState<PortfolioRiskMetrics | null>(null);
  const [correlation, setCorrelation] = useState<PortfolioCorrelationResponse | null>(null);
  const [dividends, setDividends] = useState<PortfolioDividendTracker | null>(null);
  const [benchmarkOverlay, setBenchmarkOverlay] = useState<PortfolioBenchmarkOverlay | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [newName, setNewName] = useState("Core Portfolio");
  const [newDescription, setNewDescription] = useState("");
  const [newBenchmark, setNewBenchmark] = useState(BENCHMARKS[0]);
  const [newCurrency, setNewCurrency] = useState<CurrencyCode>("USD");
  const [newCash, setNewCash] = useState(100000);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBenchmark, setEditBenchmark] = useState(BENCHMARKS[0]);
  const [editCurrency, setEditCurrency] = useState<CurrencyCode>("USD");

  const [addSymbol, setAddSymbol] = useState("AAPL");
  const [addShares, setAddShares] = useState(10);
  const [addCost, setAddCost] = useState(100);
  const [addCurrency, setAddCurrency] = useState<CurrencyCode>("USD");
  const [addDate, setAddDate] = useState(new Date().toISOString().slice(0, 10));

  const [transactions, setTransactions] = useState<MultiPortfolioTransaction[]>([]);
  const [txType, setTxType] = useState<PortfolioTransactionType>("buy");
  const [txSymbol, setTxSymbol] = useState("AAPL");
  const [txShares, setTxShares] = useState(10);
  const [txPrice, setTxPrice] = useState(100);
  const [txCurrency, setTxCurrency] = useState<CurrencyCode>("USD");
  const [txFees, setTxFees] = useState(0);
  const [txFeesCurrency, setTxFeesCurrency] = useState<CurrencyCode>("USD");
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [txNotes, setTxNotes] = useState("");
  const txFormRef = useRef<HTMLDivElement>(null);

  const loadAll = async (nextId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const pfs = await fetchPortfolios();
      setPortfolios(pfs);
      const activeId = nextId || selectedId || pfs[0]?.id || "";
      if (activeId) {
        setSelectedId(activeId);
        const [h, a, t] = await Promise.all([
          fetchPortfolioHoldings(activeId),
          fetchPortfolioAnalyticsV2(activeId),
          fetchPortfolioTransactions(activeId),
        ]);
        setHoldings(h);
        setAnalytics(a);
        setTransactions(t);
        const selected = pfs.find((p) => p.id === activeId);
        if (selected) {
          setEditName(selected.name || "");
          setEditDescription(selected.description || "");
          setEditBenchmark(selected.benchmark_symbol || BENCHMARKS[0]);
          const baseCurrency = toCurrencyCode(selected.currency);
          setEditCurrency(baseCurrency);
          setAddCurrency(baseCurrency);
          setTxCurrency(baseCurrency);
          setTxFeesCurrency(baseCurrency);
        }
        // Deep analytics hit market data and are slower; load them in the
        // background (scoped to the selected portfolio) so the core view renders
        // immediately. Each panel handles its own null/empty state.
        const bench = selected?.benchmark_symbol || "S&P500";
        setRiskMetrics(null);
        setCorrelation(null);
        setDividends(null);
        setBenchmarkOverlay(null);
        void fetchPortfolioRiskMetrics({ benchmark: bench, risk_free_rate: 0.04 }, activeId).then(setRiskMetrics).catch(() => setRiskMetrics(null));
        void fetchPortfolioCorrelation({ window: 60 }, activeId).then(setCorrelation).catch(() => setCorrelation(null));
        void fetchPortfolioDividends({ days: 180 }, activeId).then(setDividends).catch(() => setDividends(null));
        void fetchPortfolioBenchmarkOverlay({ benchmark: bench }, activeId).then(setBenchmarkOverlay).catch(() => setBenchmarkOverlay(null));
      } else {
        setHoldings([]);
        setAnalytics(null);
        setTransactions([]);
        setRiskMetrics(null);
        setCorrelation(null);
        setDividends(null);
        setBenchmarkOverlay(null);
        setEditName("");
        setEditDescription("");
        setEditBenchmark(BENCHMARKS[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load portfolios");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPortfolio = useMemo(() => portfolios.find((p) => p.id === selectedId) || null, [portfolios, selectedId]);
  const cashCurrency = toCurrencyCode(analytics?.accounting?.base_currency || selectedPortfolio?.currency);
  const accountingHoldings = useMemo(
    () => new Map((analytics?.accounting?.holdings || []).map((row) => [row.id, row])),
    [analytics],
  );
  const accountingTransactions = useMemo(
    () => new Map((analytics?.accounting?.transactions || []).map((row) => [row.id, row])),
    [analytics],
  );
  const perfSeries = useMemo(() => {
    if (!holdings.length || holdings.some((holding) => {
      const evidence = accountingHoldings.get(holding.id);
      return evidence?.cost_basis_base == null || evidence.market_value_base == null;
    })) return [];
    let cumulative = 100;
    return holdings.map((h, idx) => {
      const evidence = accountingHoldings.get(h.id)!;
      const cost = Number(evidence.cost_basis_base || 0);
      const ret = cost > 0 ? Number(evidence.unrealized_pnl_base || 0) / cost : 0;
      cumulative *= 1 + ret / Math.max(1, holdings.length);
      return { i: idx + 1, value: cumulative };
    });
  }, [accountingHoldings, holdings]);

  const formatBaseAggregate = (value: number | null | undefined) => {
    if (value === undefined) return "-";
    if (!analytics?.accounting) return "Needs accounting";
    return value === null ? "Needs FX" : formatMoney(value, cashCurrency);
  };
  const formatLedgerAmount = (value: number | null | undefined, currency?: string | null) => {
    const knownCurrency = asCurrencyCode(currency);
    if (knownCurrency) return formatMoney(value, knownCurrency);
    return `${metricFmt(value)} (${currency?.toUpperCase() || "currency unknown"})`;
  };
  const portfolioSymbols = useMemo(() => Array.from(new Set(holdings.map((h) => h.symbol).filter(Boolean))), [holdings]);
  const txCurrenciesCompatible = txFees <= 0 || txCurrency === txFeesCurrency;
  const txPreview = cashDeltaPreview(txType, txShares, txPrice, txCurrenciesCompatible ? txFees : 0);

  // Pre-fill the Record Transaction form to sell a specific position (full size
  // at the current price by default; user can adjust before recording). Turns a
  // generic "record a sale" into a sale attributed to the row you clicked.
  const sellFromPosition = (row: MultiPortfolioHolding) => {
    setTxType("sell");
    setTxSymbol(row.symbol);
    setTxShares(row.shares);
    setTxPrice(Number(row.current_price || row.cost_basis_per_share || 0));
    const rowCurrency = toCurrencyCode(row.currency || row.cost_basis_currency);
    setTxCurrency(rowCurrency);
    setTxFeesCurrency(rowCurrency);
    setError(null);
    setStatus(`Selling ${row.symbol} — review shares/price, then Record`);
    requestAnimationFrame(() => txFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const handleRecordTransaction = async () => {
    if (!selectedId) return;
    setStatus(null);
    setError(null);
    const needsSymbol = TX_NEEDS_SYMBOL[txType];
    const needsShares = TX_NEEDS_SHARES[txType];
    const symbol = txSymbol.trim().toUpperCase();
    if (needsSymbol && !symbol) {
      setError(`${txType} needs a symbol`);
      return;
    }
    if (needsShares && (!Number.isFinite(txShares) || txShares <= 0)) {
      setError(`${txType} needs a positive share count`);
      return;
    }
    if (!Number.isFinite(txPrice) || txPrice <= 0) {
      setError(needsShares ? "Price must be positive" : "Amount must be positive");
      return;
    }
    try {
      await addPortfolioTransaction(selectedId, {
        type: txType,
        symbol: needsSymbol ? symbol : undefined,
        shares: needsShares ? txShares : 0,
        price: txPrice,
        currency: txCurrency,
        fees: txFees,
        fees_currency: txFeesCurrency,
        date: txDate,
        notes: txNotes.trim() || undefined,
      });
      setStatus(`Recorded ${txType}${needsSymbol ? ` ${symbol}` : ""}`);
      setTxNotes("");
      await loadAll(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record transaction");
    }
  };

  const handleImportCsv = async (file: File | null) => {
    if (!file || !selectedId) return;
    setStatus(null);
    setError(null);
    try {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length < 2) {
        setError("CSV must include header + at least one row");
        return;
      }
      const headers = lines[0].split(",").map((x) => x.trim().toLowerCase());
      const findIdx = (names: string[]) => headers.findIndex((h) => names.includes(h));
      const symbolIdx = findIdx(CSV_SYMBOL_COLUMNS);
      const sharesIdx = findIdx(CSV_SHARES_COLUMNS);
      const costIdx = findIdx(CSV_COST_COLUMNS);
      const dateIdx = findIdx(CSV_DATE_COLUMNS);
      const currencyIdx = findIdx(CSV_CURRENCY_COLUMNS);
      if (symbolIdx < 0 || sharesIdx < 0 || costIdx < 0) {
        setError("CSV header requires symbol, shares, and cost columns");
        return;
      }
      let imported = 0;
      for (const raw of lines.slice(1)) {
        const cols = raw.split(",").map((x) => x.trim());
        const symbol = String(cols[symbolIdx] || "").toUpperCase();
        const shares = Number(cols[sharesIdx] || 0);
        const cost = Number(cols[costIdx] || 0);
        const purchaseDate = dateIdx >= 0 && cols[dateIdx] ? cols[dateIdx] : new Date().toISOString().slice(0, 10);
        const currency = currencyIdx >= 0 && cols[currencyIdx]
          ? String(cols[currencyIdx]).trim().toUpperCase()
          : addCurrency;
        if (!symbol || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(cost) || cost <= 0) continue;
        // Sequential imports preserve deterministic API load and easier failure reporting.
        await addPortfolioHolding(selectedId, {
          symbol,
          shares,
          cost_basis_per_share: cost,
          currency,
          purchase_date: purchaseDate,
        });
        imported += 1;
      }
      setStatus(imported > 0 ? `Imported ${imported} holdings` : "No valid rows imported");
      await loadAll(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import CSV");
    }
  };

  return (
    <div className="grid gap-3 xl:grid-cols-[240px_1fr]">
      <aside className="rounded border border-terminal-border bg-terminal-panel p-2">
        <div className="mb-2 text-xs font-semibold text-terminal-accent">Portfolios</div>
        <div className="space-y-1">
          {portfolios.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`w-full rounded border px-2 py-1 text-left text-xs ${selectedId === p.id ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent" : "border-terminal-border text-terminal-text"}`}
              onClick={() => void loadAll(p.id)}
            >
              <div>{p.name}</div>
              <div className="text-[10px] text-terminal-muted">{metricFmt(p.total_value)}</div>
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-1 border-t border-terminal-border pt-2">
          <TerminalInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Portfolio name" />
          <TerminalInput
            as="textarea"
            rows={3}
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Portfolio thesis"
            aria-label="New portfolio thesis"
          />
          <select className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={newBenchmark} onChange={(e) => setNewBenchmark(e.target.value)}>
            {BENCHMARKS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <TerminalInput as="select" value={newCurrency} onChange={(e) => setNewCurrency(e.target.value as CurrencyCode)} aria-label="Portfolio base currency">
            {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code} base currency</option>)}
          </TerminalInput>
          <TerminalInput type="number" value={newCash} onChange={(e) => setNewCash(Number(e.target.value) || 0)} placeholder="Starting cash" />
          <TerminalButton
            variant="accent"
            onClick={async () => {
              try {
                setError(null);
                const created = await createPortfolio({
                  name: newName,
                  description: newDescription.trim(),
                  benchmark_symbol: newBenchmark,
                  currency: newCurrency,
                  starting_cash: newCash,
                });
                setStatus(`Created ${created.name}`);
                setNewDescription("");
                await loadAll(created.id);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to create portfolio");
              }
            }}
          >
            Add Portfolio
          </TerminalButton>
        </div>
      </aside>

      <section className="space-y-2">
        {analytics && analytics.accounting?.status !== "complete" ? (
          <div className="rounded border border-terminal-warn/50 bg-terminal-warn/10 px-3 py-2 text-xs text-terminal-warn">
            Accounting is {analytics.accounting?.status || "unavailable"}: {analytics.accounting?.issues[0]?.message || analytics.accounting?.degraded_reasons[0] || "the backend accounting contract is unavailable"}. Affected totals remain unavailable; available values are accounted in {cashCurrency} before optional display conversion.
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="rounded border border-terminal-border bg-terminal-panel p-2 text-xs"><div className="text-terminal-muted">Net Liquidation</div><div className="text-terminal-text">{formatBaseAggregate(analytics?.net_liquidation_value)}</div><div className="text-[10px] text-terminal-muted">holdings + cash · base {cashCurrency}</div></div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-2 text-xs"><div className="text-terminal-muted">Cash</div><div className={Number(analytics?.cash_balance ?? 0) >= 0 ? "text-terminal-text" : "text-terminal-neg"}>{formatBaseAggregate(analytics?.cash_balance)}</div><div className="text-[10px] text-terminal-muted">from ledger · base {cashCurrency}</div></div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-2 text-xs"><div className="text-terminal-muted">Holdings Value</div><div className="text-terminal-text">{formatBaseAggregate(analytics?.total_value)}</div></div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-2 text-xs"><div className="text-terminal-muted">Day P&L</div><div className={Number(analytics?.day_change || 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{formatBaseAggregate(analytics?.day_change)}{analytics?.day_change_pct != null ? ` (${metricFmt(analytics.day_change_pct)}%)` : ""}</div></div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-2 text-xs"><div className="text-terminal-muted">Unrealized P&L</div><div className={Number(analytics?.unrealized_pnl || 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{formatBaseAggregate(analytics?.unrealized_pnl)}{analytics?.unrealized_pnl_pct != null ? ` (${metricFmt(analytics.unrealized_pnl_pct)}%)` : ""}</div><div className="text-[10px] text-terminal-muted">open positions · base {cashCurrency}</div></div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-2 text-xs"><div className="text-terminal-muted">Sharpe</div><div className="text-terminal-text">{metricFmt(analytics?.sharpe_ratio)}</div></div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-2 text-xs"><div className="text-terminal-muted">Annualized Return</div><div className="text-terminal-text">{!analytics?.accounting || analytics.annualized_return == null ? "-" : `${metricFmt(analytics.annualized_return)}%`}</div></div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-2 text-xs"><div className="text-terminal-muted">Max Drawdown</div><div className="text-terminal-neg">{metricFmt(analytics?.max_drawdown)}%</div></div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-2 text-xs"><div className="text-terminal-muted">Dividend YTD</div><div className="text-terminal-text">{formatBaseAggregate(analytics?.dividend_income_ytd)}</div></div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-2 text-xs"><div className="text-terminal-muted">Realized P&L</div><div className={Number(analytics?.realized_pnl || 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{formatBaseAggregate(analytics?.realized_pnl)}</div><div className="text-[10px] text-terminal-muted">booked gains · base {cashCurrency}</div></div>
        </div>

        <div className="rounded border border-terminal-border bg-terminal-panel p-2">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-terminal-muted">Manage</span>
            <TerminalInput className="w-40" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" />
            <TerminalInput as="select" className="w-28" value={editBenchmark} onChange={(e) => setEditBenchmark(e.target.value)}>
              {BENCHMARKS.map((x) => <option key={x} value={x}>{x}</option>)}
            </TerminalInput>
            <TerminalInput as="select" className="w-24" value={editCurrency} onChange={(e) => setEditCurrency(e.target.value as CurrencyCode)} aria-label="Accounting base currency">
              {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
            </TerminalInput>
            <TerminalButton
              size="sm"
              variant="default"
              disabled={!selectedPortfolio}
              onClick={async () => {
                if (!selectedPortfolio) return;
                try {
                  setError(null);
                  await updatePortfolioById(selectedPortfolio.id, {
                    name: editName.trim() || selectedPortfolio.name,
                    description: editDescription.trim(),
                    benchmark_symbol: editBenchmark,
                    currency: editCurrency,
                  });
                  setStatus("Portfolio updated");
                  await loadAll(selectedPortfolio.id);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to update portfolio");
                }
              }}
            >
              Save
            </TerminalButton>
            <TerminalButton
              size="sm"
              variant="danger"
              disabled={!selectedPortfolio}
              onClick={async () => {
                if (!selectedPortfolio) return;
                try {
                  setError(null);
                  await deletePortfolioById(selectedPortfolio.id);
                  setStatus("Portfolio deleted");
                  await loadAll();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to delete portfolio");
                }
              }}
            >
              Delete
            </TerminalButton>
            <TerminalButton size="sm" variant="default" onClick={() => void loadAll(selectedId || undefined)}>
              Sync
            </TerminalButton>
          </div>
          <div className="mb-2 grid gap-3 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(34rem,1.2fr)] xl:items-start">
            <label className="block text-xs text-terminal-muted">
              <span className="mb-1 block">Portfolio thesis — indexed by the Second Brain</span>
              <TerminalInput
                as="textarea"
                rows={3}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Record the mandate, assumptions, time horizon, and conditions that would invalidate it."
                disabled={!selectedPortfolio}
                aria-label="Portfolio thesis"
              />
            </label>
            <fieldset className="rounded border border-terminal-border/70 bg-terminal-bg/30 p-2">
              <legend className="px-1 text-xs font-semibold text-terminal-muted">Add holding</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <label className="block text-[11px] text-terminal-muted">
                  <span className="mb-1 block">Symbol</span>
                  <TerminalInput className="w-full" value={addSymbol} onChange={(e) => setAddSymbol(e.target.value.toUpperCase())} placeholder="AAPL" />
                </label>
                <label className="block text-[11px] text-terminal-muted">
                  <span className="mb-1 block">Quantity</span>
                  <TerminalInput className="w-full" type="number" min="0" step="any" value={addShares} onChange={(e) => setAddShares(Number(e.target.value) || 0)} />
                </label>
                <label className="block text-[11px] text-terminal-muted">
                  <span className="mb-1 block">Unit price</span>
                  <TerminalInput className="w-full" type="number" min="0" step="any" value={addCost} onChange={(e) => setAddCost(Number(e.target.value) || 0)} />
                </label>
                <label className="block text-[11px] text-terminal-muted">
                  <span className="mb-1 block">Purchase date</span>
                  <TerminalInput className="w-full" type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} />
                </label>
                <label className="block text-[11px] text-terminal-muted">
                  <span className="mb-1 block">Cost currency</span>
                  <TerminalInput as="select" className="w-full" value={addCurrency} onChange={(e) => setAddCurrency(e.target.value as CurrencyCode)}>
                    {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
                  </TerminalInput>
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <TerminalButton
                  variant="default"
                  onClick={async () => {
                    if (!selectedId) return;
                    try {
                      setError(null);
                      await addPortfolioHolding(selectedId, { symbol: addSymbol, shares: addShares, cost_basis_per_share: addCost, currency: addCurrency, purchase_date: addDate });
                      setStatus(`Added ${addSymbol}`);
                      await loadAll(selectedId);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed to add holding");
                    }
                  }}
                >
                  Add
                </TerminalButton>
                <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent">
                  Import CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      void handleImportCsv(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <ExportButton source="portfolio" data={holdings} disabled={!holdings.length} />
                {loading ? <span className="text-terminal-muted">Loading...</span> : null}
              </div>
            </fieldset>
          </div>
          {error ? <div className="mb-2 rounded-sm border border-terminal-neg bg-terminal-neg/10 px-2 py-1 text-xs text-terminal-neg">{error}</div> : null}
          {status ? <div className="mb-2 rounded-sm border border-terminal-pos/40 bg-terminal-pos/10 px-2 py-1 text-xs text-terminal-pos">{status}</div> : null}
          <DenseTable
            id="portfolio-manager-holdings"
            rows={holdings}
            rowKey={(row) => row.id}
            height={260}
            columns={[
              { key: "symbol", title: "Symbol", type: "text", frozen: true, width: 100, sortable: true, getValue: (r) => r.symbol },
              { key: "shares", title: "Shares", type: "number", align: "right", sortable: true, getValue: (r) => r.shares },
              { key: "avgCost", title: "Avg Cost", type: "currency", align: "right", sortable: true, getValue: (r) => r.cost_basis_per_share, render: (r) => formatLedgerAmount(r.cost_basis_per_share, r.cost_basis_currency) },
              { key: "current", title: "Current", type: "currency", align: "right", sortable: true, getValue: (r) => r.current_price || 0, render: (r) => formatMoney(r.current_price || 0, currencyFor(r)) },
              { key: "value", title: "Market Value", type: "large-number", align: "right", sortable: true, getValue: (r) => (r.current_price || 0) * r.shares, render: (r) => formatCompactMoney((r.current_price || 0) * r.shares, currencyFor(r)) },
              { key: "pnl", title: "P&L", type: "large-number", align: "right", sortable: true, getValue: (r) => accountingHoldings.get(r.id)?.unrealized_pnl_base ?? 0, render: (r) => { const value = accountingHoldings.get(r.id)?.unrealized_pnl_base; return value == null ? "Needs FX" : formatCompactMoney(value, cashCurrency); } },
              { key: "pnlPct", title: "P&L%", type: "percent", align: "right", sortable: true, getValue: (r) => { const evidence = accountingHoldings.get(r.id); return evidence?.unrealized_pnl_base != null && evidence.cost_basis_base ? evidence.unrealized_pnl_base / evidence.cost_basis_base * 100 : 0; }, render: (r) => { const evidence = accountingHoldings.get(r.id); return evidence?.unrealized_pnl_base != null && evidence.cost_basis_base ? `${metricFmt(evidence.unrealized_pnl_base / evidence.cost_basis_base * 100)}%` : "Needs FX"; } },
              {
                key: "actions",
                title: "",
                type: "text",
                align: "right",
                width: 64,
                getValue: () => "",
                render: (r) => (
                  <button
                    type="button"
                    className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                    title={`Sell ${r.symbol} from this position`}
                    onClick={(e) => {
                      e.stopPropagation();
                      sellFromPosition(r);
                    }}
                  >
                    Sell
                  </button>
                ),
              },
            ]}
          />
        </div>

        <div ref={txFormRef} className="rounded border border-terminal-border bg-terminal-panel p-2">
          <div className="mb-2 flex flex-wrap items-end gap-2 text-xs">
            <span className="text-terminal-muted">Record Transaction</span>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-terminal-muted">Type</span>
              <TerminalInput as="select" className="w-28" value={txType} onChange={(e) => setTxType(e.target.value as PortfolioTransactionType)}>
                {TX_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </TerminalInput>
            </label>
            {TX_NEEDS_SYMBOL[txType] ? (
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-terminal-muted">Symbol</span>
                <TerminalInput className="w-24" value={txSymbol} onChange={(e) => setTxSymbol(e.target.value.toUpperCase())} />
              </label>
            ) : null}
            {TX_NEEDS_SHARES[txType] ? (
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-terminal-muted">Shares</span>
                <TerminalInput className="w-20" type="number" value={txShares} onChange={(e) => setTxShares(Number(e.target.value) || 0)} />
              </label>
            ) : null}
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-terminal-muted">{TX_NEEDS_SHARES[txType] ? "Price" : "Amount"}</span>
              <TerminalInput className="w-24" type="number" value={txPrice} onChange={(e) => setTxPrice(Number(e.target.value) || 0)} />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-terminal-muted">Currency</span>
              <TerminalInput
                as="select"
                className="w-20"
                value={txCurrency}
                onChange={(e) => {
                  const nextCurrency = e.target.value as CurrencyCode;
                  setTxCurrency(nextCurrency);
                  setTxFeesCurrency(nextCurrency);
                }}
              >
                {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
              </TerminalInput>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-terminal-muted">Fees</span>
              <TerminalInput className="w-20" type="number" value={txFees} onChange={(e) => setTxFees(Number(e.target.value) || 0)} />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-terminal-muted">Fee currency</span>
              <TerminalInput as="select" className="w-20" value={txFeesCurrency} onChange={(e) => setTxFeesCurrency(e.target.value as CurrencyCode)}>
                {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
              </TerminalInput>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-terminal-muted">Date</span>
              <TerminalInput className="w-32" type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
            </label>
            <label className="flex flex-1 flex-col gap-0.5">
              <span className="text-[10px] text-terminal-muted">Notes</span>
              <TerminalInput value={txNotes} onChange={(e) => setTxNotes(e.target.value)} placeholder="optional" />
            </label>
            <TerminalButton variant="accent" disabled={!selectedId} onClick={() => void handleRecordTransaction()}>
              Record
            </TerminalButton>
          </div>
          <div className="mb-2 text-[11px] text-terminal-muted">
            Cash impact:{" "}
            <span className={txPreview >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
              {txPreview >= 0 ? "+" : ""}{formatMoney(txPreview, txCurrency)}
            </span>
            {!txCurrenciesCompatible ? `; fees -${formatMoney(txFees, txFeesCurrency)}` : null}
          </div>
          {transactions.length === 0 ? (
            <div className="mb-2 text-[11px] text-terminal-muted">No transactions yet — record a deposit to fund the portfolio, then buy/sell.</div>
          ) : null}
          <DenseTable
            id="portfolio-manager-transactions"
            rows={transactions}
            rowKey={(row) => row.id}
            height={220}
            columns={[
              { key: "date", title: "Date", type: "text", frozen: true, width: 100, sortable: true, getValue: (r) => r.date },
              { key: "type", title: "Type", type: "text", width: 90, sortable: true, getValue: (r) => r.type },
              { key: "symbol", title: "Symbol", type: "text", width: 90, sortable: true, getValue: (r) => (r.symbol === "CASH" ? "—" : r.symbol) },
              { key: "shares", title: "Shares", type: "number", align: "right", sortable: true, getValue: (r) => (TX_NEEDS_SHARES[r.type] ? r.shares : 0), render: (r) => (TX_NEEDS_SHARES[r.type] ? metricFmt(r.shares) : "—") },
              { key: "price", title: "Price / Amt", type: "currency", align: "right", sortable: true, getValue: (r) => r.price, render: (r) => formatLedgerAmount(r.price, r.currency) },
              { key: "fees", title: "Fees", type: "currency", align: "right", sortable: true, getValue: (r) => r.fees, render: (r) => r.fees > 0 ? formatLedgerAmount(r.fees, r.fees_currency) : "—" },
              { key: "cash", title: "Cash Δ", type: "large-number", align: "right", sortable: true, getValue: (r) => accountingTransactions.get(r.id)?.cash_delta_base ?? 0, render: (r) => { const value = accountingTransactions.get(r.id)?.cash_delta_base; return value == null ? "Needs FX" : formatMoney(value, cashCurrency); } },
              { key: "notes", title: "Notes", type: "text", getValue: (r) => r.notes || "" },
            ]}
          />
        </div>

        {holdings.length > 0 ? (
          <div className="rounded border border-terminal-border bg-terminal-panel p-2">
            <div className="mb-2 text-xs text-terminal-muted">Position notes — your thesis per holding, indexed by the Second Brain</div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {holdings.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setNotesSymbol(notesSymbol === h.symbol ? null : h.symbol)}
                  className={`rounded-sm border px-2 py-0.5 text-[11px] transition-colors ${notesSymbol === h.symbol ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted hover:text-terminal-text"}`}
                >
                  {h.symbol}
                </button>
              ))}
            </div>
            {notesSymbol ? <NotesPanel symbol={notesSymbol} context="holding" /> : null}
          </div>
        ) : null}

        <div className="grid gap-2 xl:grid-cols-2">
          <div className="rounded border border-terminal-border bg-terminal-panel p-2">
            <div className="mb-1 text-xs text-terminal-muted">Allocation by Sector</div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={analytics?.allocation_by_sector || []} dataKey="value" nameKey="name" outerRadius={70} fill="#FF6B00" />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-2">
            <div className="mb-1 text-xs text-terminal-muted">Performance vs Benchmark</div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={perfSeries}>
                  <Line dataKey="value" stroke="#FF6B00" dot={false} strokeWidth={2} />
                  <Tooltip />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {portfolioSymbols.length > 0 ? (
          <div className="rounded border border-terminal-border bg-terminal-panel p-2">
            <div className="mb-2 text-xs text-terminal-muted">Upcoming events — dividends, earnings & corporate actions for your holdings</div>
            <PortfolioEventsCalendar symbols={portfolioSymbols} days={30} />
          </div>
        ) : null}

        {/* Deep analytics ported from the retired global portfolio — now scoped
            to the selected Manager portfolio. */}
        {selectedId ? (
          <>
            <div className="grid gap-2 xl:grid-cols-2">
              <RiskMetricsPanel metrics={riskMetrics} />
              <AiInsightCard
                title="AI Risk Assessment"
                description="Narrative interpretation of the available portfolio risk and exposure evidence"
                disabled={!riskMetrics}
                disabledMessage="Portfolio risk metrics are unavailable; there is nothing factual to assess yet."
                fetcher={(_, options) =>
                  fetchAiRiskInsights(
                    {
                      risk_metrics: riskMetrics || {},
                      allocation_by_sector: analytics?.allocation_by_sector || [],
                      correlation: correlation?.matrix || [],
                    },
                    "portfolio",
                    options,
                  )
                }
              />
            </div>
            <div className="grid gap-2 xl:grid-cols-2">
              <BenchmarkOverlayChart data={benchmarkOverlay} />
              <CorrelationHeatmap data={correlation} />
            </div>
            <DividendTracker data={dividends} />
            <AttributionPanel portfolioId={selectedId} />
            <BacktestResults initialTickers={portfolioSymbols} />
          </>
        ) : null}
      </section>
    </div>
  );
}
