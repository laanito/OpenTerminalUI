import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import {
  addPortfolioHolding,
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
  updatePortfolioHoldingCurrency,
  updatePortfolioById,
  updatePortfolioTransactionCurrencies,
  type MultiPortfolio,
  type MultiPortfolioAnalytics,
  type MultiPortfolioHolding,
  type MultiPortfolioTransaction,
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
import { PortfolioRiskAssessment } from "./PortfolioRiskAssessment";
import { ExportButton } from "../common/ExportButton";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalDataState, TerminalScopeBar } from "../terminal/TerminalPage";
import { TerminalModal } from "../terminal/TerminalModal";
import { useDisplayCurrency } from "../../hooks/useDisplayCurrency";
import { useSettingsStore } from "../../store/settingsStore";
import { asCurrencyCode, type CurrencyCode } from "../../lib/currency";
import { TX_NEEDS_SHARES } from "../../utils/portfolioCash";
import { PortfolioOperationDialog, type OperationIntent } from "./PortfolioOperationDialog";
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

type CurrencyRepairTarget =
  | { kind: "holding"; row: MultiPortfolioHolding }
  | { kind: "transaction"; row: MultiPortfolioTransaction };

export function PortfolioManager({ initialPortfolioId, onMutation }: { initialPortfolioId?: string; onMutation?: () => void } = {}) {
  const [operationIntent, setOperationIntent] = useState<OperationIntent | null>(null);
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const loadVersion = useRef(0);

  const [newName, setNewName] = useState("Core Portfolio");
  const [newDescription, setNewDescription] = useState("");
  const [newBenchmark, setNewBenchmark] = useState(BENCHMARKS[0]);
  const [newCurrency, setNewCurrency] = useState<CurrencyCode>("USD");
  const [newCash, setNewCash] = useState(0);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBenchmark, setEditBenchmark] = useState(BENCHMARKS[0]);
  const [editCurrency, setEditCurrency] = useState<CurrencyCode>("USD");

  const [addCurrency, setAddCurrency] = useState<CurrencyCode>("USD");

  const [transactions, setTransactions] = useState<MultiPortfolioTransaction[]>([]);
  const [currencyRepairTarget, setCurrencyRepairTarget] = useState<CurrencyRepairTarget | null>(null);
  const [repairAmountCurrency, setRepairAmountCurrency] = useState<CurrencyCode>("USD");
  const [repairFeeCurrency, setRepairFeeCurrency] = useState<CurrencyCode>("USD");
  const [repairSaving, setRepairSaving] = useState(false);
  const closeCurrencyRepair = useCallback(() => setCurrencyRepairTarget(null), []);

  const loadAll = async (nextId?: string) => {
    const version = ++loadVersion.current;
    setLoading(true);
    setLoadError(null);
    setError(null);
    if (nextId !== undefined) setSelectedId(nextId);
    // A pending/failed scope must not display the previous scope's numbers or actions.
    setHoldings([]);
    setAnalytics(null);
    setTransactions([]);
    setRiskMetrics(null);
    setCorrelation(null);
    setDividends(null);
    setBenchmarkOverlay(null);
    setNotesSymbol(null);
    try {
      const pfs = await fetchPortfolios();
      if (version !== loadVersion.current) return;
      setPortfolios(pfs);
      const requestedId = nextId === undefined ? selectedId : nextId;
      const activeId = pfs.length ? requestedId || pfs[0].id : "";
      if (activeId && !pfs.some(portfolio => portfolio.id === activeId)) {
        throw new Error("Selected portfolio is no longer available. Choose another portfolio or refresh.");
      }
      if (activeId) {
        setSelectedId(activeId);
        const [h, a, t] = await Promise.all([
          fetchPortfolioHoldings(activeId),
          fetchPortfolioAnalyticsV2(activeId),
          fetchPortfolioTransactions(activeId),
        ]);
        if (version !== loadVersion.current) return;
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
        }
        // Deep analytics hit market data and are slower; load them in the
        // background (scoped to the selected portfolio) so the core view renders
        // immediately. Each panel handles its own null/empty state.
        const bench = selected?.benchmark_symbol || "S&P500";
        setRiskMetrics(null);
        setCorrelation(null);
        setDividends(null);
        setBenchmarkOverlay(null);
        void fetchPortfolioRiskMetrics({ benchmark: bench, risk_free_rate: 0.04 }, activeId).then((value) => { if (version === loadVersion.current) setRiskMetrics(value); }).catch(() => { if (version === loadVersion.current) setRiskMetrics(null); });
        void fetchPortfolioCorrelation({ window: 60 }, activeId).then((value) => { if (version === loadVersion.current) setCorrelation(value); }).catch(() => { if (version === loadVersion.current) setCorrelation(null); });
        void fetchPortfolioDividends({ days: 180 }, activeId).then((value) => { if (version === loadVersion.current) setDividends(value); }).catch(() => { if (version === loadVersion.current) setDividends(null); });
        void fetchPortfolioBenchmarkOverlay({ benchmark: bench }, activeId).then((value) => { if (version === loadVersion.current) setBenchmarkOverlay(value); }).catch(() => { if (version === loadVersion.current) setBenchmarkOverlay(null); });
      } else {
        setSelectedId("");
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
      if (version === loadVersion.current) setLoadError(err instanceof Error ? err.message : "Failed to load portfolios");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll(initialPortfolioId);
    return () => { loadVersion.current++; };
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

  const openCurrencyRepair = (target: CurrencyRepairTarget) => {
    setRepairAmountCurrency(cashCurrency);
    setRepairFeeCurrency(cashCurrency);
    setCurrencyRepairTarget(target);
    setError(null);
    setStatus(null);
  };

  const saveCurrencyRepair = async () => {
    if (!selectedId || !currencyRepairTarget) return;
    setError(null);
    setStatus(null);
    setRepairSaving(true);
    try {
      if (currencyRepairTarget.kind === "holding") {
        await updatePortfolioHoldingCurrency(selectedId, currencyRepairTarget.row.id, repairAmountCurrency);
        setStatus(`Recorded ${repairAmountCurrency} as the cost currency for ${currencyRepairTarget.row.symbol}`);
      } else {
        const transaction = currencyRepairTarget.row;
        const payload: { currency?: string; fees_currency?: string } = {};
        if (!asCurrencyCode(transaction.currency)) payload.currency = repairAmountCurrency;
        if (transaction.fees > 0 && !asCurrencyCode(transaction.fees_currency)) payload.fees_currency = repairFeeCurrency;
        await updatePortfolioTransactionCurrencies(selectedId, transaction.id, payload);
        setStatus(`Recorded the missing currencies for the ${transaction.type} transaction`);
      }
      setCurrencyRepairTarget(null);
      await loadAll(selectedId);
      onMutation?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update legacy currency");
    } finally {
      setRepairSaving(false);
    }
  };

  const sellFromPosition = (row: MultiPortfolioHolding) => {
    setOperationIntent({ portfolioId: selectedId, type: "sell", symbol: row.symbol,
      shares: row.shares, price: row.current_price, currency: row.currency || undefined,
      lotId: row.lot_id });
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
      onMutation?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import CSV");
    }
  };

  return (
    <div className="min-w-0 space-y-3">
      <TerminalScopeBar label="Portfolio scope" scope={selectedPortfolio?.name || (selectedId ? "Unavailable portfolio" : "No portfolio selected")}
        facts={selectedPortfolio ? [{ label: "Accounting base", value: selectedPortfolio.currency || "Unknown" }, { label: "Benchmark", value: selectedPortfolio.benchmark_symbol || "Not set" }] : []}
        actions={<TerminalButton size="sm" disabled={loading || repairSaving} onClick={() => { setStatus(null); void loadAll(); }}>Refresh portfolios</TerminalButton>} />
      {loading ? <TerminalDataState kind="loading" title="Loading portfolio">Checking the selected portfolio. Previous figures and operation controls are hidden.</TerminalDataState>
        : loadError ? <TerminalDataState kind="error" title="Portfolio unavailable" action={<TerminalButton size="sm" onClick={() => void loadAll()}>Retry portfolio load</TerminalButton>}>{loadError} No previous figures are shown.</TerminalDataState>
          : !selectedPortfolio ? <TerminalDataState kind="empty" title="No portfolios yet">Create a portfolio to start recording holdings and activity.</TerminalDataState> : null}
      {error ? <TerminalDataState kind="error" title="Portfolio action failed">{error}</TerminalDataState> : null}
      {!loading && !loadError && status ? <p role="status" className="break-words text-sm text-terminal-pos">{status}</p> : null}
      <div className="grid min-w-0 gap-3 xl:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="rounded border border-terminal-border bg-terminal-panel p-2">
        <div className="mb-2 text-xs font-semibold text-terminal-accent">Portfolios</div>
        <div className="space-y-1">
          {portfolios.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`w-full rounded border px-2 py-1 text-left text-xs ${selectedId === p.id ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent" : "border-terminal-border text-terminal-text"}`}
              disabled={repairSaving}
              onClick={() => { setStatus(null); void loadAll(p.id); }}
            >
              <div>{p.name}</div>
              <div className="text-[10px] text-terminal-muted">{loading || loadError ? "—" : metricFmt(p.total_value)}</div>
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
            disabled={loading || repairSaving}
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
                onMutation?.();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to create portfolio");
              }
            }}
          >
            Add Portfolio
          </TerminalButton>
        </div>
      </aside>

      {!loading && !loadError && selectedPortfolio ? <section aria-label="Selected portfolio details" className="min-w-0 space-y-2">
        {analytics && analytics.accounting?.status !== "complete" ? (
          <TerminalDataState kind="partial" title="Portfolio accounting incomplete">
            Accounting is {analytics.accounting?.status || "unavailable"}: {analytics.accounting?.issues[0]?.message || analytics.accounting?.degraded_reasons[0] || "the backend accounting contract is unavailable"}. Affected totals remain unavailable; available values are accounted in {cashCurrency} before optional display conversion.
          </TerminalDataState>
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
                  onMutation?.();
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
                  await loadAll("");
                  onMutation?.();
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
            <div className="flex flex-wrap gap-2">
              <TerminalButton variant="accent" onClick={() => setOperationIntent({ portfolioId: selectedId, type: "buy", currency: selectedPortfolio?.currency })}>Record operation</TerminalButton>
              <TerminalButton onClick={() => setOperationIntent({ portfolioId: selectedId, type: "opening", currency: selectedPortfolio?.currency })}>Add existing position</TerminalButton>
              <ExportButton source="portfolio" data={holdings} disabled={!holdings.length} />
              <label className="text-xs text-terminal-muted">Import CSV (records buys and debits cash)<input aria-label="Import CSV" type="file" accept=".csv" onChange={e => void handleImportCsv(e.target.files?.[0] || null)} /></label>
            </div>
          </div>
          {holdings.length === 0 ? <TerminalDataState kind="empty" title="No holdings in this portfolio">Recorded cash and transactions can still exist. Record an operation or add an existing position without moving cash.</TerminalDataState> : <DenseTable
            id="portfolio-manager-holdings"
            rows={holdings}
            rowKey={(row) => row.id}
            height={260}
            columns={[
              { key: "symbol", title: "Symbol", type: "text", frozen: true, width: 100, sortable: true, getValue: (r) => r.symbol },
              { key: "shares", title: "Shares", type: "number", align: "right", sortable: true, getValue: (r) => r.shares },
              {
                key: "avgCost",
                title: "Avg Cost",
                type: "currency",
                align: "right",
                sortable: true,
                getValue: (r) => r.cost_basis_per_share,
                render: (r) => formatLedgerAmount(r.cost_basis_per_share, r.cost_basis_currency),
              },
              { key: "current", title: "Current", type: "currency", align: "right", sortable: true, getValue: (r) => r.current_price || 0, render: (r) => formatMoney(r.current_price || 0, currencyFor(r)) },
              { key: "value", title: "Market Value", type: "large-number", align: "right", sortable: true, getValue: (r) => (r.current_price || 0) * r.shares, render: (r) => formatCompactMoney((r.current_price || 0) * r.shares, currencyFor(r)) },
              { key: "pnl", title: "P&L", type: "large-number", align: "right", sortable: true, getValue: (r) => accountingHoldings.get(r.id)?.unrealized_pnl_base ?? 0, render: (r) => { const value = accountingHoldings.get(r.id)?.unrealized_pnl_base; return value == null ? "Needs FX" : formatCompactMoney(value, cashCurrency); } },
              { key: "pnlPct", title: "P&L%", type: "percent", align: "right", sortable: true, getValue: (r) => { const evidence = accountingHoldings.get(r.id); return evidence?.unrealized_pnl_base != null && evidence.cost_basis_base ? evidence.unrealized_pnl_base / evidence.cost_basis_base * 100 : 0; }, render: (r) => { const evidence = accountingHoldings.get(r.id); return evidence?.unrealized_pnl_base != null && evidence.cost_basis_base ? `${metricFmt(evidence.unrealized_pnl_base / evidence.cost_basis_base * 100)}%` : "Needs FX"; } },
              {
                key: "actions",
                title: "",
                type: "text",
                align: "right",
                width: 148,
                getValue: () => "",
                render: (r) => (
                  <span className="inline-flex items-center justify-end gap-1">
                    {!asCurrencyCode(r.cost_basis_currency) ? (
                      <button
                        type="button"
                        className="rounded border border-terminal-warn/60 px-1.5 py-0.5 text-[10px] text-terminal-warn hover:border-terminal-accent hover:text-terminal-accent"
                        onClick={(event) => {
                          event.stopPropagation();
                          openCurrencyRepair({ kind: "holding", row: r });
                        }}
                      >
                        Set currency
                      </button>
                    ) : null}
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
                  </span>
                ),
              },
            ]}
          />}
        </div>

        <div className="rounded border border-terminal-border bg-terminal-panel p-2">
          <h2 className="mb-2 text-xs text-terminal-muted">Recorded activity</h2>
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
              {
                key: "price",
                title: "Price / Amt",
                type: "currency",
                align: "right",
                sortable: true,
                getValue: (r) => r.price,
                render: (r) => formatLedgerAmount(r.price, r.currency),
              },
              {
                key: "fees",
                title: "Fees",
                type: "currency",
                align: "right",
                sortable: true,
                getValue: (r) => r.fees,
                render: (r) => {
                  if (r.fees <= 0) return "—";
                  return formatLedgerAmount(r.fees, r.fees_currency);
                },
              },
              { key: "cash", title: "Cash Δ", type: "large-number", align: "right", sortable: true, getValue: (r) => accountingTransactions.get(r.id)?.cash_delta_base ?? 0, render: (r) => { const value = accountingTransactions.get(r.id)?.cash_delta_base; return value == null ? "Needs FX" : formatMoney(value, cashCurrency); } },
              { key: "notes", title: "Notes", type: "text", getValue: (r) => r.notes || "" },
              {
                key: "actions",
                title: "",
                type: "text",
                align: "right",
                width: 96,
                getValue: () => "",
                render: (r) => !asCurrencyCode(r.currency) || (r.fees > 0 && !asCurrencyCode(r.fees_currency)) ? (
                  <button
                    type="button"
                    className="rounded border border-terminal-warn/60 px-1.5 py-0.5 text-[10px] text-terminal-warn hover:border-terminal-accent hover:text-terminal-accent"
                    onClick={(event) => {
                      event.stopPropagation();
                      openCurrencyRepair({ kind: "transaction", row: r });
                    }}
                  >
                    Set currency
                  </button>
                ) : null,
              },
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
              <PortfolioRiskAssessment key={selectedId} portfolioId={selectedId} holdings={holdings} disabled={loading} metricsAvailable={!!riskMetrics}
                metrics={{
                  risk_metrics: riskMetrics || {},
                  allocation_by_sector: analytics?.allocation_by_sector || [],
                  correlation: correlation?.matrix || [],
                }}
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
      </section> : null}
      </div>

      {operationIntent && <PortfolioOperationDialog intent={operationIntent} portfolios={portfolios}
        onClose={() => setOperationIntent(null)} onSaved={() => { void loadAll(selectedId); onMutation?.(); }} />}

      <TerminalModal
        open={currencyRepairTarget !== null}
        onClose={closeCurrencyRepair}
        title="Repair legacy currency"
        subtitle={currencyRepairTarget?.kind === "holding"
          ? `${currencyRepairTarget.row.symbol} holding`
          : currencyRepairTarget?.kind === "transaction"
            ? `${currencyRepairTarget.row.type} · ${currencyRepairTarget.row.symbol} · ${currencyRepairTarget.row.date}`
            : undefined}
        size="sm"
        busy={repairSaving}
        footer={(
          <div className="flex justify-end gap-2">
            <TerminalButton
              type="button"
              size="sm"
              variant="ghost"
              disabled={repairSaving}
              onClick={closeCurrencyRepair}
            >
              Cancel
            </TerminalButton>
            <TerminalButton
              type="button"
              size="sm"
              variant="accent"
              disabled={repairSaving}
              onClick={() => void saveCurrencyRepair()}
            >
              {repairSaving ? "Saving…" : "Save currency"}
            </TerminalButton>
          </div>
        )}
      >
        <div className="space-y-3 text-xs">
          <p className="text-terminal-muted">
            Confirm the currency recorded by the original entry. This updates its denomination only; amounts, quantities, and dates are unchanged.
          </p>
          {currencyRepairTarget?.kind === "holding" ? (
            <label className="block text-terminal-muted">
              <span className="mb-1 block">Cost currency</span>
              <TerminalInput
                as="select"
                className="w-full"
                value={repairAmountCurrency}
                onChange={(event) => setRepairAmountCurrency(event.target.value as CurrencyCode)}
              >
                {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
              </TerminalInput>
            </label>
          ) : null}
          {currencyRepairTarget?.kind === "transaction" && !asCurrencyCode(currencyRepairTarget.row.currency) ? (
            <label className="block text-terminal-muted">
              <span className="mb-1 block">{TX_NEEDS_SHARES[currencyRepairTarget.row.type] ? "Price currency" : "Amount currency"}</span>
              <TerminalInput
                as="select"
                className="w-full"
                value={repairAmountCurrency}
                onChange={(event) => setRepairAmountCurrency(event.target.value as CurrencyCode)}
              >
                {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
              </TerminalInput>
            </label>
          ) : null}
          {currencyRepairTarget?.kind === "transaction"
          && currencyRepairTarget.row.fees > 0
          && !asCurrencyCode(currencyRepairTarget.row.fees_currency) ? (
            <label className="block text-terminal-muted">
              <span className="mb-1 block">Fee currency</span>
              <TerminalInput
                as="select"
                className="w-full"
                value={repairFeeCurrency}
                onChange={(event) => setRepairFeeCurrency(event.target.value as CurrencyCode)}
              >
                {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
              </TerminalInput>
            </label>
          ) : null}
        </div>
      </TerminalModal>
    </div>
  );
}
