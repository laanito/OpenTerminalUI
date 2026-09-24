import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { compareMarketContext } from "../api/marketContext";
import { searchSymbols } from "../api/marketData";
import { MarketContextPage } from "../pages/MarketContextPage";

vi.mock("../api/marketContext", () => ({ compareMarketContext: vi.fn() }));
vi.mock("../api/marketData", () => ({ searchSymbols: vi.fn() }));

const compareMock = vi.mocked(compareMarketContext);
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
    searchMock.mockReset();
  });

  it("shows dated available, stale, and unavailable comparisons without inventing returns", async () => {
    compareMock.mockResolvedValue({
      anchor: "BTC-USD",
      period: "1M",
      retrieved_at: "2026-09-24T10:00:00Z",
      data_source: "unified_history",
      return_basis: "native_quote_currency_unadjusted",
      method: "same_utc_date_daily_closes",
      comparisons: [
        {
          symbol: "SPY", status: "available", reason: null,
          start_date: "2026-08-25", end_date: "2026-09-23",
          anchor_latest_date: "2026-09-24", comparison_latest_date: "2026-09-23",
          observations: 21, freshness: "current",
          anchor_return_pct: 5.25, comparison_return_pct: 2.1, relative_return_pp: 3.15,
        },
        {
          symbol: "QQQ", status: "available", reason: null,
          start_date: "2026-08-25", end_date: "2026-09-10",
          anchor_latest_date: "2026-09-24", comparison_latest_date: "2026-09-10",
          observations: 12, freshness: "stale",
          anchor_return_pct: 4, comparison_return_pct: 1, relative_return_pp: 3,
        },
        {
          symbol: "SAP.DE", status: "unavailable", reason: "provider_error",
          start_date: null, end_date: null,
          anchor_latest_date: null, comparison_latest_date: null,
          observations: null, freshness: null,
          anchor_return_pct: null, comparison_return_pct: null, relative_return_pp: null,
        },
      ],
    });
    renderPage("/equity/market-context?symbol=BTC-USD&proxies=SPY,QQQ,SAP.DE");

    expect(await screen.findByText("BTC-USD vs SPY")).toBeInTheDocument();
    expect(compareMock).toHaveBeenCalledWith("BTC-USD", ["SPY", "QQQ", "SAP.DE"], "1M");
    expect(screen.getByText("+5.25%")).toBeInTheDocument();
    expect(screen.getByText("+3.15 pp")).toBeInTheDocument();
    expect(screen.getByText("Stale history")).toBeInTheDocument();
    expect(screen.getByText(/History provider failed; no comparison was calculated/)).toBeInTheDocument();
    expect(screen.getByText(/not FX-normalized/)).toBeInTheDocument();
  });

  it("validates editable symbols before applying a new query", async () => {
    compareMock.mockResolvedValue({
      anchor: "AAPL", period: "1M", retrieved_at: "2026-09-24T10:00:00Z",
      data_source: "unified_history", return_basis: "native_quote_currency_unadjusted",
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
      data_source: "unified_history", return_basis: "native_quote_currency_unadjusted",
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
      data_source: "unified_history", return_basis: "native_quote_currency_unadjusted",
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
      data_source: "unified_history", return_basis: "native_quote_currency_unadjusted",
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
      data_source: "unified_history", return_basis: "native_quote_currency_unadjusted",
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
});
