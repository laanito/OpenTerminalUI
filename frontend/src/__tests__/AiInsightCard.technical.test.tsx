import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiInsightCard } from "../components/terminal/AiInsightCard";
import { researchInsight } from "./fixtures/researchTechnicalContext";

describe("instrument research technical inspection", () => {
  it("focuses exact and repeated citations and exposes dates, source and supporting closes", async () => {
    const result = researchInsight();
    result.sections[1].points = ["A competing interpretation uses the same input [TECH1]."];
    render(<AiInsightCard title="AI Investment Briefing" fetcher={vi.fn().mockResolvedValue(result)} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    const links = await screen.findAllByRole("button", { name: "Inspect TECH1 technical evidence" });
    fireEvent.click(links[0]);
    const region = screen.getByRole("region", { name: "TECH1 technical evidence" });
    expect(region).toHaveFocus();
    expect(region).toHaveTextContent("20-close moving-average gap");
    expect(region).toHaveTextContent("20 own dated closes");
    expect(screen.getByText(/exchange sessions and bar completion are unverified/)).toBeVisible();
    fireEvent.click(screen.getByText("Exact observation dates (20)"));
    expect(region).toHaveTextContent(result.technical_context!.metrics[0].observation_dates.join(", "));
    fireEvent.click(screen.getByText("Supporting adjusted closes (21)"));
    expect(screen.getByRole("table", { name: "AAPL technical supporting closes" }).querySelectorAll("tbody tr")).toHaveLength(21);
    fireEvent.click(screen.getByText("Inspect technical evidence"));
    fireEvent.click(links[1]);
    expect(region).toHaveFocus(); expect(region).toBeVisible();
  });

  it.each(["partial", "unavailable"] as const)("shows %s coverage without inventing zero values", async (kind) => {
    const result = researchInsight(kind);
    render(<AiInsightCard title="Interrogate this Coin" fetcher={vi.fn().mockResolvedValue(result)} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.click(await screen.findByText("Inspect technical evidence"));
    expect(screen.getAllByText(/No zero value is implied/)).toHaveLength(kind === "partial" ? 2 : 3);
    if (kind === "partial") expect(screen.getAllByText(/Requires 21 closes; 20 available/)).toHaveLength(2);
    else expect(screen.getByText(/Selected history feed is not supported/)).toBeVisible();
  });

  it("clears prior technical evidence while regenerating and leaves no old prose after failure", async () => {
    let reject!: (error: Error) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(researchInsight()).mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    render(<AiInsightCard title="AI Investment Briefing" fetcher={fetcher} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByText("Inspect technical evidence")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(screen.queryByText("Inspect technical evidence")).not.toBeInTheDocument();
    await act(async () => reject(new Error("interrupted")));
    expect(screen.getByText(/Could not generate AI analysis/)).toBeVisible();
    expect(screen.queryByRole("region", { name: "TECH1 technical evidence" })).not.toBeInTheDocument();
  });
});
