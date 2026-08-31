import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NewsPage } from "../pages/News";

const fetchLatestNewsMock = vi.fn();
const scoreNewsArticlesMock = vi.fn();

vi.mock("../hooks/useStocks", () => ({
  useStock: () => ({ data: { company_name: "Apple", exchange: "NASDAQ" } }),
}));

vi.mock("../store/stockStore", () => ({
  useStockStore: (selector: (state: { ticker: string }) => unknown) => selector({ ticker: "AAPL" }),
}));

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { ResponsiveContainer: Stub, LineChart: Stub, Line: Stub, XAxis: Stub, YAxis: Stub, Tooltip: Stub };
});

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    fetchLatestNews: (...args: unknown[]) => fetchLatestNewsMock(...args),
    fetchCryptoNews: vi.fn(async () => []),
    searchLatestNews: vi.fn(async () => []),
    fetchNewsByTicker: vi.fn(async () => []),
    fetchNewsSentiment: vi.fn(async () => null),
    fetchMarketSentiment: vi.fn(async () => ({ sectors: [] })),
    fetchNewsSentimentSummary: vi.fn(async () => ({ top_sources: [] })),
    fetchNewsSummaries: vi.fn(async () => ({})),
    fetchStockEmotion: vi.fn(async () => null),
    scoreNewsArticles: (...args: unknown[]) => scoreNewsArticlesMock(...args),
  };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NewsPage />
    </QueryClientProvider>,
  );
}

describe("NewsPage AI sentiment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchLatestNewsMock.mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => ({
        id: `article-${index}`,
        title: `Market headline ${index}`,
        source: "Wire",
        url: `https://example.com/${index}`,
        summary: `Publisher summary ${index}`,
        published_at: new Date().toISOString(),
        sentiment: { label: "Neutral", score: 0, confidence: 0.3 },
      })),
    );
    scoreNewsArticlesMock.mockImplementation(async (items: Array<{ id: string }>) => ({
      engine: "llm",
      model: "local-model",
      items: items.map((item) => ({
        id: item.id,
        label: "Bullish",
        score: 0.6,
        confidence: 0.85,
        rationale: `AI rationale for ${item.id}`,
        engine: "llm",
      })),
    }));
  });

  it("scores visible headlines in successive on-demand batches", async () => {
    renderPage();

    const firstAction = await screen.findByRole("button", { name: "AI sentiment · 20" });
    expect(scoreNewsArticlesMock).not.toHaveBeenCalled();
    fireEvent.click(firstAction);

    await waitFor(() => expect(scoreNewsArticlesMock).toHaveBeenCalledTimes(1));
    expect(scoreNewsArticlesMock.mock.calls[0][0]).toHaveLength(20);
    expect(await screen.findByText("local-model · 20/20")).toBeInTheDocument();
    expect(await screen.findByText("AI rationale for article-0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    const secondAction = await screen.findByRole("button", { name: "AI sentiment · 5" });
    fireEvent.click(secondAction);

    await waitFor(() => expect(scoreNewsArticlesMock).toHaveBeenCalledTimes(2));
    expect(scoreNewsArticlesMock.mock.calls[1][0]).toHaveLength(5);
    expect(scoreNewsArticlesMock.mock.calls[1][0][0].id).toBe("article-20");
    expect(await screen.findByText("AI rationale for article-24")).toBeInTheDocument();
  });
});
