/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OpsDashboardPage } from "../pages/OpsDashboard";

vi.mock("../api/client", () => ({
  fetchFeedHealth: vi.fn(async () => ({
    kite_stream_status: "uninitialized",
    us_primary_provider: "none",
    ws_connected_clients: 0,
    ws_subscriptions: 0,
    timestamp: "2026-09-03T12:00:00Z",
  })),
  fetchKillSwitches: vi.fn(async () => []),
  fetchOpsDataQuality: vi.fn(async () => ({
    timestamp: "2026-09-03T12:00:00Z",
    symbols: [],
    us_stream: { primary_provider: "none" },
  })),
}));

describe("OpsDashboardPage truth contract", () => {
  it("shows measured compatibility state without fabricated operational controls", async () => {
    render(<OpsDashboardPage />);

    expect(screen.getByText("System Monitor")).toBeInTheDocument();
    expect(screen.getByText(/No execution controls are exposed here/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("none").length).toBeGreaterThan(0));
    expect(screen.getByText("No global kill switches are configured.")).toBeInTheDocument();

    expect(screen.queryByText(/DEPLOY ALPHA-V3/)).not.toBeInTheDocument();
    expect(screen.queryByText(/MEAN_REVERSION_5M/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Emergency exit all active positions/)).not.toBeInTheDocument();
  });
});
