import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PortfolioManager } from "../components/portfolio/PortfolioManager";

const fetchPortfoliosMock = vi.fn();
const addPortfolioHoldingMock = vi.fn();
const addPortfolioTransactionMock = vi.fn();
const fetchPortfolioHoldingsMock = vi.fn();
const fetchPortfolioTransactionsMock = vi.fn();
const createPortfolioMock = vi.fn();
const updatePortfolioMock = vi.fn();
const updatePortfolioHoldingCurrencyMock = vi.fn();
const updatePortfolioTransactionCurrenciesMock = vi.fn();
const fetchAiRiskInsightsMock = vi.fn();
const fetchPortfolioAnalyticsMock = vi.fn();
const fetchPortfolioCorrelationMock = vi.fn();
const fetchPortfolioRiskMetricsMock = vi.fn();

vi.mock("../api/client", () => ({
  addPortfolioHolding: (...args: unknown[]) => addPortfolioHoldingMock(...args),
  addPortfolioTransaction: (...args: unknown[]) => addPortfolioTransactionMock(...args),
  createPortfolio: (...args: unknown[]) => createPortfolioMock(...args),
  deletePortfolioById: vi.fn(),
  fetchAiRiskInsights: (...args: unknown[]) => fetchAiRiskInsightsMock(...args),
  fetchPortfolioAnalyticsV2: (...args: unknown[]) => fetchPortfolioAnalyticsMock(...args),
  fetchPortfolioBenchmarkOverlay: vi.fn(async () => null),
  fetchPortfolioCorrelation: (...args: unknown[]) => fetchPortfolioCorrelationMock(...args),
  fetchPortfolioDividends: vi.fn(async () => null),
  fetchPortfolioHoldings: (...args: unknown[]) => fetchPortfolioHoldingsMock(...args),
  fetchPortfolioRiskMetrics: (...args: unknown[]) => fetchPortfolioRiskMetricsMock(...args),
  fetchPortfolioTransactions: (...args: unknown[]) => fetchPortfolioTransactionsMock(...args),
  fetchPortfolios: (...args: unknown[]) => fetchPortfoliosMock(...args),
  updatePortfolioById: (...args: unknown[]) => updatePortfolioMock(...args),
  updatePortfolioHoldingCurrency: (...args: unknown[]) => updatePortfolioHoldingCurrencyMock(...args),
  updatePortfolioTransactionCurrencies: (...args: unknown[]) => updatePortfolioTransactionCurrenciesMock(...args),
}));

vi.mock("../hooks/useDisplayCurrency", () => ({
  useDisplayCurrency: () => ({
    formatMoney: (value: number | null | undefined) => String(value ?? "-"),
    formatCompactMoney: (value: number | null | undefined) => String(value ?? "-"),
    nativeFor: () => "USD",
    nativeForInstrument: (currency?: string | null) => currency || "USD",
  }),
}));

vi.mock("../components/PortfolioEventsCalendar", () => ({ PortfolioEventsCalendar: () => null }));
vi.mock("../components/portfolio/RiskMetricsPanel", () => ({ RiskMetricsPanel: () => null }));
vi.mock("../components/portfolio/CorrelationHeatmap", () => ({ CorrelationHeatmap: () => null }));
vi.mock("../components/portfolio/DividendTracker", () => ({ DividendTracker: () => null }));
vi.mock("../components/portfolio/BenchmarkOverlayChart", () => ({ BenchmarkOverlayChart: () => null }));
vi.mock("../components/portfolio/BacktestResults", () => ({ BacktestResults: () => null }));
vi.mock("../components/portfolio/AttributionPanel", () => ({ AttributionPanel: () => null }));
vi.mock("recharts", () => ({
  Line: () => null,
  LineChart: ({ children }: { children?: unknown }) => <>{children}</>,
  Pie: () => null,
  PieChart: ({ children }: { children?: unknown }) => <>{children}</>,
  ResponsiveContainer: ({ children }: { children?: unknown }) => <>{children}</>,
  Tooltip: () => null,
}));

describe("PortfolioManager thesis capture", () => {
  beforeEach(() => {
    for (const mock of [
      fetchPortfoliosMock,
      addPortfolioHoldingMock,
      addPortfolioTransactionMock,
      fetchPortfolioHoldingsMock,
      fetchPortfolioTransactionsMock,
      createPortfolioMock,
      updatePortfolioMock,
      updatePortfolioHoldingCurrencyMock,
      updatePortfolioTransactionCurrenciesMock,
      fetchAiRiskInsightsMock,
      fetchPortfolioAnalyticsMock,
      fetchPortfolioCorrelationMock,
      fetchPortfolioRiskMetricsMock,
    ]) {
      mock.mockReset();
    }
    fetchPortfoliosMock.mockResolvedValue([
      {
        id: "p1",
        name: "Core",
        description: "Own durable compounders while margins expand.",
        benchmark_symbol: "S&P500",
        currency: "USD",
      },
    ]);
    updatePortfolioMock.mockResolvedValue(undefined);
    updatePortfolioHoldingCurrencyMock.mockResolvedValue(undefined);
    updatePortfolioTransactionCurrenciesMock.mockResolvedValue(undefined);
    addPortfolioHoldingMock.mockResolvedValue(undefined);
    addPortfolioTransactionMock.mockResolvedValue(undefined);
    fetchPortfolioHoldingsMock.mockResolvedValue([]);
    fetchPortfolioTransactionsMock.mockResolvedValue([]);
    fetchPortfolioAnalyticsMock.mockResolvedValue({
      total_value: 288,
      total_cost: 220,
      cash_balance: 1430,
      net_liquidation_value: 1718,
      unrealized_pnl: 68,
      unrealized_pnl_pct: 30.91,
      realized_pnl: 0,
      day_change: 6.24,
      day_change_pct: 2,
      dividend_income_ytd: 0,
      annualized_return: 4,
      sharpe_ratio: 1.1,
      max_drawdown: -0.12,
      allocation_by_sector: [{ name: "Technology", value: 75 }],
      allocation_by_market: [],
      top_gainers: [],
      top_losers: [],
      accounting: {
        base_currency: "USD",
        status: "complete",
        issues: [],
        degraded_reasons: [],
        holdings: [],
        transactions: [],
      },
    });
    fetchPortfolioCorrelationMock.mockResolvedValue({
      symbols: ["AAPL", "MSFT"],
      matrix: [[{ x: "AAPL", y: "MSFT", value: 0.8 }]],
      rolling: [],
    });
    fetchPortfolioRiskMetricsMock.mockResolvedValue({
      sharpe_ratio: 1.1,
      sortino_ratio: 1.4,
      max_drawdown: -0.12,
      beta: 0.9,
      alpha: 0.03,
      information_ratio: 0.4,
    });
    fetchAiRiskInsightsMock.mockResolvedValue({
      engine: "llm",
      model: "test",
      summary: "Grounded risk assessment.",
      sections: [],
    });
  });

  it("loads and saves the selected portfolio thesis", async () => {
    render(<PortfolioManager />);

    const thesis = await screen.findByRole("textbox", { name: "Portfolio thesis" });
    expect(thesis).toHaveValue("Own durable compounders while margins expand.");

    fireEvent.change(thesis, { target: { value: "Reduce exposure if margin leadership breaks." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updatePortfolioMock).toHaveBeenCalledWith("p1", {
        name: "Core",
        description: "Reduce exposure if margin leadership breaks.",
        benchmark_symbol: "S&P500",
        currency: "USD",
      }),
    );
  });

  it("renders normalized aggregates from the backend accounting contract", async () => {
    render(<PortfolioManager />);

    expect(await screen.findByText("1718")).toBeInTheDocument();
    expect(screen.getByText("1430")).toBeInTheDocument();
    expect(screen.queryByText("Mixed currencies")).not.toBeInTheDocument();
    expect(screen.queryByText(/Accounting is/)).not.toBeInTheDocument();
  });

  it("captures a thesis when creating a portfolio", async () => {
    fetchPortfoliosMock.mockReset();
    fetchPortfoliosMock.mockResolvedValue([]);
    createPortfolioMock.mockResolvedValue({ id: "p2", name: "Macro" });
    render(<PortfolioManager />);
    await screen.findByRole("status", { name: "No portfolios yet" });

    fireEvent.change(screen.getByRole("textbox", { name: "New portfolio thesis" }), {
      target: { value: "  Diversify across inflation regimes.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Portfolio" }));

    await waitFor(() =>
      expect(createPortfolioMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Diversify across inflation regimes." }),
      ),
    );
  });

  it("labels holding-entry fields and submits their values", async () => {
    render(<PortfolioManager />);

    await screen.findByRole("textbox", { name: "Portfolio thesis" });
    const holdingForm = within(screen.getByRole("group", { name: "Add holding" }));
    fireEvent.change(holdingForm.getByRole("textbox", { name: "Symbol" }), { target: { value: "msft" } });
    fireEvent.change(holdingForm.getByRole("spinbutton", { name: "Quantity" }), { target: { value: "12" } });
    fireEvent.change(holdingForm.getByRole("spinbutton", { name: "Unit price" }), { target: { value: "415.25" } });
    fireEvent.change(holdingForm.getByLabelText("Purchase date"), { target: { value: "2026-09-05" } });
    fireEvent.click(holdingForm.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(addPortfolioHoldingMock).toHaveBeenCalledWith("p1", {
        symbol: "MSFT",
        shares: 12,
        cost_basis_per_share: 415.25,
        currency: "USD",
        purchase_date: "2026-09-05",
      }),
    );
  });

  it("records amount and fee currencies explicitly", async () => {
    render(<PortfolioManager />);

    await screen.findByRole("textbox", { name: "Portfolio thesis" });
    const transactionForm = within(screen.getByText("Record Transaction").parentElement as HTMLElement);
    fireEvent.change(transactionForm.getByRole("combobox", { name: "Currency" }), { target: { value: "EUR" } });
    fireEvent.change(transactionForm.getByRole("spinbutton", { name: "Fees" }), { target: { value: "2" } });
    fireEvent.change(transactionForm.getByRole("combobox", { name: "Fee currency" }), { target: { value: "GBP" } });
    fireEvent.change(transactionForm.getByLabelText("Date"), { target: { value: "2026-09-06" } });
    fireEvent.click(transactionForm.getByRole("button", { name: "Record" }));

    await waitFor(() =>
      expect(addPortfolioTransactionMock).toHaveBeenCalledWith("p1", {
        type: "buy",
        symbol: "AAPL",
        shares: 10,
        price: 100,
        currency: "EUR",
        fees: 2,
        fees_currency: "GBP",
        date: "2026-09-06",
        notes: undefined,
      }),
    );
  });

  it("lets users repair unknown currencies on legacy holdings and transactions", async () => {
    fetchPortfolioHoldingsMock.mockResolvedValue([
      {
        id: "h-legacy",
        symbol: "SAP.DE",
        shares: 2,
        cost_basis_per_share: 180,
        cost_basis_currency: null,
        purchase_date: "2025-01-02",
        current_price: 190,
        currency: "EUR",
      },
    ]);
    fetchPortfolioTransactionsMock.mockResolvedValue([
      {
        id: "t-legacy",
        symbol: "SAP.DE",
        type: "buy",
        shares: 2,
        price: 180,
        currency: null,
        date: "2025-01-02",
        fees: 2,
        fees_currency: null,
      },
    ]);
    render(<PortfolioManager />);

    await screen.findAllByText("SAP.DE");
    fireEvent.click(screen.getAllByRole("button", { name: "Set currency" })[0]);
    const holdingDialog = screen.getByRole("dialog", { name: "Repair legacy currency" });
    const holdingCurrency = within(holdingDialog).getByRole("combobox", { name: "Cost currency" });
    fireEvent.change(holdingCurrency, { target: { value: "EUR" } });
    fireEvent.click(within(holdingDialog).getByRole("button", { name: "Save currency" }));

    await waitFor(() => expect(updatePortfolioHoldingCurrencyMock).toHaveBeenCalledWith("p1", "h-legacy", "EUR"));

    fireEvent.click(screen.getAllByRole("button", { name: "Set currency" })[1]);
    const transactionDialog = screen.getByRole("dialog", { name: "Repair legacy currency" });
    const transactionCurrency = within(transactionDialog).getByRole("combobox", { name: "Price currency" });
    fireEvent.change(transactionCurrency, { target: { value: "EUR" } });
    const feeCurrency = within(transactionDialog).getByRole("combobox", { name: "Fee currency" });
    fireEvent.change(feeCurrency, { target: { value: "GBP" } });
    fireEvent.click(within(transactionDialog).getByRole("button", { name: "Save currency" }));

    await waitFor(() => expect(updatePortfolioTransactionCurrenciesMock).toHaveBeenCalledWith("p1", "t-legacy", {
      currency: "EUR",
      fees_currency: "GBP",
    }));
  });

  it("sends available risk and exposure evidence to the assessment", async () => {
    render(<PortfolioManager />);

    await screen.findByRole("button", { name: "Generate" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() =>
      expect(fetchAiRiskInsightsMock).toHaveBeenCalledWith(
        {
          risk_metrics: expect.objectContaining({ sharpe_ratio: 1.1, max_drawdown: -0.12 }),
          allocation_by_sector: [{ name: "Technology", value: 75 }],
          correlation: [[{ x: "AAPL", y: "MSFT", value: 0.8 }]],
        },
        "portfolio",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });
  it("ignores late risk metrics from a previously selected portfolio", async () => {
    let resolveOld!: (value: unknown) => void;
    fetchPortfoliosMock.mockResolvedValue([{ id: "p1", name: "Core", currency: "USD" }, { id: "p2", name: "Other", currency: "EUR" }]);
    fetchPortfolioRiskMetricsMock.mockImplementation((_params, id) => id === "p1" ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve({ sharpe_ratio: 2 }));
    render(<PortfolioManager />);
    await waitFor(() => expect(fetchPortfolioRiskMetricsMock).toHaveBeenCalledWith(expect.any(Object), "p1"));
    fireEvent.click(screen.getByRole("button", { name: /^Other/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled());
    await act(async () => resolveOld({ sharpe_ratio: -9 }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(fetchAiRiskInsightsMock).toHaveBeenCalledWith(expect.objectContaining({ risk_metrics: { sharpe_ratio: 2 } }), "portfolio", expect.any(Object)));
  });
  it("clears prior figures on a failed scope switch and retries the selected portfolio", async () => {
    let rejectOther!: (reason: Error) => void;
    fetchPortfoliosMock.mockResolvedValue([{ id: "p1", name: "Core", currency: "USD" }, { id: "p2", name: "Other", currency: "EUR" }]);
    fetchPortfolioHoldingsMock.mockImplementation(id => id === "p1" ? Promise.resolve([{ id: "h1", symbol: "AAPL", shares: 1, cost_basis_per_share: 100, cost_basis_currency: "USD", currency: "USD", current_price: 110 }]) : new Promise((_resolve, reject) => { rejectOther = reject; }));
    render(<PortfolioManager />);
    await screen.findAllByText("AAPL");
    fireEvent.click(screen.getByRole("button", { name: /^Other/ }));
    expect(screen.getByRole("region", { name: "Portfolio scope" })).toHaveTextContent("Other");
    expect(screen.queryByRole("region", { name: "Selected portfolio details" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading portfolio" })).toBeVisible();
    await waitFor(() => expect(rejectOther).toBeTypeOf("function"));
    await act(async () => rejectOther(new Error("Holdings feed unavailable")));
    expect(screen.getByRole("alert", { name: "Portfolio unavailable" })).toHaveTextContent("No previous figures are shown");
    expect(screen.queryByText("Net Liquidation")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "No holdings in this portfolio" })).not.toBeInTheDocument();
    fetchPortfolioHoldingsMock.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry portfolio load" }));
    await screen.findByRole("region", { name: "Selected portfolio details" });
    expect(fetchPortfolioHoldingsMock).toHaveBeenLastCalledWith("p2");
    expect(screen.getByRole("region", { name: "Portfolio scope" })).toHaveTextContent("EUR");
    expect(screen.getByRole("status", { name: "No holdings in this portfolio" })).toBeVisible();
  });

  it("ignores late holdings from an abandoned scope", async () => {
    let resolveOther!: (value: unknown[]) => void;
    fetchPortfoliosMock.mockResolvedValue([{ id: "p1", name: "Core", currency: "USD" }, { id: "p2", name: "Other", currency: "EUR" }]);
    fetchPortfolioHoldingsMock.mockImplementation(id => id === "p2" ? new Promise(resolve => { resolveOther = resolve; }) : Promise.resolve([{ id: "h1", symbol: "AAPL", shares: 1, current_price: 100, cost_basis_per_share: 90, cost_basis_currency: "USD", currency: "USD" }]));
    render(<PortfolioManager />);
    await screen.findByRole("region", { name: "Selected portfolio details" });
    fireEvent.click(screen.getByRole("button", { name: /^Other/ }));
    await waitFor(() => expect(resolveOther).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: /^Core/ }));
    await screen.findByRole("region", { name: "Selected portfolio details" });
    await act(async () => resolveOther([{ id: "late", symbol: "STALE-SYMBOL", shares: 2, current_price: 100 }]));
    expect(screen.getByRole("region", { name: "Portfolio scope" })).toHaveTextContent("Core");
    expect(screen.queryByText("STALE-SYMBOL")).not.toBeInTheDocument();
    expect(screen.getAllByText("AAPL").length).toBeGreaterThan(0);
  });

  it("distinguishes an unavailable list from an authoritative empty list", async () => {
    fetchPortfoliosMock.mockRejectedValue(new Error("List unavailable"));
    render(<PortfolioManager />);
    await screen.findByRole("alert", { name: "Portfolio unavailable" });
    expect(screen.queryByRole("status", { name: "No portfolios yet" })).not.toBeInTheDocument();
    fetchPortfoliosMock.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry portfolio load" }));
    await screen.findByRole("status", { name: "No portfolios yet" });
    expect(screen.queryByRole("region", { name: "Selected portfolio details" })).not.toBeInTheDocument();
  });

  it("does not silently substitute a different portfolio when the requested scope disappears", async () => {
    fetchPortfoliosMock.mockResolvedValueOnce([{ id: "p1", name: "Core", currency: "USD" }, { id: "p2", name: "Other", currency: "EUR" }]).mockResolvedValue([{ id: "p1", name: "Core", currency: "USD" }]);
    render(<PortfolioManager />);
    await screen.findByRole("region", { name: "Selected portfolio details" });
    fireEvent.click(screen.getByRole("button", { name: /^Other/ }));
    expect(await screen.findByRole("alert", { name: "Portfolio unavailable" })).toHaveTextContent("no longer available");
    expect(fetchPortfolioHoldingsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("region", { name: "Portfolio scope" })).toHaveTextContent("Unavailable portfolio");
  });

});
