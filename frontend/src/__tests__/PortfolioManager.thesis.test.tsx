import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PortfolioManager } from "../components/portfolio/PortfolioManager";

const fetchPortfoliosMock = vi.fn();
const createPortfolioMock = vi.fn();
const updatePortfolioMock = vi.fn();

vi.mock("../api/client", () => ({
  addPortfolioHolding: vi.fn(),
  addPortfolioTransaction: vi.fn(),
  createPortfolio: (...args: unknown[]) => createPortfolioMock(...args),
  deletePortfolioById: vi.fn(),
  fetchAiRiskInsights: vi.fn(),
  fetchPortfolioAnalyticsV2: vi.fn(async () => ({})),
  fetchPortfolioBenchmarkOverlay: vi.fn(async () => null),
  fetchPortfolioCorrelation: vi.fn(async () => null),
  fetchPortfolioDividends: vi.fn(async () => null),
  fetchPortfolioHoldings: vi.fn(async () => []),
  fetchPortfolioRiskMetrics: vi.fn(async () => null),
  fetchPortfolioTransactions: vi.fn(async () => []),
  fetchPortfolios: (...args: unknown[]) => fetchPortfoliosMock(...args),
  updatePortfolioById: (...args: unknown[]) => updatePortfolioMock(...args),
}));

vi.mock("../hooks/useDisplayCurrency", () => ({
  useDisplayCurrency: () => ({
    formatMoney: (value: number | null | undefined) => String(value ?? "-"),
    formatCompactMoney: (value: number | null | undefined) => String(value ?? "-"),
    nativeFor: () => "USD",
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
    vi.clearAllMocks();
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
      }),
    );
  });

  it("captures a thesis when creating a portfolio", async () => {
    fetchPortfoliosMock.mockResolvedValue([]);
    createPortfolioMock.mockResolvedValue({ id: "p2", name: "Macro" });
    render(<PortfolioManager />);

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
});
