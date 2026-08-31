import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TickerNewsCard } from "../components/market/TickerNewsCard";

const fetchNewsByTickerMock = vi.fn();
const scoreNewsArticlesMock = vi.fn();

vi.mock("../api/news", () => ({
  fetchNewsByTicker: (...args: unknown[]) => fetchNewsByTickerMock(...args),
}));

vi.mock("../api/sentiment", async () => {
  const actual = await vi.importActual<typeof import("../api/sentiment")>("../api/sentiment");
  return {
    ...actual,
    scoreNewsArticles: (...args: unknown[]) => scoreNewsArticlesMock(...args),
  };
});

function renderCard(limit = 25) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TickerNewsCard ticker="AAPL" limit={limit} />
    </QueryClientProvider>,
  );
}

describe("TickerNewsCard AI sentiment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const articles = Array.from({ length: 21 }, (_, index) => ({
        id: `article-${index}`,
        title: `Headline ${index}`,
        source: "Wire",
        url: `https://example.com/${index}`,
        summary: `Summary ${index}`,
        published_at: "2026-08-31T10:00:00Z",
      }));
    fetchNewsByTickerMock.mockImplementation(async (_ticker: string, limit: number) => articles.slice(0, limit));
  });

  it("scores only on demand, caps the batch at 20, and identifies mixed fallback", async () => {
    scoreNewsArticlesMock.mockImplementation(async (items: Array<{ id: string }>) => ({
      engine: "mixed",
      model: "llama3.1",
      items: items.map((item, index) => ({
        id: item.id,
        label: index === 0 ? "Bullish" : "Neutral",
        score: index === 0 ? 0.7 : 0,
        confidence: 0.8,
        rationale: index === 0 ? "Demand is accelerating." : "No directional catalyst.",
        engine: index === 0 ? "llm" : "lexical",
      })),
    }));

    renderCard();

    const action = await screen.findByRole("button", { name: "AI sentiment" });
    expect(scoreNewsArticlesMock).not.toHaveBeenCalled();
    fireEvent.click(action);

    await waitFor(() => expect(scoreNewsArticlesMock).toHaveBeenCalledTimes(1));
    expect(scoreNewsArticlesMock.mock.calls[0][0]).toHaveLength(20);
    expect(await screen.findByText("llama3.1 + lexical fallback · 20/20")).toBeInTheDocument();
    expect(screen.getByText("Demand is accelerating.")).toBeInTheDocument();
  });

  it("shows an honest lexical label when the LLM is unavailable", async () => {
    scoreNewsArticlesMock.mockImplementation(async (items: Array<{ id: string }>) => ({
      engine: "lexical",
      items: items.map((item) => ({
        id: item.id,
        label: "Neutral",
        score: 0,
        confidence: 0.4,
        rationale: "Lexical fallback result.",
        engine: "lexical",
      })),
    }));

    renderCard(12);
    fireEvent.click(await screen.findByRole("button", { name: "AI sentiment" }));

    expect(await screen.findByText("LLM unavailable — lexical fallback · 12/12")).toBeInTheDocument();
  });

  it("keeps the action retryable after a request failure", async () => {
    scoreNewsArticlesMock.mockRejectedValue(new Error("timeout"));

    renderCard(12);
    const action = await screen.findByRole("button", { name: "AI sentiment" });
    fireEvent.click(action);

    expect(await screen.findByText("Scoring failed — retry")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "AI sentiment" }));
    await waitFor(() => expect(scoreNewsArticlesMock).toHaveBeenCalledTimes(2));
  });
});
