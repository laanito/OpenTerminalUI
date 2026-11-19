import { api } from "./base";
import type {
  PortfolioResponse,
  SectorAllocationResponse,
  PortfolioRiskMetrics,
  PortfolioCorrelationResponse,
  PortfolioDividendTracker,
  PortfolioBenchmarkOverlay,
  PortfolioHistory,
  PortfolioMutualFundsResponse,
  PaperPortfolio,
  PaperOrder,
  PaperTrade,
  PaperPosition,
  PaperPerformance,
} from "../types";
import type {
  MultiPortfolio,
  MultiPortfolioHolding,
  MultiPortfolioAnalytics,
  MultiPortfolioTransaction,
  PortfolioTransactionType,
  CorrelationMatrixResponse,
  CorrelationRollingResponse,
  CorrelationClustersResponse,
} from "./types";

export async function fetchPortfolios(): Promise<MultiPortfolio[]> {
  const { data } = await api.get<{ items: MultiPortfolio[] }>("/portfolios");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createPortfolio(payload: { name: string; description?: string; benchmark_symbol?: string; currency?: string; starting_cash?: number }): Promise<{ id: string; name: string }> {
  const { data } = await api.post<{ id: string; name: string }>("/portfolios", payload);
  return data;
}

export async function fetchPortfolioById(portfolioId: string): Promise<MultiPortfolio> {
  const { data } = await api.get<MultiPortfolio>(`/portfolios/${encodeURIComponent(portfolioId)}`);
  return data;
}

export async function updatePortfolioById(portfolioId: string, payload: { name?: string; description?: string; benchmark_symbol?: string; currency?: string }): Promise<void> {
  await api.patch(`/portfolios/${encodeURIComponent(portfolioId)}`, payload);
}

export async function deletePortfolioById(portfolioId: string): Promise<void> {
  await api.delete(`/portfolios/${encodeURIComponent(portfolioId)}`);
}

export async function fetchPortfolioHoldings(portfolioId: string): Promise<MultiPortfolioHolding[]> {
  const { data } = await api.get<{ items: MultiPortfolioHolding[] }>(`/portfolios/${encodeURIComponent(portfolioId)}/holdings`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function addPortfolioHolding(portfolioId: string, payload: { symbol: string; shares: number; cost_basis_per_share: number; currency?: string; purchase_date: string; notes?: string; lot_id?: string }): Promise<{ id: string; symbol: string }> {
  const { data } = await api.post<{ id: string; symbol: string }>(`/portfolios/${encodeURIComponent(portfolioId)}/holdings`, payload);
  return data;
}

export async function updatePortfolioHoldingCurrency(portfolioId: string, holdingId: string, currency: string): Promise<void> {
  await api.patch(
    `/portfolios/${encodeURIComponent(portfolioId)}/holdings/${encodeURIComponent(holdingId)}/currency`,
    { currency },
  );
}

export async function addPortfolioTransaction(portfolioId: string, payload: { symbol?: string; type: PortfolioTransactionType; shares?: number; price?: number; currency?: string; date: string; fees?: number; fees_currency?: string; lot_id?: string; notes?: string; operation_id?: string; opening?: import("./types").PortfolioOpeningData }): Promise<{ id: string; status: string }> {
  const { data } = await api.post<{ id: string; status: string }>(`/portfolios/${encodeURIComponent(portfolioId)}/transactions`, payload);
  return data;
}

export async function fetchPortfolioTransactions(portfolioId: string): Promise<MultiPortfolioTransaction[]> {
  const { data } = await api.get<{ items: MultiPortfolioTransaction[] }>(`/portfolios/${encodeURIComponent(portfolioId)}/transactions`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function updatePortfolioTransactionCurrencies(
  portfolioId: string,
  transactionId: string,
  payload: { currency?: string; fees_currency?: string },
): Promise<void> {
  await api.patch(
    `/portfolios/${encodeURIComponent(portfolioId)}/transactions/${encodeURIComponent(transactionId)}/currency`,
    payload,
  );
}

export async function fetchPortfolioAnalyticsV2(portfolioId: string): Promise<MultiPortfolioAnalytics> {
  const { data } = await api.get<MultiPortfolioAnalytics>(`/portfolios/${encodeURIComponent(portfolioId)}/analytics`);
  return data;
}

export async function addHolding(payload: { ticker: string; quantity: number; avg_buy_price: number; buy_date: string }): Promise<void> {
  await api.post("/portfolio/holdings", payload);
}

export async function deleteHolding(holdingId: string | number): Promise<void> {
  await api.delete(`/portfolio/holdings/${holdingId}`);
}

function _normalizePortfolioResponse(data: unknown): PortfolioResponse {
  const items = Array.isArray((data as any)?.items) ? (data as any).items : [];
  const summary = (data as any)?.summary && typeof (data as any).summary === "object" ? (data as any).summary : {};
  const accounting = (data as any)?.accounting && typeof (data as any).accounting === "object"
    ? (data as any).accounting
    : null;
  return {
    items,
    summary: {
      total_cost: typeof (summary as any).total_cost === "number" ? (summary as any).total_cost : null,
      total_value: typeof (summary as any).total_value === "number" ? (summary as any).total_value : null,
      cash_balance: typeof (summary as any).cash_balance === "number" ? (summary as any).cash_balance : null,
      net_liquidation_value: typeof (summary as any).net_liquidation_value === "number" ? (summary as any).net_liquidation_value : null,
      overall_pnl: typeof (summary as any).overall_pnl === "number" ? (summary as any).overall_pnl : null,
      day_change: typeof (summary as any).day_change === "number" ? (summary as any).day_change : null,
      day_change_pct: typeof (summary as any).day_change_pct === "number" ? (summary as any).day_change_pct : null,
    },
    portfolio_id: String((data as any)?.portfolio_id || ""),
    portfolio_name: String((data as any)?.portfolio_name || "Portfolio"),
    portfolio_currency: String((data as any)?.portfolio_currency || accounting?.base_currency || ""),
    accounting: accounting ?? {
      base_currency: "",
      status: "partial",
      as_of: "",
      issues: [],
      degraded_reasons: [],
      fx_rates: [],
      known_totals: {},
    },
  };
}

// The holdings summary now comes from the caller's *own* primary portfolio, not
// the retired global (shared-across-users) table. Monetary fields are expressed
// in portfolio_currency and carry the shared accounting status/evidence.
export async function fetchPortfolio(): Promise<PortfolioResponse> {
  const { data } = await api.get<PortfolioResponse>("/portfolios/primary");
  return _normalizePortfolioResponse(data);
}

// Analytics default to the user's primary portfolio; pass an explicit
// portfolioId (the Manager does, for its selected portfolio). Both resolve on
// the backend via /portfolios/{id|primary}/analytics/*.
export async function fetchSectorAllocation(portfolioId = "primary"): Promise<SectorAllocationResponse> {
  const { data } = await api.get<SectorAllocationResponse>(`/portfolios/${encodeURIComponent(portfolioId)}/analytics/sector-allocation`);
  return data;
}

export async function fetchPortfolioRiskMetrics(params?: { risk_free_rate?: number; benchmark?: string }, portfolioId = "primary"): Promise<PortfolioRiskMetrics> {
  const { data } = await api.get<PortfolioRiskMetrics>(`/portfolios/${encodeURIComponent(portfolioId)}/analytics/risk-metrics`, { params });
  return data;
}

export async function fetchPortfolioCorrelation(params?: { window?: number }, portfolioId = "primary"): Promise<PortfolioCorrelationResponse> {
  const { data } = await api.get<PortfolioCorrelationResponse>(`/portfolios/${encodeURIComponent(portfolioId)}/analytics/correlation`, { params });
  return data;
}

export async function fetchPortfolioDividends(params?: { days?: number }, portfolioId = "primary"): Promise<PortfolioDividendTracker> {
  const { data } = await api.get<PortfolioDividendTracker>(`/portfolios/${encodeURIComponent(portfolioId)}/analytics/dividends`, { params });
  return data;
}

export async function fetchPortfolioHistory(portfolioId = "primary"): Promise<PortfolioHistory> {
  const { data } = await api.get<PortfolioHistory>(`/portfolios/${encodeURIComponent(portfolioId)}/analytics/history`);
  return data;
}

export async function fetchPortfolioBenchmarkOverlay(params?: { benchmark?: string }, portfolioId = "primary"): Promise<PortfolioBenchmarkOverlay> {
  const { data } = await api.get<PortfolioBenchmarkOverlay>(`/portfolios/${encodeURIComponent(portfolioId)}/analytics/benchmark-overlay`, { params });
  return data;
}


export async function fetchPortfolioMutualFunds(): Promise<PortfolioMutualFundsResponse> {
  const { data } = await api.get<PortfolioMutualFundsResponse>("/mutual-funds/portfolio");
  return data;
}

export async function createPaperPortfolio(payload: { name: string; initial_capital: number }): Promise<PaperPortfolio> {
  const { data } = await api.post<PaperPortfolio>("/paper/portfolios", payload);
  return data;
}

export async function fetchPaperPortfolios(): Promise<PaperPortfolio[]> {
  const { data } = await api.get<{ items: PaperPortfolio[] }>("/paper/portfolios");
  return Array.isArray(data?.items) ? data.items : [];
}

// NOTE: unused. Backend only serves the list endpoint /paper/portfolios (see
// fetchPaperPortfolios); there is no single-portfolio /paper/portfolio route.
export async function fetchPaperPortfolio(): Promise<PaperPortfolio> {
  const { data } = await api.get<PaperPortfolio>("/paper/portfolio");
  return data;
}

export async function placePaperOrder(payload: {
  portfolio_id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  order_type: string;
  price?: number;
  limit_price?: number;
  sl_price?: number;
}): Promise<PaperOrder> {
  const { data } = await api.post<PaperOrder>("/paper/orders", payload);
  return data;
}

export async function createPaperOrder(payload: {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  order_type: string;
  price?: number;
  limit_price?: number;
}): Promise<PaperOrder> {
  const { data } = await api.post<PaperOrder>("/paper/orders", payload);
  return data;
}

export async function fetchPaperOrders(portfolioId: string): Promise<PaperOrder[]> {
  const { data } = await api.get<{ items: PaperOrder[] }>(`/paper/portfolios/${encodeURIComponent(portfolioId)}/orders`);
  return Array.isArray(data?.items) ? data.items : [];
}

// NOTE: unused. Backend has no DELETE /paper/orders/{id} route (only POST /paper/orders);
// will 404 until an order-cancel endpoint is added.
export async function cancelPaperOrder(orderId: string): Promise<void> {
  await api.delete(`/paper/orders/${encodeURIComponent(orderId)}`);
}

export async function fetchPaperTrades(portfolioId: string): Promise<PaperTrade[]> {
  const { data } = await api.get<{ items: PaperTrade[] }>(`/paper/portfolios/${encodeURIComponent(portfolioId)}/trades`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchPaperPositions(portfolioId: string): Promise<PaperPosition[]> {
  const { data } = await api.get<{ items: PaperPosition[] }>(`/paper/portfolios/${encodeURIComponent(portfolioId)}/positions`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchPaperPerformance(portfolioId: string): Promise<PaperPerformance> {
  const { data } = await api.get<PaperPerformance>(`/paper/portfolios/${encodeURIComponent(portfolioId)}/performance`);
  return data;
}

export async function fetchCorrelationMatrix(payload: {
  symbols: string[];
  lookback_days?: number;
  period?: string;
  frequency?: string;
}): Promise<CorrelationMatrixResponse> {
  const { data } = await api.post<CorrelationMatrixResponse>("/correlation/matrix", payload);
  return data;
}

export async function fetchRollingCorrelation(payload: {
  symbols?: string[];
  target_symbol?: string;
  window?: number;
  lookback_days?: number;
  symbol1?: string;
  symbol2?: string;
  period?: string;
}): Promise<CorrelationRollingResponse> {
  const { data } = await api.post<CorrelationRollingResponse>("/correlation/rolling", payload);
  return data;
}

export async function fetchCorrelationClusters(payload: {
  symbols: string[];
  lookback_days?: number;
  period?: string;
  n_clusters?: number;
}): Promise<CorrelationClustersResponse> {
  const { data } = await api.post<CorrelationClustersResponse>("/correlation/clusters", payload);
  return data;
}

export async function fetchPortfolioReport(currency: string, portfolioId?: string): Promise<import("./types").ConsolidatedPortfolioReport> {
  const params = new URLSearchParams({ reporting_currency: currency });
  if (portfolioId) params.append("portfolio_id", portfolioId);
  const { data } = await api.get<import("./types").ConsolidatedPortfolioReport>("/portfolios/report", { params });
  if (!data || !Array.isArray(data.positions) || !Array.isArray(data.portfolios) || !data.metrics) throw new Error("Portfolio reporting contract is unavailable");
  return data;
}

export async function fetchPortfolioOperation(portfolioId: string, operationId: string): Promise<{id: string; status: string; portfolio_id: string; type: string}> {
  const { data } = await api.get(`/portfolios/${encodeURIComponent(portfolioId)}/operations/${encodeURIComponent(operationId)}`);
  return data;
}
