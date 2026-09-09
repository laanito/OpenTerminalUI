import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SentimentTrend } from "../components/market/SentimentTrend";

describe("SentimentTrend", () => {
  it("plots bounded daily scores with accessible point details", () => {
    const { container } = render(
      <SentimentTrend
        data={[
          { date: "2026-09-08", avg_score: -2, count: 1 },
          { date: "2026-09-09", avg_score: 0.75, count: 3 },
        ]}
      />,
    );

    expect(screen.getByRole("img", { name: "Daily sentiment trend" })).toBeInTheDocument();
    expect(container.querySelector("polyline")?.getAttribute("points")).toBe("8.0,92.0 592.0,18.5");
    expect(screen.getByText("2026-09-08: -1.00 from 1 article")).toBeInTheDocument();
    expect(screen.getByText("2026-09-09: 0.75 from 3 articles")).toBeInTheDocument();
  });

  it("labels an empty trend instead of rendering an empty chart", () => {
    render(<SentimentTrend data={[]} />);
    expect(screen.getByText("No daily sentiment trend yet")).toBeInTheDocument();
  });
});
