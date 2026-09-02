import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { TradeJournalPage } from "../pages/TradeJournalPage";

const fetchJournalGapReviewMock = vi.fn();

const entry = {
  id: 7,
  user_id: "user-1",
  symbol: "AAPL",
  direction: "LONG" as const,
  entry_date: "2026-07-01T12:00:00Z",
  entry_price: 200,
  exit_date: null,
  exit_price: null,
  quantity: 1,
  pnl: null,
  pnl_pct: null,
  fees: 0,
  strategy: "breakout",
  setup: null,
  emotion: null,
  notes: null,
  tags: [],
  rating: null,
  created_at: "2026-07-01T12:00:00Z",
  updated_at: "2026-07-01T12:00:00Z",
};

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { ResponsiveContainer: Stub, LineChart: Stub, Line: Stub, BarChart: Stub, Bar: Stub, CartesianGrid: Stub, XAxis: Stub, YAxis: Stub, Tooltip: Stub };
});

vi.mock("../api/client", () => ({
  fetchJournalEntries: vi.fn(async () => [entry]),
  fetchJournalStats: vi.fn(async () => ({ by_strategy: [], by_day_of_week: [], by_emotion: [] })),
  fetchJournalEquityCurve: vi.fn(async () => []),
  fetchJournalCalendar: vi.fn(async () => []),
  fetchJournalGapReview: (...args: unknown[]) => fetchJournalGapReviewMock(...args),
  createJournalEntry: vi.fn(),
  updateJournalEntry: vi.fn(),
  deleteJournalEntry: vi.fn(),
}));

describe("TradeJournalPage gap review", () => {
  it("runs only on demand and links an incomplete result to its editor", async () => {
    fetchJournalGapReviewMock.mockResolvedValue({
      reviewed_at: "2026-09-02T12:00:00Z",
      stale_after_days: 30,
      total_entries: 1,
      entries_needing_review: 1,
      complete_entries: 0,
      gap_counts: { rationale: 1, outcome: 1, emotion: 1, setup: 1, thesis_update: 1 },
      items: [{
        entry_id: 7,
        symbol: "AAPL",
        entry_date: entry.entry_date,
        status: "open",
        missing: ["rationale", "outcome", "emotion", "setup", "thesis_update"],
        prompts: ["Add the reasoning you had when taking this trade."],
        entry,
      }],
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TradeJournalPage />
      </QueryClientProvider>,
    );

    const reviewButton = await screen.findByRole("button", { name: "Review journal gaps" });
    expect(fetchJournalGapReviewMock).not.toHaveBeenCalled();
    fireEvent.click(reviewButton);

    expect(await screen.findByText("1 of 1 entries need attention." )).toBeInTheDocument();
    expect(screen.getByText("thesis update")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Complete entry" }));

    await waitFor(() => expect(screen.getByText("Edit AAPL")).toBeInTheDocument());
  });
});
