import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SecondBrainPanel } from "../components/brain/SecondBrainPanel";

const askBrainMock = vi.fn();
const askBrainStreamMock = vi.fn();
const fetchBrainStatusMock = vi.fn();
const reindexBrainMock = vi.fn();

vi.mock("../api/brain", () => ({
  askBrain: (...args: unknown[]) => askBrainMock(...args),
  askBrainStream: (...args: unknown[]) => askBrainStreamMock(...args),
  fetchBrainStatus: (...args: unknown[]) => fetchBrainStatusMock(...args),
  reindexBrain: (...args: unknown[]) => reindexBrainMock(...args),
}));

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <QueryClientProvider client={client}>
        <SecondBrainPanel />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("SecondBrainPanel source filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchBrainStatusMock.mockResolvedValue({
      indexed_chunks: 8,
      source_counts: {
        note: 3,
        journal: 2,
        portfolio: 1,
        holding: 1,
        transaction: 1,
      },
      backend: "numpy",
      embed_model: "nomic-embed-text",
    });
    askBrainStreamMock.mockImplementation(
      async (_question: string, _k: number, sources: string[]) => ({
        answer: "Scoped answer",
        citations: [],
        sources,
        llm: true,
      }),
    );
  });

  it("shows source counts and sends the visible evidence scope", async () => {
    renderPanel();

    expect(await screen.findByText(/8 indexed/)).toBeInTheDocument();
    expect(screen.getByText("Evidence scope · All private sources")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notes · 3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Journal · 2" }));
    fireEvent.change(
      screen.getByPlaceholderText(/Ask your second brain/),
      { target: { value: "Where does my thesis drift?" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() =>
      expect(askBrainStreamMock).toHaveBeenCalledWith(
        "Where does my thesis drift?",
        6,
        ["note", "portfolio", "holding", "transaction"],
        expect.any(Function),
      ),
    );
    expect(await screen.findByText("Scoped answer")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Evidence scope · Notes, Portfolio theses, Position notes, Transaction notes",
      ),
    ).toHaveLength(2);
  });

  it("keeps at least one private source selected", async () => {
    renderPanel();
    await screen.findByText(/8 indexed/);

    for (const name of [
      "Journal · 2",
      "Portfolio theses · 1",
      "Position notes · 1",
      "Transaction notes · 1",
    ]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    const notes = screen.getByRole("button", { name: "Notes · 3" });
    fireEvent.click(notes);

    expect(notes).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Evidence scope · Notes")).toBeInTheDocument();
  });

  it("renders answer text before the stream completes", async () => {
    let finish: ((value: unknown) => void) | undefined;
    askBrainStreamMock.mockImplementation(
      async (_question: string, _k: number, sources: string[], onUpdate: (value: unknown) => void) => {
        onUpdate({
          answer: "A partial grounded thought…",
          citations: [],
          sources,
          llm: true,
        });
        return await new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    renderPanel();
    await screen.findByText(/8 indexed/);

    fireEvent.change(screen.getByPlaceholderText(/Ask your second brain/), {
      target: { value: "What keeps repeating?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByText("A partial grounded thought…")).toBeInTheDocument();
    finish?.({
      answer: "A complete grounded thought.",
      citations: [],
      sources: ["note", "journal", "portfolio", "holding", "transaction"],
      llm: true,
    });
    expect(await screen.findByText("A complete grounded thought.")).toBeInTheDocument();
  });
});
