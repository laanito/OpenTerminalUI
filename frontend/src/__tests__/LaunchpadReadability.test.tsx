import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LaunchpadGrid } from "../components/layout/LaunchpadGrid";
import { PanelHeader } from "../components/layout/PanelChrome";
import type { LaunchpadPanelConfig } from "../components/layout/LaunchpadContext";

const grid = vi.hoisted(() => ({ props: null as any }));
vi.mock("react-grid-layout", () => ({ default: (props: any) => { grid.props = props; return <div>{props.children}</div>; } }));
let size = 390;
let resize: () => void;
const panel = { id: "research", type: "news-feed", title: "Dated worldwide research", symbol: "SAP.DE", x: 7, y: 6, w: 5, h: 4, linked: true, linkGroup: "blue" } as LaunchpadPanelConfig;
beforeEach(() => {
  grid.props = null; size = 390;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => size);
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("Launchpad responsive preservation", () => {
  it("stacks narrow panels and restores a wide grid without persisting viewport changes", () => {
    const save = vi.fn(); const { container } = render(<LaunchpadGrid panels={[panel]} renderPanel={row => <div>{row.title}</div>} onLayoutChange={save} />);
    expect(container.querySelector('[data-launchpad-grid-mode="stacked"]')).toBeInTheDocument();
    act(() => { size = 1300; resize(); });
    expect(grid.props.layout[0]).toMatchObject({ i: "research", x: 7, y: 6, w: 5, h: 4 });
    grid.props.onLayoutChange?.([{ i: "research", x: 0, y: 0, w: 12, h: 8 }]);
    act(() => { size = 390; resize(); });
    expect(save).not.toHaveBeenCalled();
    expect(panel).toMatchObject({ x: 7, y: 6, w: 5, h: 4 });
  });
  it("persists explicit grid gestures with stable panel IDs", () => {
    size = 1300; const save = vi.fn();
    render(<LaunchpadGrid panels={[panel]} renderPanel={() => <div />} onLayoutChange={save} />);
    grid.props.onResizeStop([{ i: "research", x: 7, y: 6, w: 5, h: 7 }]);
    expect(save).toHaveBeenCalledWith([{ id: "research", x: 7, y: 6, w: 5, h: 7 }]);
    grid.props.onDragStop([{ i: "research", x: 0, y: 0, w: 5, h: 7 }]);
    expect(save).toHaveBeenLastCalledWith([{ id: "research", x: 0, y: 0, w: 5, h: 7 }]);
  });
  it("builds popouts from panel metadata without relying on truncated header controls", () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window); const detached = vi.fn();
    render(<section data-launchpad-panel-id="research" data-launchpad-panel-type="news-feed" data-launchpad-panel-title={panel.title} data-launchpad-panel-symbol="SAP.DE"><PanelHeader title={panel.title} linkGroup="blue" onPopout={detached} /></section>);
    fireEvent.click(screen.getByRole("button", { name: "Pop out to new window" }));
    const url = new URL(String(open.mock.calls[0][0]));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ id: "research", type: "news-feed", title: panel.title, symbol: "SAP.DE", linkGroup: "blue", linked: "1" });
    expect(detached).toHaveBeenCalledTimes(1);
  });
});
