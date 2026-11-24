import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { LaunchpadPanelConfig } from "./LaunchpadContext";

type LaunchpadGridProps = {
  panels: LaunchpadPanelConfig[];
  renderPanel: (panel: LaunchpadPanelConfig) => ReactNode;
  onLayoutChange?: (panels: Array<Pick<LaunchpadPanelConfig, "id" | "x" | "y" | "w" | "h">>) => void;
};

export function LaunchpadGrid({ panels, renderPanel, onLayoutChange }: LaunchpadGridProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const apply = () => setWidth(Math.floor(node.clientWidth));
    apply();
    const observer = new ResizeObserver(apply); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const layout = useMemo<Layout>(() => panels.map(panel => ({ i: panel.id, x: panel.x, y: panel.y, w: panel.w, h: panel.h, minW: 3, minH: 4 })), [panels]);
  const saveGesture = (next: Layout) => onLayoutChange?.(next.map(item => ({ id: item.i, x: item.x, y: item.y, w: item.w, h: item.h })));
  return <div ref={hostRef} className={`min-w-0 ${width < 1050 ? "[&_.launchpad-drag-handle]:hidden" : ""}`} data-launchpad-grid-mode={width >= 1050 ? "arrange" : "stacked"}>
    {width >= 1050 ? <GridLayout className="launchpad-grid" width={width}
      gridConfig={{ cols: 12, rowHeight: 64, margin: [12, 12], containerPadding: [0, 0], maxRows: Infinity }}
      dragConfig={{ enabled: true, bounded: false, handle: ".launchpad-drag-handle", threshold: 3 }}
      resizeConfig={{ enabled: true, handles: ["se"] }} layout={layout}
      onDragStop={saveGesture} onResizeStop={saveGesture}>
      {panels.map(panel => <div key={panel.id} className="h-full min-h-0 min-w-0 overflow-hidden">{renderPanel(panel)}</div>)}
    </GridLayout> : <div className="grid min-w-0 gap-3">{panels.map(panel => <div key={panel.id} className="h-[480px] min-w-0 overflow-hidden">{renderPanel(panel)}</div>)}</div>}
  </div>;
}
