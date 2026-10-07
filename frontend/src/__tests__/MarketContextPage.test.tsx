import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureMarketFundamentals, compareMarketContext, compareMarketFundamentalCaptures, fetchMarketContextFundamentalReleases, fetchMarketContextHeadlines, fetchMarketContextMacroEvents, fetchMarketSecFiledFacts, getMarketFundamentalCapture, listMarketFundamentalCaptures } from "../api/marketContext";
import { searchSymbols } from "../api/marketData";
import { MarketContextPage } from "../pages/MarketContextPage";

vi.mock("../api/marketContext", () => ({ captureMarketFundamentals: vi.fn(), compareMarketContext: vi.fn(), compareMarketFundamentalCaptures: vi.fn(), fetchMarketContextFundamentalReleases: vi.fn(), fetchMarketContextHeadlines: vi.fn(), fetchMarketContextMacroEvents: vi.fn(), fetchMarketSecFiledFacts: vi.fn(), getMarketFundamentalCapture: vi.fn(), listMarketFundamentalCaptures: vi.fn() }));
vi.mock("../api/marketData", () => ({ searchSymbols: vi.fn() }));

const compareMock = vi.mocked(compareMarketContext);
const headlinesMock = vi.mocked(fetchMarketContextHeadlines);
const macroMock = vi.mocked(fetchMarketContextMacroEvents);
const fundamentalsMock = vi.mocked(fetchMarketContextFundamentalReleases);
const secFactsMock = vi.mocked(fetchMarketSecFiledFacts);
const captureMock = vi.mocked(captureMarketFundamentals);
const compareCapturesMock = vi.mocked(compareMarketFundamentalCaptures);
const listCapturesMock = vi.mocked(listMarketFundamentalCaptures);
const getCaptureMock = vi.mocked(getMarketFundamentalCapture);
const searchMock = vi.mocked(searchSymbols);

function renderPage(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/equity/market-context" element={<MarketContextPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MarketContextPage", () => {
  beforeEach(() => {
    compareMock.mockReset();
    headlinesMock.mockReset();
    macroMock.mockReset();
    fundamentalsMock.mockReset();
    secFactsMock.mockReset();
    captureMock.mockReset();
    compareCapturesMock.mockReset();
    listCapturesMock.mockReset().mockResolvedValue([]);
    getCaptureMock.mockReset();
    searchMock.mockReset();
  });

  it("shows dated available, stale, and unavailable comparisons without inventing returns", async () => {
    compareMock.mockResolvedValue({
      anchor: "BTC-USD",
      period: "1M",
      retrieved_at: "2026-09-24T10:00:00Z",
      data_source: "unified_history",
      return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes",
      comparisons: [
        {
          symbol: "SPY", status: "available", reason: null,
          start_date: "2026-08-25", end_date: "2026-09-23",
          anchor_latest_date: "2026-09-24", comparison_latest_date: "2026-09-23",
          anchor_history_source: "crypto", comparison_history_source: "yahoo",
          anchor_history_feed: "yahoo_chart", comparison_history_feed: "yahoo_chart",
          anchor_close_date_conflicts: { provider_close_count: 1, provider_close_dates: ["2026-09-03"], adjusted_close_count: 0, adjusted_close_dates: [], display_limit: 20 },
          comparison_close_date_conflicts: { provider_close_count: 0, provider_close_dates: [], adjusted_close_count: 1, adjusted_close_dates: ["2026-09-04"], display_limit: 20 },
          anchor_reported_adjustment_basis: "unspecified", comparison_reported_adjustment_basis: "unspecified",
          observations: 21, freshness: "current",
          anchor_return_pct: 5.25, comparison_return_pct: 2.1, relative_return_pp: 3.15,
          technical_observations: {
            basis: "shared_utc_date_provider_closes", as_of_date: "2026-09-23",
            anchor: { max_drawdown_pct: 12.5, max_drawdown_peak_date: "2026-09-01", max_drawdown_trough_date: "2026-09-05", sma20_gap_pct: 3.25 },
            comparison: { max_drawdown_pct: 0, max_drawdown_peak_date: null, max_drawdown_trough_date: null, sma20_gap_pct: null },
          },
          native_technical_observations: {
            basis: "per_asset_utc_date_provider_closes_within_pair_window",
            anchor: { start_date: "2026-08-25", end_date: "2026-09-23", observations: 30, additional_dates_vs_pair: 9,
              technical_measures: { max_drawdown_pct: 10, max_drawdown_peak_date: "2026-09-02", max_drawdown_trough_date: "2026-09-06", sma20_gap_pct: 2.5 } },
            comparison: { start_date: "2026-08-25", end_date: "2026-09-23", observations: 21, additional_dates_vs_pair: 0,
              technical_measures: { max_drawdown_pct: 0, max_drawdown_peak_date: null, max_drawdown_trough_date: null, sma20_gap_pct: 1 } },
          },
          action_disclosure: {
            anchor: { source: "unavailable", matched_count: 0, display_limit: 20, actions: [] },
            comparison: { source: "yahoo_chart", matched_count: 1, display_limit: 20, actions: [{ date: "2026-09-10", type: "dividend" }] },
          },
          adjusted_close_coverage: {
            anchor: { status: "unavailable", source: null, available_observations: 0, shared_observations: 21 },
            comparison: { status: "partial", source: "yahoo_adjclose", available_observations: 20, shared_observations: 21 },
          },
          points: [
            { date: "2026-08-25", anchor_index: 100, comparison_index: 100 },
            { date: "2026-09-23", anchor_index: 105.25, comparison_index: 102.1 },
          ],
        },
        {
          symbol: "QQQ", status: "available", reason: null,
          start_date: "2026-08-25", end_date: "2026-09-10",
          anchor_latest_date: "2026-09-24", comparison_latest_date: "2026-09-10",
          anchor_history_source: "crypto", comparison_history_source: "alpaca",
          comparison_history_feed: "alpaca_stocks_bars:iex:raw",
          anchor_reported_adjustment_basis: "unspecified", comparison_reported_adjustment_basis: "raw",
          observations: 12, freshness: "stale",
          anchor_return_pct: 4, comparison_return_pct: 1, relative_return_pp: 3,
          points: [
            { date: "2026-08-25", anchor_index: 100, comparison_index: 100 },
            { date: "2026-09-10", anchor_index: 104, comparison_index: 101 },
          ],
        },
        {
          symbol: "SAP.DE", status: "unavailable", reason: "provider_error",
          start_date: null, end_date: null,
          anchor_latest_date: null, comparison_latest_date: null,
          anchor_history_source: null, comparison_history_source: null,
          observations: null, freshness: null,
          anchor_return_pct: null, comparison_return_pct: null, relative_return_pp: null,
          points: [],
        },
      ],
    });
    renderPage("/equity/market-context?symbol=BTC-USD&proxies=SPY,QQQ,SAP.DE");

    expect(await screen.findByText("BTC-USD vs SPY")).toBeInTheDocument();
    expect(compareMock).toHaveBeenCalledWith("BTC-USD", ["SPY", "QQQ", "SAP.DE"], "1M");
    expect(screen.getByText("+5.25%")).toBeInTheDocument();
    expect(screen.getByText("+3.15 pp")).toBeInTheDocument();
    expect(screen.getByText("Stale history")).toBeInTheDocument();
    expect(screen.getByText(/BTC-USD Crypto adapter → Yahoo chart · SPY Yahoo Finance → Yahoo chart/)).toBeInTheDocument();
    expect(screen.getByText(/BTC-USD: provider closes 1 \(2026-09-03\)/)).toBeInTheDocument();
    expect(screen.getByText(/SPY: provider closes 0 \(none\); Yahoo adjusted closes 1 \(2026-09-04\)/)).toBeInTheDocument();
    expect(screen.getByText(/QQQ Alpaca → stock bars \(IEX feed, raw\)/)).toBeInTheDocument();
    expect(screen.getByText(/BTC-USD adjustment basis not verified · SPY adjustment basis not verified/)).toBeInTheDocument();
    expect(screen.getByText(/QQQ raw requested \(provider-reported\)/)).toBeInTheDocument();
    expect(screen.getByText(/History provider failed; no comparison was calculated/)).toBeInTheDocument();
    expect(screen.getByText(/SAP.DE no usable history/)).toBeInTheDocument();
    expect(screen.getByText(/not FX-normalized/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Indexed daily-close paths/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show aligned price paths for BTC-USD vs SPY" }));
    expect(screen.getByRole("img", { name: /Indexed daily-close paths for BTC-USD and SPY/ })).toBeInTheDocument();
    expect(screen.getByText(/Both paths start at 100 on the first shared close/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show observed technical measures for BTC-USD vs SPY" }));
    expect(screen.getByText(/Maximum observed drawdown: 12.50%/)).toBeInTheDocument();
    expect(screen.getByText(/20-shared-close average gap: \+3.25%/)).toBeInTheDocument();
    expect(screen.getByText(/Unavailable \(fewer than 20 shared closes\)/)).toBeInTheDocument();
    expect(screen.getByText(/Crypto weekend closes are omitted/)).toBeInTheDocument();
    expect(screen.getByText("BTC-USD own-date measures")).toBeInTheDocument();
    expect(screen.getByText(/30 closes, 2026-08-25 to 2026-09-23 · 9 dates beyond pair overlap/)).toBeInTheDocument();
    expect(screen.getByText(/20-own-close average gap: \+2.50%/)).toBeInTheDocument();
    expect(screen.getByText("2026-09-10 · dividend")).toBeInTheDocument();
    expect(screen.getByText(/Action metadata unavailable from the selected history path/)).toBeInTheDocument();
    expect(screen.getByText(/not a complete action audit/)).toBeInTheDocument();
    expect(screen.getByText(/SPY: partial · 20\/21 shared closes from Yahoo adjclose/)).toBeInTheDocument();
    expect(screen.getByText(/Adjusted pair unavailable unless both symbols have Yahoo-adjusted closes/)).toBeInTheDocument();
    expect(screen.getByText(/BTC-USD: No usable provider-adjusted closes/)).toBeInTheDocument();
    expect(screen.getByText(/primary chart, returns, and measures above use the selected providers’ quote closes/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText("View exact aligned observations"));
    expect(screen.getByRole("columnheader", { name: "BTC-USD index" })).toBeInTheDocument();
    expect(screen.getByText("105.25")).toBeInTheDocument();
  });

  it("shows a separate adjusted pair only with complete same-date coverage", async () => {
    compareMock.mockResolvedValue({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-24T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes", comparisons: [{
        symbol: "SPY", status: "available", reason: null,
        start_date: "2026-09-02", end_date: "2026-09-10",
        anchor_latest_date: "2026-09-10", comparison_latest_date: "2026-09-10",
        anchor_history_source: "yahoo", comparison_history_source: "yahoo",
        observations: 2, freshness: "current",
        anchor_return_pct: 2, comparison_return_pct: 1, relative_return_pp: 1,
        technical_observations: {
          basis: "shared_utc_date_provider_closes", as_of_date: "2026-09-10",
          anchor: { max_drawdown_pct: 0, max_drawdown_peak_date: null, max_drawdown_trough_date: null, sma20_gap_pct: null },
          comparison: { max_drawdown_pct: 0, max_drawdown_peak_date: null, max_drawdown_trough_date: null, sma20_gap_pct: null },
        },
        adjusted_close_coverage: {
          anchor: { status: "complete", source: "yahoo_adjclose", available_observations: 2, shared_observations: 2 },
          comparison: { status: "complete", source: "yahoo_adjclose", available_observations: 2, shared_observations: 2 },
        },
        adjusted_pair: {
          basis: "shared_utc_date_provider_adjusted_closes", source: "yahoo_adjclose",
          start_date: "2026-09-02", end_date: "2026-09-10", observations: 2,
          anchor_return_pct: 3, comparison_return_pct: 1.5, relative_return_pp: 1.5,
          points: [
            { date: "2026-09-02", anchor_index: 100, comparison_index: 100 },
            { date: "2026-09-10", anchor_index: 103, comparison_index: 101.5 },
          ],
        },
        points: [
          { date: "2026-09-02", anchor_index: 100, comparison_index: 100 },
          { date: "2026-09-10", anchor_index: 102, comparison_index: 101 },
        ],
      }],
    });
    renderPage("/equity/market-context?symbol=AAPL&proxies=SPY");
    expect(await screen.findByText("AAPL vs SPY")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show observed technical measures for AAPL vs SPY" }));
    expect(screen.getByText("Separate adjusted pair comparison")).toBeInTheDocument();
    expect(screen.getByText(/Adjusted return difference: \+1.50 pp/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("View exact adjusted pair observations"));
    expect(screen.getByRole("columnheader", { name: "AAPL adjusted index" })).toBeInTheDocument();
    expect(screen.getByText("103.00")).toBeInTheDocument();
    expect(screen.getByText("+2.00%")).toBeInTheDocument();
  });

  it("shows provider-adjusted observations separately without changing primary returns", async () => {
    compareMock.mockResolvedValue({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-24T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes", comparisons: [{
        symbol: "SPY", status: "available", reason: null,
        start_date: "2026-08-25", end_date: "2026-09-23",
        anchor_latest_date: "2026-09-23", comparison_latest_date: "2026-09-23",
        anchor_history_source: "yahoo", comparison_history_source: "fmp",
        comparison_history_feed: "fmp_historical_price_non_split_adjusted",
        anchor_reported_adjustment_basis: "unspecified", comparison_reported_adjustment_basis: "non_split_adjusted",
        observations: 21, freshness: "current",
        anchor_return_pct: 5, comparison_return_pct: 2, relative_return_pp: 3,
        technical_observations: {
          basis: "shared_utc_date_provider_closes", as_of_date: "2026-09-23",
          anchor: { max_drawdown_pct: 5, max_drawdown_peak_date: "2026-09-01", max_drawdown_trough_date: "2026-09-05", sma20_gap_pct: 1 },
          comparison: { max_drawdown_pct: 2, max_drawdown_peak_date: "2026-09-01", max_drawdown_trough_date: "2026-09-05", sma20_gap_pct: 0.5 },
        },
        adjusted_close_coverage: {
          anchor: { status: "complete", source: "yahoo_adjclose", available_observations: 21, shared_observations: 21 },
          comparison: { status: "unavailable", source: null, available_observations: 0, shared_observations: 21 },
        },
        adjusted_observations: {
          basis: "shared_utc_date_provider_adjusted_closes", source: "yahoo_adjclose", as_of_date: "2026-09-23",
          anchor: { return_pct: 6.5, technical_measures: { max_drawdown_pct: 4.25, max_drawdown_peak_date: "2026-09-01", max_drawdown_trough_date: "2026-09-05", sma20_gap_pct: 1.5 } },
          comparison: null,
        },
        native_adjusted_close_coverage: {
          anchor: { status: "complete", source: "yahoo_adjclose", available_observations: 23, native_observations: 23 },
          comparison: { status: "unavailable", source: null, available_observations: 0, native_observations: 21 },
        },
        native_adjusted_observations: {
          basis: "per_asset_utc_date_provider_adjusted_closes_within_pair_window", source: "yahoo_adjclose",
          anchor: {
            start_date: "2026-08-25", end_date: "2026-09-23", observations: 23, additional_dates_vs_pair: 2,
            return_pct: 6.5, technical_measures: { max_drawdown_pct: 3.5, max_drawdown_peak_date: "2026-09-01", max_drawdown_trough_date: "2026-09-05", sma20_gap_pct: 2.2 },
          },
          comparison: null,
        },
        points: [{ date: "2026-08-25", anchor_index: 100, comparison_index: 100 }, { date: "2026-09-23", anchor_index: 105, comparison_index: 102 }],
      }],
    });
    renderPage("/equity/market-context?symbol=AAPL&proxies=SPY");
    expect(await screen.findByText("AAPL vs SPY")).toBeInTheDocument();
    expect(screen.getByText("+5.00%")).toBeInTheDocument();
    expect(screen.getByText(/SPY FMP → FMP EOD bars \(non-split-adjusted\)/)).toBeInTheDocument();
    expect(screen.getByText(/SPY non-split-adjusted requested \(provider-reported\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show observed technical measures for AAPL vs SPY" }));
    expect(screen.getAllByText("Adjusted return: +6.50%")).toHaveLength(2);
    expect(screen.getByText("Maximum observed drawdown: 4.25%")).toBeInTheDocument();
    expect(screen.getByText("Unavailable without complete Yahoo-adjusted coverage.")).toBeInTheDocument();
    expect(screen.getByText(/not verified trading signals/)).toBeInTheDocument();
    expect(screen.getByText("Each asset’s own-date adjusted closes")).toBeInTheDocument();
    expect(screen.getByText(/23 closes · 2 beyond pair overlap/)).toBeInTheDocument();
    expect(screen.getByText("20-own-close average gap: +2.20%")).toBeInTheDocument();
    expect(screen.getByText("Own-date adjusted measures unavailable without complete coverage.")).toBeInTheDocument();
  });

  it("validates editable symbols before applying a new query", async () => {
    compareMock.mockResolvedValue({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-24T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes", comparisons: [],
    });
    renderPage("/equity/market-context?symbol=AAPL&proxies=SPY");
    await waitFor(() => expect(compareMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole("textbox", { name: "Comparison symbols" }), { target: { value: "AAPL" } });
    fireEvent.click(screen.getByRole("button", { name: "Compare dated moves" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The anchor cannot also be a comparison symbol.");
    expect(compareMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("textbox", { name: "Comparison symbols" }), { target: { value: "QQQ, BTC-USD" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Window" }), { target: { value: "3M" } });
    fireEvent.click(screen.getByRole("button", { name: "Compare dated moves" }));
    await waitFor(() => expect(compareMock).toHaveBeenCalledWith("AAPL", ["QQQ", "BTC-USD"], "3M"));
  });

  it("does not fetch invalid shared URLs", () => {
    renderPage("/equity/market-context?symbol=AAPL&proxies=bad%20symbol");
    expect(screen.getByRole("alert")).toHaveTextContent("One or more comparison symbols are invalid.");
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("offers retry after the comparison request fails", async () => {
    compareMock.mockRejectedValueOnce(new Error("Provider temporarily unavailable"));
    compareMock.mockResolvedValueOnce({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-24T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes", comparisons: [],
    });
    renderPage("/equity/market-context?symbol=AAPL&proxies=SPY");
    expect(await screen.findByRole("alert")).toHaveTextContent("Provider temporarily unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(compareMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Requested 1M; retrieved/)).toBeInTheDocument();
  });

  it("adds suggested proxies and searched symbols without comparing until Apply", async () => {
    compareMock.mockResolvedValue({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-24T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes", comparisons: [],
    });
    searchMock.mockResolvedValue([
      { ticker: "SAP.DE", name: "SAP", exchange: "XETRA" },
      { ticker: "AAPL", name: "Apple", exchange: "NASDAQ" },
    ]);
    renderPage("/equity/market-context?symbol=AAPL&proxies=SPY");
    await waitFor(() => expect(compareMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Add BTC-USD" }));
    expect(screen.getByRole("textbox", { name: "Comparison symbols" })).toHaveValue("SPY, BTC-USD");
    expect(compareMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("combobox", { name: "Find a proxy to add" }), { target: { value: "SAP" } });
    expect(await screen.findByRole("option", { name: /SAP.DE/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /AAPL/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /SAP.DE/ }));
    expect(screen.getByRole("textbox", { name: "Comparison symbols" })).toHaveValue("SPY, BTC-USD, SAP.DE");
    expect(compareMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Compare dated moves" }));
    await waitFor(() => expect(compareMock).toHaveBeenCalledWith("AAPL", ["SPY", "BTC-USD", "SAP.DE"], "1M"));
  });

  it("enforces the proxy limit and keeps manual entry available when lookup fails", async () => {
    compareMock.mockResolvedValue({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-24T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes", comparisons: [],
    });
    searchMock.mockRejectedValue(new Error("Search unavailable"));
    renderPage("/equity/market-context?symbol=AAPL&proxies=SPY,QQQ,BTC-USD,SAP.DE,MSFT,GOOG");
    await waitFor(() => expect(compareMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Add ETH-USD" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose no more than six comparison symbols.");
    expect(screen.getByRole("textbox", { name: "Comparison symbols" })).toHaveValue("SPY,QQQ,BTC-USD,SAP.DE,MSFT,GOOG");

    fireEvent.change(screen.getByRole("combobox", { name: "Find a proxy to add" }), { target: { value: "IBM" } });
    expect(await screen.findByText("Suggestions unavailable; enter a symbol manually.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Comparison symbols" })).toBeInTheDocument();
  });

  it("accepts a keyboard-picked anchor without submitting the form", async () => {
    compareMock.mockResolvedValue({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-24T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes", comparisons: [],
    });
    searchMock.mockResolvedValue([{ ticker: "TSLA", name: "Tesla", exchange: "NASDAQ" }]);
    renderPage("/equity/market-context?symbol=AAPL&proxies=SPY");
    await waitFor(() => expect(compareMock).toHaveBeenCalledTimes(1));

    const anchor = screen.getByRole("combobox", { name: "Anchor symbol" });
    fireEvent.change(anchor, { target: { value: "TSL" } });
    expect(await screen.findByRole("option", { name: /TSLA/ })).toBeInTheDocument();
    fireEvent.keyDown(anchor, { key: "Enter" });
    expect(anchor).toHaveValue("TSLA");
    expect(compareMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Compare dated moves" }));
    await waitFor(() => expect(compareMock).toHaveBeenCalledWith("TSLA", ["SPY"], "1M"));
  });

  it("loads limited, source-linked headlines only on demand for the actual pair window", async () => {
    compareMock.mockResolvedValue({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-11T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes", comparisons: [{
        symbol: "SPY", status: "available", reason: null,
        start_date: "2026-09-02", end_date: "2026-09-10",
        anchor_latest_date: "2026-09-10", comparison_latest_date: "2026-09-10",
        anchor_history_source: "yahoo", comparison_history_source: "yahoo",
        observations: 7, freshness: "current", anchor_return_pct: 2,
        comparison_return_pct: 1, relative_return_pp: 1,
        points: [
          { date: "2026-09-02", anchor_index: 100, comparison_index: 100 },
          { date: "2026-09-10", anchor_index: 102, comparison_index: 101 },
        ],
      }],
    });
    headlinesMock.mockResolvedValue({
      anchor: "AAPL", comparison: "SPY", start_date: "2026-09-02", end_date: "2026-09-10",
      retrieved_at: "2026-09-11T10:01:00Z", source: "current_keyless_feeds",
      fetch_limit_per_symbol: 50, display_limit_per_symbol: 8,
      groups: [
        { symbol: "AAPL", status: "available", examined_count: 20, matched_count: 1, headlines: [
          { title: "Apple supply update", url: "https://example.com/apple", source: "Example Wire", published_at: "2026-09-05T10:00:00Z" },
        ] },
        { symbol: "SPY", status: "available", examined_count: 20, matched_count: 0, headlines: [] },
      ],
    });
    renderPage("/equity/market-context?symbol=AAPL&proxies=SPY");
    expect(await screen.findByText("AAPL vs SPY")).toBeInTheDocument();
    expect(headlinesMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show dated headlines for AAPL vs SPY" }));
    await waitFor(() => expect(headlinesMock).toHaveBeenCalledWith("AAPL", "SPY", "2026-09-02", "2026-09-10"));
    expect(await screen.findByRole("link", { name: "Apple supply update" })).toHaveAttribute("href", "https://example.com/apple");
    expect(screen.getByText(/not a cause of these moves/)).toBeInTheDocument();
    expect(screen.getByText(/this does not mean no news occurred/)).toBeInTheDocument();
  });

  it("shows live-only macro calendar availability for the actual pair window", async () => {
    compareMock.mockResolvedValue({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-11T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes", comparisons: [{
        symbol: "SPY", status: "available", reason: null,
        start_date: "2026-09-02", end_date: "2026-09-10",
        anchor_latest_date: "2026-09-10", comparison_latest_date: "2026-09-10",
        anchor_history_source: "yahoo", comparison_history_source: "yahoo",
        observations: 7, freshness: "current", anchor_return_pct: 2,
        comparison_return_pct: 1, relative_return_pp: 1,
        points: [
          { date: "2026-09-02", anchor_index: 100, comparison_index: 100 },
          { date: "2026-09-10", anchor_index: 102, comparison_index: 101 },
        ],
      }],
    });
    macroMock.mockResolvedValueOnce({
      start_date: "2026-09-02", end_date: "2026-09-10", retrieved_at: "2026-09-11T10:01:00Z",
      status: "unavailable", reason: "missing_api_key", source: null,
      matched_count: 0, display_limit: 30, events: [],
    });
    renderPage("/equity/market-context?symbol=AAPL&proxies=SPY");
    expect(await screen.findByText("AAPL vs SPY")).toBeInTheDocument();
    expect(macroMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show economic calendar events for AAPL vs SPY" }));
    await waitFor(() => expect(macroMock).toHaveBeenCalledWith("2026-09-02", "2026-09-10"));
    expect(await screen.findByText(/No sample events are shown here/)).toBeInTheDocument();
    expect(screen.getByText(/not events attributed to either asset/)).toBeInTheDocument();
  });

  it("shows provider-attributed calendar events without claiming asset relevance", async () => {
    compareMock.mockResolvedValue({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-11T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes", comparisons: [{
        symbol: "SPY", status: "available", reason: null,
        start_date: "2026-09-02", end_date: "2026-09-10",
        anchor_latest_date: "2026-09-10", comparison_latest_date: "2026-09-10",
        anchor_history_source: "yahoo", comparison_history_source: "yahoo",
        observations: 7, freshness: "current", anchor_return_pct: 2,
        comparison_return_pct: 1, relative_return_pp: 1,
        points: [
          { date: "2026-09-02", anchor_index: 100, comparison_index: 100 },
          { date: "2026-09-10", anchor_index: 102, comparison_index: 101 },
        ],
      }],
    });
    macroMock.mockResolvedValue({
      start_date: "2026-09-02", end_date: "2026-09-10", retrieved_at: "2026-09-11T10:01:00Z",
      status: "available", reason: null, source: "fmp",
      matched_count: 1, display_limit: 30,
      events: [{ date: "2026-09-05", country: "US", event_name: "Rate decision", impact: "unknown" }],
    });
    renderPage("/equity/market-context?symbol=AAPL&proxies=SPY");
    fireEvent.click(await screen.findByRole("button", { name: "Show economic calendar events for AAPL vs SPY" }));
    expect(await screen.findByText(/Rate decision/)).toBeInTheDocument();
    expect(screen.getByText(/FMP · checked/)).toBeInTheDocument();
    expect(screen.getByText(/Impact: unknown/)).toBeInTheDocument();
  });

  it("loads only on-demand source-dated fundamental candidates for the pair window", async () => {
    compareMock.mockResolvedValue({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-11T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes", comparisons: [{
        symbol: "SPY", status: "available", reason: null,
        start_date: "2026-09-02", end_date: "2026-09-10",
        anchor_latest_date: "2026-09-10", comparison_latest_date: "2026-09-10",
        anchor_history_source: "yahoo", comparison_history_source: "yahoo",
        observations: 7, freshness: "current", anchor_return_pct: 2,
        comparison_return_pct: 1, relative_return_pp: 1,
        points: [
          { date: "2026-09-02", anchor_index: 100, comparison_index: 100 },
          { date: "2026-09-10", anchor_index: 102, comparison_index: 101 },
        ],
      }],
    });
    fundamentalsMock.mockResolvedValue({
      anchor: "AAPL", comparison: "SPY", start_date: "2026-09-02", end_date: "2026-09-10",
      retrieved_at: "2026-09-11T10:01:00Z", source: "on_demand_pit_fetch", display_limit_per_symbol: 16,
      groups: [
        { symbol: "AAPL", status: "available", examined_count: 22, matched_count: 1, conflicting_count: 1, releases: [
          { release_date: "2026-09-05", fiscal_period_end: "2026-06-30", metric: "revenue", value: 1234567, source: "fmp" },
        ], conflicts: [{ release_date: "2026-09-06", fiscal_period_end: "2026-06-30", metric: "eps", source: "fmp", distinct_value_count: 2 }] },
        { symbol: "SPY", status: "no_usable_records", examined_count: 0, matched_count: 0, conflicting_count: 0, releases: [], conflicts: [] },
      ],
    });
    renderPage("/equity/market-context?symbol=AAPL&proxies=SPY");
    expect(await screen.findByText("AAPL vs SPY")).toBeInTheDocument();
    expect(fundamentalsMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show dated fundamentals for AAPL vs SPY" }));
    await waitFor(() => expect(fundamentalsMock).toHaveBeenCalledWith("AAPL", "SPY", "2026-09-02", "2026-09-10"));
    expect(await screen.findByText(/2026-09-05 · Revenue/)).toBeInTheDocument();
    expect(screen.getByText(/Fiscal period ended 2026-06-30 · FMP/)).toBeInTheDocument();
    expect(screen.getByText(/No source-dated records returned/)).toBeInTheDocument();
    expect(screen.getByText(/no verified revision history/)).toBeInTheDocument();
    expect(screen.getByText(/1 conflicting provider record withheld/)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-06 · EPS · fiscal period 2026-06-30 · FMP: 2 different values/)).toBeInTheDocument();
  });

  it("deliberately captures and reviews distinct saved values without treating them as historical proof", async () => {
    compareMock.mockResolvedValue({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-11T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes", comparisons: [{
        symbol: "SPY", status: "available", reason: null,
        start_date: "2026-09-02", end_date: "2026-09-10",
        anchor_latest_date: "2026-09-10", comparison_latest_date: "2026-09-10",
        anchor_history_source: "yahoo", comparison_history_source: "yahoo",
        observations: 7, freshness: "current", anchor_return_pct: 2,
        comparison_return_pct: 1, relative_return_pp: 1,
        points: [{ date: "2026-09-02", anchor_index: 100, comparison_index: 100 }, { date: "2026-09-10", anchor_index: 102, comparison_index: 101 }],
      }],
    });
    fundamentalsMock.mockRejectedValue(new Error("Current panel unavailable"));
    const saved = {
      id: "capture-1", symbol: "AAPL", captured_at: "2026-09-11T10:05:00Z",
      status: "records_observed" as const, examined_count: 3, record_count: 2,
      content_hash: "abc", evidence_scope: "terminal_observation_only" as const,
      records: [
        { release_date: "2026-09-05", fiscal_period_end: "2026-06-30", metric: "revenue" as const, value: 100, source: "fmp" },
        { release_date: "2026-09-05", fiscal_period_end: "2026-06-30", metric: "revenue" as const, value: 110, source: "fmp" },
      ],
    };
    const earlier = { ...saved, id: "capture-0", captured_at: "2026-09-10T09:00:00Z", status: "fetch_error" as const, examined_count: 0, record_count: 0, records: [] };
    listCapturesMock.mockImplementation(async (symbol) => symbol === "AAPL" ? (captureMock.mock.calls.length > 0 ? [saved, earlier] : [earlier]) : []);
    captureMock.mockResolvedValue(saved);
    getCaptureMock.mockImplementation(async (id) => id === earlier.id ? earlier : saved);
    compareCapturesMock.mockResolvedValue({
      contract_version: 1, evidence_scope: "terminal_observation_only", comparison_basis: "retained_capture_candidate_sets",
      symbol: "AAPL", earlier_capture: earlier, later_capture: saved, comparison_status: "unavailable",
      reason: "earlier_capture_not_records_observed", unchanged_identity_count: 0, deltas: [],
    });

    renderPage("/equity/market-context?symbol=AAPL&proxies=SPY");
    expect(await screen.findByText("AAPL vs SPY")).toBeInTheDocument();
    expect(captureMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show dated fundamentals for AAPL vs SPY" }));
    expect(await screen.findByRole("button", { name: "Capture current fundamentals for AAPL" })).toBeInTheDocument();
    expect(captureMock).not.toHaveBeenCalled();
    expect(await screen.findByText("Current panel unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Review AAPL capture from/ }));
    expect(await screen.findByText(/The fetch failed; this capture says nothing/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Capture current fundamentals for AAPL" }));
    await waitFor(() => expect(captureMock).toHaveBeenCalledWith("AAPL"));
    expect(await screen.findByText(/Revenue 100 · fiscal period 2026-06-30 · FMP/)).toBeInTheDocument();
    expect(screen.getByText(/Revenue 110 · fiscal period 2026-06-30 · FMP/)).toBeInTheDocument();
    expect(screen.getByText(/not a verified historical revision/)).toBeInTheDocument();
    expect(await screen.findAllByRole("button", { name: /Review AAPL capture from/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Compare AAPL capture from/ }));
    await waitFor(() => expect(compareCapturesMock).toHaveBeenCalledWith("capture-0", "capture-1"));
    expect(await screen.findByText(/Cannot compare values: the earlier capture/)).toBeInTheDocument();
  });

  it("shows candidate-set differences between retained captures without calling them revisions", async () => {
    compareMock.mockResolvedValue({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-11T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes", comparisons: [{
        symbol: "SPY", status: "available", reason: null,
        start_date: "2026-09-02", end_date: "2026-09-10",
        anchor_latest_date: "2026-09-10", comparison_latest_date: "2026-09-10",
        anchor_history_source: "yahoo", comparison_history_source: "yahoo",
        observations: 7, freshness: "current", anchor_return_pct: 2,
        comparison_return_pct: 1, relative_return_pp: 1,
        points: [{ date: "2026-09-02", anchor_index: 100, comparison_index: 100 }, { date: "2026-09-10", anchor_index: 102, comparison_index: 101 }],
      }],
    });
    fundamentalsMock.mockRejectedValue(new Error("Current panel unavailable"));
    const earlier = {
      id: "capture-0", symbol: "AAPL", captured_at: "2026-09-10T09:00:00Z",
      status: "records_observed" as const, examined_count: 1, record_count: 1,
      content_hash: "abc", evidence_scope: "terminal_observation_only" as const,
    };
    const later = { ...earlier, id: "capture-1", captured_at: "2026-09-11T10:00:00Z", content_hash: "def" };
    listCapturesMock.mockImplementation(async (symbol) => symbol === "AAPL" ? [later, earlier] : []);
    compareCapturesMock.mockResolvedValue({
      contract_version: 1, evidence_scope: "terminal_observation_only", comparison_basis: "retained_capture_candidate_sets",
      symbol: "AAPL", earlier_capture: earlier, later_capture: later, comparison_status: "comparable",
      reason: null, unchanged_identity_count: 0, deltas: [{
        release_date: "2026-09-05", fiscal_period_end: "2026-06-30", metric: "revenue", source: "fmp",
        kind: "value_set_different", earlier_values: [100], later_values: [110],
      }],
    });

    renderPage("/equity/market-context?symbol=AAPL&proxies=SPY");
    fireEvent.click(await screen.findByRole("button", { name: "Show dated fundamentals for AAPL vs SPY" }));
    fireEvent.click(await screen.findByRole("button", { name: /Compare AAPL capture from/ }));
    await waitFor(() => expect(compareCapturesMock).toHaveBeenCalledWith("capture-0", "capture-1"));
    expect(await screen.findByText(/value set different · earlier: 100 · later: 110/)).toBeInTheDocument();
    expect(screen.getByText(/not verified revisions/)).toBeInTheDocument();
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("checks SEC filed facts separately and only on demand for the pair window", async () => {
    compareMock.mockResolvedValue({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-11T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes", comparisons: [{
        symbol: "SPY", status: "available", reason: null,
        start_date: "2026-09-02", end_date: "2026-09-10",
        anchor_latest_date: "2026-09-10", comparison_latest_date: "2026-09-10",
        anchor_history_source: "yahoo", comparison_history_source: "yahoo",
        observations: 7, freshness: "current", anchor_return_pct: 2,
        comparison_return_pct: 1, relative_return_pp: 1,
        points: [{ date: "2026-09-02", anchor_index: 100, comparison_index: 100 }, { date: "2026-09-10", anchor_index: 102, comparison_index: 101 }],
      }],
    });
    secFactsMock.mockImplementation(async (symbol) => symbol === "AAPL" ? {
      contract_version: 1, symbol, filed_start: "2026-09-02", filed_end: "2026-09-10",
      retrieved_at: "2026-09-11T10:01:00Z", status: "available",
      evidence_scope: "sec_current_companyfacts_accession_tagged", cik: 320193,
      matched_count: 2, examined_count: 30, display_limit: 50,
      facts: [{ filed_date: "2026-09-05", accession: "0000320193-26-000001", taxonomy: "us-gaap",
        concept: "NetIncomeLoss", unit: "USD", form: "10-Q", period_start: "2026-04-01", period_end: "2026-06-30", value: 1234567 }],
      difference_basis: "same_concept_unit_exact_period_values_not_verified_revisions",
      candidate_group_count: 1, candidate_display_limit: 20, disclosures_per_candidate_limit: 8,
      difference_candidates: [{ concept: "NetIncomeLoss", unit: "USD", period_start: "2026-04-01", period_end: "2026-06-30",
        latest_filed_date: "2026-09-07", disclosure_count: 2, distinct_accession_count: 2, distinct_value_count: 2,
        within_accession_conflict: false, disclosures: [
          { filed_date: "2026-09-05", accession: "0000320193-26-000001", taxonomy: "us-gaap", concept: "NetIncomeLoss", unit: "USD", form: "10-Q", period_start: "2026-04-01", period_end: "2026-06-30", value: 1234567 },
          { filed_date: "2026-09-07", accession: "0000320193-26-000002", taxonomy: "us-gaap", concept: "NetIncomeLoss", unit: "USD", form: "10-Q/A", period_start: "2026-04-01", period_end: "2026-06-30", value: 1234568 },
        ] }],
    } : {
      contract_version: 1, symbol, filed_start: "2026-09-02", filed_end: "2026-09-10",
      retrieved_at: "2026-09-11T10:01:00Z", status: "not_covered",
      evidence_scope: "sec_current_companyfacts_accession_tagged", cik: null,
      matched_count: 0, examined_count: 0, display_limit: 50, facts: [],
    });
    renderPage("/equity/market-context?symbol=AAPL&proxies=SPY");
    expect(await screen.findByText("AAPL vs SPY")).toBeInTheDocument();
    expect(secFactsMock).not.toHaveBeenCalled();
    expect(fundamentalsMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show SEC filed facts for AAPL vs SPY" }));
    await waitFor(() => expect(secFactsMock).toHaveBeenCalledWith("AAPL", "2026-09-02", "2026-09-10"));
    expect(secFactsMock).toHaveBeenCalledWith("SPY", "2026-09-02", "2026-09-10");
    expect(await screen.findByText(/2026-09-05 · NetIncomeLoss/)).toBeInTheDocument();
    expect(screen.getAllByText(/accession 0000320193-26-000001/)).toHaveLength(2);
    expect(screen.getByText(/No exact ticker match in the SEC ticker list/)).toBeInTheDocument();
    expect(screen.getByText(/not a complete historical archive, verified revision order/)).toBeInTheDocument();
    expect(screen.getByText("Same-period value differences")).toBeInTheDocument();
    expect(screen.getByText(/1 candidate group across exact concept, unit, and period identities/)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-07 · 10-Q\/A · accession 0000320193-26-000002/)).toBeInTheDocument();
    expect(screen.getByText(/Different filed values are not verified revisions/)).toBeInTheDocument();
    expect(fundamentalsMock).not.toHaveBeenCalled();
  });

  it("explains SEC configuration and provider failures without implying no filings", async () => {
    compareMock.mockResolvedValue({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-11T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_provider_closes",
      method: "same_utc_date_daily_closes", comparisons: [{
        symbol: "SPY", status: "available", reason: null,
        start_date: "2026-09-02", end_date: "2026-09-10",
        anchor_latest_date: "2026-09-10", comparison_latest_date: "2026-09-10",
        anchor_history_source: "yahoo", comparison_history_source: "yahoo",
        observations: 7, freshness: "current", anchor_return_pct: 2,
        comparison_return_pct: 1, relative_return_pp: 1,
        points: [{ date: "2026-09-02", anchor_index: 100, comparison_index: 100 }, { date: "2026-09-10", anchor_index: 102, comparison_index: 101 }],
      }],
    });
    secFactsMock.mockImplementation(async (symbol) => ({
      contract_version: 1, symbol, filed_start: "2026-09-02", filed_end: "2026-09-10",
      retrieved_at: "2026-09-11T10:01:00Z",
      status: symbol === "AAPL" ? "configuration_required" : "provider_error",
      evidence_scope: "sec_current_companyfacts_accession_tagged", cik: null,
      matched_count: 0, examined_count: 0, display_limit: 50, facts: [],
    }));
    renderPage("/equity/market-context?symbol=AAPL&proxies=SPY");
    fireEvent.click(await screen.findByRole("button", { name: "Show SEC filed facts for AAPL vs SPY" }));
    expect(await screen.findByText(/The host must set SEC_USER_AGENT/)).toBeInTheDocument();
    expect(await screen.findByText(/SEC provider check failed; coverage is unknown/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry SEC facts for SPY" })).toBeInTheDocument();
  });
});
