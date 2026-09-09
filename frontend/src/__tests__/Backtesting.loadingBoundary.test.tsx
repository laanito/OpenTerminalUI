import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const resultModuleLoads = vi.hoisted(() => ({
  panels: vi.fn(),
  sensitivity: vi.fn(),
  walkForward: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("../api/client", () => ({
  explainBacktest: vi.fn(),
  fetchActiveDataVersion: vi.fn(async () => ({ id: "test-version" })),
  fetchBacktestJobResult: vi.fn(),
  fetchBacktestJobStatus: vi.fn(),
  searchSymbols: vi.fn(async () => []),
  submitBacktestJob: vi.fn(),
}));

vi.mock("../components/savedViews/SavedViewsControl", () => ({
  SavedViewsControl: () => null,
}));

vi.mock("../components/backtesting/panels/BacktestingPanels", () => {
  resultModuleLoads.panels();
  const Panel = () => <div>result panel</div>;
  return {
    ChartTabPanel: Panel,
    ComparePanel: Panel,
    DrawdownTerrain3DPanel: Panel,
    DistributionPanel: Panel,
    DrawdownPanel: Panel,
    EquityCurvePanel: Panel,
    MonthlyHeatmapPanel: Panel,
    ParameterSurface3DPanel: Panel,
    RegimeEfficacy3DPanel: Panel,
    RollingMetricsPanel: Panel,
    OrderbookLiquidity3DPanel: Panel,
    ImpliedVolatilitySurface3DPanel: Panel,
    VolatilitySurface3DPanel: Panel,
    MonteCarloSimulationPanel: Panel,
    TradesPanel: Panel,
  };
});

vi.mock("../components/backtesting/panels/ParameterSensitivityHeatmap", () => {
  resultModuleLoads.sensitivity();
  return { ParameterSensitivityHeatmap: () => <div>sensitivity chart</div> };
});

vi.mock("../components/backtesting/panels/WalkForwardTimeline", () => {
  resultModuleLoads.walkForward();
  return { WalkForwardTimeline: () => <div>walk-forward chart</div> };
});

vi.mock("../components/backtesting/workspace/MosaicWorkspace", () => {
  resultModuleLoads.workspace();
  return { MosaicWorkspace: () => <div>mosaic workspace</div> };
});

import { BacktestingPage } from "../pages/Backtesting";

describe("Backtesting result loading boundary", () => {
  it("keeps visualization modules unloaded before the first result", async () => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={["/backtesting"]}
      >
        <BacktestingPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Run a backtest to load charts and result analytics.")).toBeInTheDocument();
    expect(screen.queryByText("Return Distribution")).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByDisplayValue("test-version")).toBeInTheDocument());
    expect(resultModuleLoads.panels).not.toHaveBeenCalled();
    expect(resultModuleLoads.sensitivity).not.toHaveBeenCalled();
    expect(resultModuleLoads.walkForward).not.toHaveBeenCalled();
    expect(resultModuleLoads.workspace).not.toHaveBeenCalled();
  });
});
