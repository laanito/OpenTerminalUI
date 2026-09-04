import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  AiInsightCard,
  type InsightData,
} from "../components/terminal/AiInsightCard";

const firstResult: InsightData = {
  engine: "llm",
  model: "llama3.1",
  summary: "Initial analysis",
  sections: [
    { title: "Key Risks", tone: "negative", points: ["Demand may slow"] },
  ],
  note_count: 1,
};

describe("AiInsightCard", () => {
  it("does not generate an assessment without its required facts", () => {
    const fetcher = vi.fn();
    render(
      <AiInsightCard
        title="AI Risk Assessment"
        disabled
        disabledMessage="Portfolio risk metrics are unavailable."
        fetcher={fetcher}
      />,
    );

    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    expect(screen.getByText("Portfolio risk metrics are unavailable.")).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses cache on Generate and requests a fresh result on Regenerate", async () => {
    const fetcher = vi
      .fn<(refresh?: boolean) => Promise<InsightData>>()
      .mockResolvedValueOnce(firstResult)
      .mockResolvedValueOnce({ ...firstResult, summary: "Fresh analysis" });

    render(<AiInsightCard title="Interrogate this Stock" fetcher={fetcher} />);

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(fetcher).toHaveBeenCalledWith(false);
    expect(await screen.findByText("Initial analysis")).toBeInTheDocument();
    expect(screen.getByText("llama3.1")).toBeInTheDocument();
    expect(screen.getByText(/Grounded in 1 of your note/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(fetcher).toHaveBeenLastCalledWith(true);
    expect(await screen.findByText("Fresh analysis")).toBeInTheDocument();
  });

  it("labels an unavailable LLM without claiming analysis came from a fallback", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      engine: "unavailable",
      model: "llama3.1",
      summary: "AI analysis is unavailable.",
      sections: [],
    });

    render(<AiInsightCard title="Interrogate this Coin" fetcher={fetcher} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByText("LLM unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/lexical fallback/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Start your LLM endpoint/)).toBeInTheDocument();
  });

  it("offers a retry after a request error", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("timeout"));

    render(<AiInsightCard title="AI Investment Briefing" fetcher={fetcher} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByText(/Could not generate AI analysis/)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Regenerate" });
    fireEvent.click(retry);

    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith(true));
  });
});
