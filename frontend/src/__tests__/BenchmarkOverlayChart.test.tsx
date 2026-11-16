import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BenchmarkOverlayChart } from "../components/portfolio/BenchmarkOverlayChart";

describe("benchmark statistics availability", () => {
  it("does not turn unavailable short-history metrics into zero returns", () => {
    render(<BenchmarkOverlayChart data={{ benchmark: "SPY", alpha: null, tracking_error: null, equity_curve: [] }} />);
    expect(screen.getByText("Alpha Unavailable | Tracking Error Unavailable")).toBeVisible();
    expect(screen.queryByText(/0.00%/)).not.toBeInTheDocument();
  });
  it("preserves a computed zero rather than treating it as missing", () => {
    render(<BenchmarkOverlayChart data={{ benchmark: "SPY", alpha: 0, tracking_error: 0, equity_curve: [] }} />);
    expect(screen.getByText("Alpha 0.00% | Tracking Error 0.00%")).toBeVisible();
  });
});
