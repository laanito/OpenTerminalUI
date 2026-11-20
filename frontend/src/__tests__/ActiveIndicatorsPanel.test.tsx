import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ActiveIndicatorsPanel } from "../components/analysis/ActiveIndicatorsPanel";
vi.mock("../shared/chart/IndicatorManager", () => ({ listIndicators: () => [{ id: "sma", name: "Simple moving average" }], CUSTOM_JS_INDICATORS_UPDATED_EVENT: "custom-indicators-updated" }));
it("keeps duplicate studies independent and excludes routing metadata from readable parameter labels", () => {
  const changed = vi.fn(), manage = vi.fn();
  const first = { id: "sma", instanceId: "first", params: { period: 20, __otui_indicator: { paneTarget: "overlay" } }, visible: true };
  const second = { ...first, instanceId: "second", params: { period: 50 } };
  render(<ActiveIndicatorsPanel indicators={[first, second]} onChange={changed} onManage={manage} />);
  expect(screen.getByText("period: 20")).toBeVisible(); expect(screen.queryByText(/__otui/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Hide Simple moving average instance 2" }));
  expect(changed).toHaveBeenLastCalledWith([first, { ...second, visible: false }]);
  fireEvent.click(screen.getByRole("button", { name: "Remove Simple moving average instance 1" }));
  expect(changed).toHaveBeenLastCalledWith([second]);
  fireEvent.click(screen.getByRole("button", { name: "Manage" })); expect(manage).toHaveBeenCalledOnce();
});
it("provides a clear empty state without mounting the library", () => {
  render(<ActiveIndicatorsPanel indicators={[]} onChange={vi.fn()} onManage={vi.fn()} />);
  expect(screen.getByText(/No studies selected/)).toBeVisible();
  expect(screen.queryByPlaceholderText(/Search indicators/)).not.toBeInTheDocument();
});
