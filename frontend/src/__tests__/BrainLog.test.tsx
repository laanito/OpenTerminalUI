import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { brainTechnicalAnswer } from "./fixtures/brainTechnicalContext";

import { SecondBrainPanel } from "../components/brain/SecondBrainPanel";
import { BrainLogPanel } from "../components/brain/BrainLogPanel";

const searchSymbolsMock = vi.fn();
vi.mock("../api/marketData", () => ({ searchSymbols: (...args: unknown[]) => searchSymbolsMock(...args) }));

const askBrainStreamMock = vi.fn();
const fetchBrainStatusMock = vi.fn();
const createBrainMemoMock = vi.fn();
const listBrainMemosMock = vi.fn();
const getBrainMemoMock = vi.fn();
const getBrainMemoEvidenceStatusMock = vi.fn();
const updateBrainMemoMock = vi.fn();
const deleteBrainMemoMock = vi.fn();
const promoteBrainMemoToNoteMock = vi.fn();

vi.mock("../api/brain", () => ({
  askBrainStream: (...args: unknown[]) => askBrainStreamMock(...args),
  fetchBrainStatus: (...args: unknown[]) => fetchBrainStatusMock(...args),
  reindexBrain: vi.fn(),
}));
vi.mock("../api/brainMemos", () => ({
  createBrainMemo: (...args: unknown[]) => createBrainMemoMock(...args),
  listBrainMemos: (...args: unknown[]) => listBrainMemosMock(...args),
  getBrainMemo: (...args: unknown[]) => getBrainMemoMock(...args),
  getBrainMemoEvidenceStatus: (...args: unknown[]) => getBrainMemoEvidenceStatusMock(...args),
  updateBrainMemo: (...args: unknown[]) => updateBrainMemoMock(...args),
  deleteBrainMemo: (...args: unknown[]) => deleteBrainMemoMock(...args),
  promoteBrainMemoToNote: (...args: unknown[]) => promoteBrainMemoToNoteMock(...args),
}));

const citation = {
  n: 1, source: "note", title: "Current thesis", symbol: "MSFT",
  snippet: "New guidance", score: 0.9, ref_id: "note-1", content_hash: "abc123",
  effective_at: "2026-09-20T10:00:00Z", route: "/equity/notes",
};
const memo = {
  id: "memo-1", title: "What changed?", question: "What changed?", answer: "Guidance improved [1].",
  answer_preview: "Guidance improved [1].", symbol: null, tags: [], annotation: "", pinned: false,
  citation_count: 1, generated_at: "2026-09-21T10:00:00Z", created_at: "2026-09-21T10:01:00Z",
  updated_at: "2026-09-21T10:01:00Z", sources: ["note"], citations: [citation],
  llm: true, llm_provider: "test", llm_model: "test-model",
};

function renderWithProviders(element: React.ReactNode, entry = "/equity/brain") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <QueryClientProvider client={client}>{element}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Brain Log browser flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchBrainStatusMock.mockResolvedValue({
      indexed_chunks: 1, source_counts: { note: 1, journal: 0, portfolio: 0, holding: 0, transaction: 0 },
      backend: "numpy", embed_model: "test",
    });
    createBrainMemoMock.mockResolvedValue(memo);
    listBrainMemosMock.mockResolvedValue([memo]);
    getBrainMemoMock.mockResolvedValue(memo);
    getBrainMemoEvidenceStatusMock.mockResolvedValue({ status: "current", checked_at: "2026-09-23T10:00:00Z", citations: [{ n: 1, status: "current" }] });
    updateBrainMemoMock.mockImplementation(async (_id: string, changes: object) => ({ ...memo, ...changes }));
    deleteBrainMemoMock.mockResolvedValue(undefined);
    promoteBrainMemoToNoteMock.mockResolvedValue({ id: "note-1" });
  });

  it("asks only for explicitly selected symbols and saves the captured multi-asset evidence", async () => {
    const result = brainTechnicalAnswer();
    searchSymbolsMock.mockResolvedValue([{ ticker: "AAPL", name: "Apple", exchange: "NASDAQ" }]);
    askBrainStreamMock.mockResolvedValue(result);
    renderWithProviders(<SecondBrainPanel />);
    await screen.findByText(/1 indexed/);
    expect(searchSymbolsMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Add technical symbol" }), { target: { value: "app" } });
    fireEvent.click(await screen.findByRole("option", { name: /AAPL/ }));
    expect(screen.getByRole("button", { name: "Remove technical AAPL" })).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Add technical symbol" }), { target: { value: "btc-usd" } });
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    fireEvent.change(screen.getByPlaceholderText(/Ask your second brain/), { target: { value: "What changed?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
    await waitFor(() => expect(askBrainStreamMock).toHaveBeenCalledWith("What changed?", 6, expect.any(Array), expect.any(Function),
      expect.objectContaining({ technicalSymbols: ["AAPL", "BTC-USD"] })));
    fireEvent.click(await screen.findByRole("button", { name: "Inspect T2.1 technical evidence" }));
    expect(screen.getByRole("region", { name: "T2.1 technical evidence" })).toHaveFocus();
    expect(screen.getByText("Dated private thesis")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    await waitFor(() => expect(createBrainMemoMock).toHaveBeenCalledWith(expect.objectContaining({
      answer: result.answer, technical_context: result.technical_context, citations: result.citations,
    })));
    expect(promoteBrainMemoToNoteMock).not.toHaveBeenCalled();
  });

  it("reopens captured market evidence independently of private rechecks and reviews dated promotion text", async () => {
    const result = brainTechnicalAnswer();
    const saved = { ...memo, ...result, title: "Dated technical answer" };
    listBrainMemosMock.mockResolvedValue([saved]); getBrainMemoMock.mockResolvedValue(saved);
    renderWithProviders(<BrainLogPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Dated technical answer/ }));
    await screen.findByText(/Saved market snapshots are shown as captured/);
    fireEvent.click(screen.getByRole("button", { name: "Inspect T1.1 technical evidence" }));
    expect(screen.getByRole("region", { name: "T1.1 technical evidence" })).toHaveFocus();
    await waitFor(() => expect(getBrainMemoEvidenceStatusMock).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Recheck" }));
    await waitFor(() => expect(getBrainMemoEvidenceStatusMock).toHaveBeenCalledTimes(2));
    expect(askBrainStreamMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Promote to Note" }));
    const text = (screen.getByLabelText(/Reviewed note text/) as HTMLTextAreaElement).value;
    expect(text).toContain("(captured T1.1)"); expect(text).not.toContain("[T1.1]");
    expect(text).toContain(result.technical_context!.groups[0].snapshot_id);
    expect(text).toContain(result.technical_context!.groups[1].retrieved_at);
    expect(text).toContain("Full supporting dates and closes remain in the saved Brain Log memo memo-1");
    expect(screen.getByRole("button", { name: "Create reviewed Note" })).toBeDisabled();
    expect(promoteBrainMemoToNoteMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/I reviewed this text/));
    fireEvent.click(screen.getByRole("button", { name: "Create reviewed Note" }));
    await waitFor(() => expect(promoteBrainMemoToNoteMock).toHaveBeenCalledWith("memo-1", expect.objectContaining({ body: text })));
  });

  it("offers Save only after a complete answer and preserves the answer snapshot", async () => {
    let finish: ((value: unknown) => void) | undefined;
    askBrainStreamMock.mockImplementation(async (_question: string, _k: number, _sources: string[], onUpdate: (value: unknown) => void) => {
      onUpdate({ answer: "Partial", citations: [citation], sources: ["note"], llm: true });
      return await new Promise((resolve) => { finish = resolve; });
    });
    renderWithProviders(<SecondBrainPanel />);
    await screen.findByText(/1 indexed/);
    fireEvent.change(screen.getByPlaceholderText(/Ask your second brain/), { target: { value: "What changed?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("Partial")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument();

    finish?.({ answer: memo.answer, citations: [citation], sources: ["note"], llm: true,
      generated_at: memo.generated_at, llm_provider: memo.llm_provider, llm_model: memo.llm_model });
    fireEvent.click(await screen.findByRole("button", { name: "Save answer" }));
    await waitFor(() => expect(createBrainMemoMock).toHaveBeenCalledWith({
      question: memo.question, answer: memo.answer, citations: [citation], sources: ["note"],
      generated_at: memo.generated_at, llm: true, llm_provider: "test", llm_model: "test-model",
    }));
    expect(await screen.findByRole("button", { name: "Saved to Brain Log" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "View log" })).toHaveAttribute("href", "#brain-log");
  });

  it("keeps incomplete or degraded responses unsaveable", async () => {
    askBrainStreamMock.mockResolvedValue({ ...memo, generated_at: null, error: "provider failed" });
    renderWithProviders(<SecondBrainPanel />);
    await screen.findByText(/1 indexed/);
    fireEvent.change(screen.getByPlaceholderText(/Ask your second brain/), { target: { value: memo.question } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText(memo.answer)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument();
  });

  it("reads saved evidence, updates organization, and explicitly confirms deletion", async () => {
    renderWithProviders(<BrainLogPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /What changed\?/ }));
    expect(await screen.findByRole("region", { name: "Saved research memo" })).toBeInTheDocument();
    expect(screen.getByText("Current thesis")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New title" } });
    fireEvent.change(screen.getByLabelText("Tags (comma-separated)"), { target: { value: "research, macro" } });
    fireEvent.change(screen.getByLabelText("Your annotation"), { target: { value: "Review quarterly" } });
    fireEvent.click(screen.getByLabelText("Pin this memo"));
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(updateBrainMemoMock).toHaveBeenCalledWith("memo-1", {
      title: "New title", symbol: null, tags: ["research", "macro"], annotation: "Review quarterly", pinned: true,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Delete memo" }));
    expect(deleteBrainMemoMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(deleteBrainMemoMock).toHaveBeenCalledWith("memo-1"));
  });

  it("filters the log through the server-side symbol and pinned contract", async () => {
    renderWithProviders(<BrainLogPanel />);
    await screen.findByRole("button", { name: /What changed\?/ });
    fireEvent.change(screen.getByLabelText("Filter by symbol"), { target: { value: "msft" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(listBrainMemosMock).toHaveBeenCalledWith(0, 25, "MSFT", undefined));
    fireEvent.click(screen.getByLabelText("Pinned only"));
    await waitFor(() => expect(listBrainMemosMock).toHaveBeenCalledWith(0, 25, "MSFT", true));
  });

  it("requires review before promoting a memo and preserves provenance in the result", async () => {
    renderWithProviders(<BrainLogPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /What changed\?/ }));
    await screen.findByRole("region", { name: "Saved research memo" });
    fireEvent.click(screen.getByRole("button", { name: "Promote to Note" }));
    expect(screen.getByRole("button", { name: "Create reviewed Note" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reviewed note text/), { target: { value: "I verified the guidance is still relevant." } });
    fireEvent.click(screen.getByLabelText(/I reviewed this text/));
    fireEvent.click(screen.getByRole("button", { name: "Create reviewed Note" }));
    await waitFor(() => expect(promoteBrainMemoToNoteMock).toHaveBeenCalledWith("memo-1", {
      title: memo.title, body: "I verified the guidance is still relevant.",
      symbol: null, tags: [], effective_at: new Date(memo.generated_at).toISOString(),
    }));
    expect(await screen.findByText(/Reviewed Note created/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Notes" })).toHaveAttribute("href", "/equity/notes");
  });

  it("opens a memo from a provenance deep link even when it is not in the first list page", async () => {
    listBrainMemosMock.mockResolvedValue([]);
    renderWithProviders(<BrainLogPanel />, "/equity/brain?memo=memo-1#brain-log");
    expect(await screen.findByRole("region", { name: "Saved research memo" })).toBeInTheDocument();
    expect(getBrainMemoMock).toHaveBeenCalledWith("memo-1");
  });

  it("marks changed evidence without rewriting the saved answer", async () => {
    getBrainMemoEvidenceStatusMock.mockResolvedValue({ status: "stale", checked_at: "2026-09-23T10:00:00Z", citations: [{ n: 1, status: "changed" }] });
    renderWithProviders(<BrainLogPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /What changed\?/ }));
    expect(await screen.findByText(/Some cited evidence changed or is unavailable/)).toBeInTheDocument();
    expect(screen.getByText("Source changed")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Saved research memo" })).toHaveTextContent(memo.answer);
    fireEvent.click(screen.getByRole("button", { name: "Promote to Note" }));
    expect(screen.getByText(/Check current sources before confirming this Note/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Recheck" }));
    await waitFor(() => expect(getBrainMemoEvidenceStatusMock).toHaveBeenCalledTimes(2));
  });

  it("does not call evidence current when the check fails", async () => {
    getBrainMemoEvidenceStatusMock.mockRejectedValue(new Error("offline"));
    renderWithProviders(<BrainLogPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /What changed\?/ }));
    expect(await screen.findByText(/Citation status is unknown/)).toBeInTheDocument();
    expect(screen.queryByText(/Cited source identities match/)).not.toBeInTheDocument();
  });
});
