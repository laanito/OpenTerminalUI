import type { ReactNode } from "react";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchBacktestV1Presets,
  fetchLatestNews,
  fetchPortfolio,
  fetchPortfolioBenchmarkOverlay,
  fetchQuotesBatch,
  fetchWatchlist,
} from "../api/client";
import { fetchChainSummary } from "../fno/api/fnoApi";
import { HomePage } from "../pages/HomePage";

const navigateSpy = vi.fn();
const settings = vi.hoisted(() => ({ selectedMarket: "NSE" }));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

vi.mock("../components/layout/TerminalShell", () => ({
  TerminalShell: ({
    children,
    statusBarTickerOverride,
  }: {
    children: ReactNode;
    statusBarTickerOverride?: string;
  }) => (
    <div data-testid="terminal-shell" data-status-bar={statusBarTickerOverride}>
      {children}
    </div>
  ),
}));

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "desk@openterminal.dev",
      role: "trader",
    },
  }),
}));

vi.mock("../store/settingsStore", () => ({
  useSettingsStore: (
    selector: (state: {
      selectedMarket: string;
      displayCurrency: "INR" | "USD";
      realtimeMode: "polling" | "ws";
      newsAutoRefresh: boolean;
      newsRefreshSec: number;
    }) => unknown,
  ) =>
    selector({
      selectedMarket: settings.selectedMarket,
      displayCurrency: "INR",
      realtimeMode: "polling",
      newsAutoRefresh: true,
      newsRefreshSec: 60,
    }),
}));

vi.mock("../api/client", () => ({
  fetchPortfolio: vi.fn(),
  fetchWatchlist: vi.fn(),
  fetchBacktestV1Presets: vi.fn(),
  fetchPortfolioBenchmarkOverlay: vi.fn(),
  fetchLatestNews: vi.fn(),
  fetchQuotesBatch: vi.fn(),
}));

vi.mock("../fno/api/fnoApi", () => ({
  fetchChainSummary: vi.fn(),
}));

// Home history tests do not exercise model health or generation.
vi.mock("../components/terminal/AiInsightCard", () => ({ AiInsightCard: () => null }));

// Layout-focused test: stub the currency hook so it doesn't pull react-query
// (cross-rates / market-status) into the render without a QueryClientProvider.
vi.mock("../hooks/useDisplayCurrency", () => ({
  useDisplayCurrency: () => ({
    displayCurrency: "USD",
    marketNative: "USD",
    nativeFor: () => "USD",
    convertAmount: (v: number) => v,
    formatMoney: (v: number | null | undefined) => (v == null ? "-" : `$${v}`),
    formatSignedMoney: (v: number | null | undefined) => (v == null ? "-" : `$${v}`),
    formatCompactMoney: (v: number | null | undefined) => (v == null ? "-" : `$${v}`),
    formatDisplayMoney: (v: number | null | undefined) => (v == null ? "-" : `$${v}`),
    financialUnit: "M",
    scaleFinancialAmount: (v: number) => v,
    formatFinancialCompact: (v: number | null | undefined) => (v == null ? "-" : `$${v}`),
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <HomePage />
    </MemoryRouter>,
  );
}

describe("HomePage mission-control revamp", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-11T12:00:00Z"));
    navigateSpy.mockReset();
    sessionStorage.clear();
    settings.selectedMarket = "NSE";

    vi.mocked(fetchPortfolio).mockResolvedValue({
      items: [
        { current_value: 1000000 },
        { current_value: 1480000 },
      ],
      summary: {
        total_cost: 2310000,
        total_value: 2480000,
        cash_balance: 0,
        net_liquidation_value: 2480000,
        overall_pnl: 170000,
        day_change: 12000,
        day_change_pct: 0.48,
      },
      portfolio_id: "portfolio-1",
      portfolio_name: "Primary",
      portfolio_currency: "USD",
      accounting: {
        base_currency: "USD",
        status: "complete",
        as_of: "2026-03-11T12:00:00Z",
        issues: [],
        degraded_reasons: [],
        fx_rates: [],
        known_totals: {},
      },
    } as any);

    vi.mocked(fetchWatchlist).mockResolvedValue([
      { has_futures: true, has_options: false },
      { has_futures: false, has_options: false },
      { has_futures: false, has_options: true },
    ] as any);

    vi.mocked(fetchBacktestV1Presets).mockResolvedValue([{ id: "preset-1" }, { id: "preset-2" }] as any);

    vi.mocked(fetchChainSummary).mockResolvedValue({
      spot_price: 22345.65,
      pcr: {
        pcr_oi: 0.91,
        signal: "bullish",
      },
    } as any);

    vi.mocked(fetchPortfolioBenchmarkOverlay).mockResolvedValue({
      benchmark: "NIFTY50",
      base_currency: "USD", status: "complete", methodology: "current_open_holdings_constant_quantity", issues: [], degraded_reasons: [],
      alpha: 0.02,
      tracking_error: 0.12,
      equity_curve: [
        { date: "2026-02-20", portfolio: 2300000, benchmark: 2210000 },
        { date: "2026-02-27", portfolio: 2380000, benchmark: 2260000 },
        { date: "2026-03-05", portfolio: 2440000, benchmark: 2310000 },
        { date: "2026-03-10", portfolio: 2480000, benchmark: 2350000 },
      ],
    } as any);

    vi.mocked(fetchLatestNews).mockResolvedValue([
      {
        id: "news-1",
        title: "RBI signals steady liquidity support for domestic markets",
        source: "Reuters",
        url: "https://example.com/rbi-liquidity",
        published_at: "2026-03-11T10:15:00.000Z",
        sentiment: {
          label: "Bullish",
          confidence: 0.87,
          score: 0.42,
        },
      },
      {
        id: "news-2",
        title: "Semiconductor rally lifts NASDAQ futures into the open",
        source: "Bloomberg",
        url: "https://example.com/nasdaq-futures",
        published_at: "2026-03-11T09:45:00.000Z",
      },
    ] as any);

    vi.mocked(fetchQuotesBatch).mockResolvedValue({
      market: "NSE",
      quotes: [
        { symbol: "^NSEI", last: 22450.25, change: 145.1, changePct: 0.65, ts: "2026-03-11T12:00:00.000Z" },
        { symbol: "^BSESN", last: 73900.12, change: -120.2, changePct: -0.16, ts: "2026-03-11T12:00:00.000Z" },
        { symbol: "^IXIC", last: 18340.22, change: 88.4, changePct: 0.48, ts: "2026-03-11T12:00:00.000Z" },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  function history() { return screen.getByRole("region", { name: "Primary portfolio historical comparison" }); }
  it("shows indexed open holdings with explicit scope and methodology, independently of today's net liquidation value", async () => {
    renderPage();
    await waitFor(() => expect(history()).toHaveTextContent("History available"));
    expect(history()).toHaveTextContent("Primary portfolio · Primary");
    expect(history()).toHaveTextContent("excludes cash, closed positions and transaction-ledger returns");
    expect(history()).toHaveTextContent("Open holdings 107.83 index");
    expect(history()).toHaveTextContent("Benchmark (NIFTY50) 106.33 index");
    expect(history()).not.toHaveTextContent("$2480000");
    expect(history()).not.toHaveTextContent("Synced");
    expect(screen.queryByRole("img", { name: "Net liquidation trend" })).not.toBeInTheDocument();
  });
  it.each(["failed", "empty", "old"])("shows an honest empty state for %s history instead of sample values", async (kind) => {
    if (kind === "failed") vi.mocked(fetchPortfolioBenchmarkOverlay).mockRejectedValue(new Error("Unavailable"));
    else vi.mocked(fetchPortfolioBenchmarkOverlay).mockResolvedValue({ base_currency: "USD", status: "complete",
      methodology: "current_open_holdings_constant_quantity", benchmark: "SPY", issues: [], degraded_reasons: [],
      equity_curve: kind === "old" ? [{ date: "2025-01-01", portfolio: 1, benchmark: 1 }, { date: "2025-01-02", portfolio: 2, benchmark: 2 }] : [], alpha: 0, tracking_error: 0 });
    renderPage();
    await waitFor(() => expect(history()).toHaveTextContent("History unavailable"));
    expect(within(history()).queryByRole("group", { name: "Primary open-holdings indexed comparison" })).not.toBeInTheDocument();
    expect(history().querySelector("svg")).toBeNull(); expect(history()).not.toHaveTextContent("24300000");
  });
  it("clears a previously valid curve when the next refresh fails and does not overlap polls", async () => {
    const interval = vi.spyOn(window, "setInterval");
    renderPage();
    await waitFor(() => expect(history()).toHaveTextContent("History available"));
    const poll = interval.mock.calls.find(([, delay]) => delay === 30000)![0] as () => void;
    let reject!: (reason: Error) => void;
    vi.mocked(fetchPortfolioBenchmarkOverlay).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    act(() => { poll(); poll(); });
    await waitFor(() => expect(fetchPortfolioBenchmarkOverlay).toHaveBeenCalledTimes(2));
    expect(history()).toHaveTextContent("Loading history"); expect(history().querySelector("svg")).toBeNull();
    await act(async () => reject(new Error("History failed")));
    await waitFor(() => expect(history()).toHaveTextContent("History unavailable"));
    expect(history()).toHaveTextContent("No previous curve is shown"); expect(history().querySelector("svg")).toBeNull();
    interval.mockRestore();
  });
  it("ignores an earlier scope response and does not fetch its analytics after the scope changes", async () => {
    const original = await vi.mocked(fetchPortfolio)();
    let finish!: (value: typeof original) => void;
    vi.mocked(fetchPortfolio).mockClear();
    vi.mocked(fetchPortfolio).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue({ ...original, portfolio_id: "new-primary", portfolio_name: "New primary" });
    const view = renderPage();
    settings.selectedMarket = "US";
    view.rerender(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><HomePage /></MemoryRouter>);
    await waitFor(() => expect(history()).toHaveTextContent("Primary portfolio · New primary"));
    await act(async () => finish({ ...original, portfolio_id: "old-primary", portfolio_name: "Old primary" }));
    expect(history()).not.toHaveTextContent("Old primary");
    expect(fetchPortfolioBenchmarkOverlay).toHaveBeenCalledExactlyOnceWith(undefined, "new-primary");
  });
  it("does not request historical analytics for an empty primary portfolio", async () => {
    const original = await vi.mocked(fetchPortfolio)();
    vi.mocked(fetchPortfolio).mockClear(); vi.mocked(fetchPortfolio).mockResolvedValue({ ...original, items: [] });
    renderPage(); await waitFor(() => expect(history()).toHaveTextContent("No open holdings in the primary portfolio"));
    expect(fetchPortfolioBenchmarkOverlay).not.toHaveBeenCalled();
  });
  it("preserves the existing loaders while rendering the new mission-control layout", async () => {
    renderPage();

    await waitFor(() => {
      expect(fetchPortfolio).toHaveBeenCalledTimes(1);
      expect(fetchWatchlist).toHaveBeenCalledTimes(1);
      expect(fetchBacktestV1Presets).toHaveBeenCalledTimes(1);
      expect(fetchChainSummary).toHaveBeenCalledWith("SPY");
      expect(fetchPortfolioBenchmarkOverlay).toHaveBeenCalledWith(undefined, "portfolio-1");
      expect(fetchLatestNews).toHaveBeenCalledWith(15);
      expect(fetchQuotesBatch).toHaveBeenCalledWith(
        ["^GSPC", "^IXIC", "^DJI", "GC=F", "SI=F", "CL=F"],
        "NSE",
      );
    });

    expect(screen.getByTestId("terminal-shell")).toHaveAttribute("data-status-bar", "MISSION CONTROL");
    expect(screen.getByRole("list", { name: "Market heat strip" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Portfolio HQ" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "System Health" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Launch Matrix" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Economics.*Configuration:.*FRED_API_KEY/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /F&O.*Configuration:.*Kite credentials/i })).toBeInTheDocument();

    expect(screen.getAllByText("$2480000").length).toBeGreaterThan(0);
    expect(screen.getByText("$170000 (+7.36%)")).toBeInTheDocument();
    expect(screen.getByText("COMPLETE")).toBeInTheDocument();
    expect(screen.getByText("RBI signals steady liquidity support for domestic markets")).toBeInTheDocument();
    expect(screen.getByText("Bullish 87%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Workstation\. WORKSPACE desk access/i }));
    expect(navigateSpy).toHaveBeenCalledWith("/equity/chart-workstation");
  }, 10000);

  it("preserves the transition loading overlay before revealing the dashboard", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ now: new Date("2026-03-11T12:00:00.000Z") });
    sessionStorage.setItem("ot-terminal-transition", "1");

    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Initializing Mission Control");
    expect(screen.queryByRole("main", { name: "Mission Control Dashboard" })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(screen.getByRole("main", { name: "Mission Control Dashboard" })).toBeInTheDocument();
    expect(sessionStorage.getItem("ot-terminal-transition")).toBeNull();
  }, 10000);
});
