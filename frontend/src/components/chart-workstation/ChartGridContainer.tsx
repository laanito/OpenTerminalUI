import { Children, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { GridTemplate } from "../../store/chartWorkstationStore";
import "./ChartWorkstation.css";

interface Props {
  slotCount: number;
  template: GridTemplate;
  children: ReactNode;
}

function computeGridCSS(count: number, template: GridTemplate): CSSProperties {
  if (template.arrangement === "custom" && template.customAreas) {
    return {
      gridTemplateAreas: template.customAreas,
      gridTemplateColumns: `repeat(${template.cols}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${template.rows}, minmax(min-content, 1fr))`,
    };
  }

  // Use explicit template if set (user picked from LayoutSelector)
  if (template.cols > 0 && template.rows > 0) {
    return {
      gridTemplateColumns: `repeat(${template.cols}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${template.rows}, minmax(min-content, 1fr))`,
    };
  }

  // Auto-compute from slot count
  const auto: Record<number, { c: number; r: number }> = {
    1: { c: 1, r: 1 },
    2: { c: 2, r: 1 },
    3: { c: 2, r: 2 },
    4: { c: 2, r: 2 },
    5: { c: 3, r: 2 },
    6: { c: 3, r: 2 },
  };
  const { c, r } = auto[Math.min(count, 6)] ?? { c: 3, r: 2 };
  return {
    gridTemplateColumns: `repeat(${c}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${r}, minmax(min-content, 1fr))`,
  };
}

export function ChartGridContainer({ slotCount, template, children }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize(previous => previous.width === width ? previous : { width, height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const childCount = Children.toArray(children).length;
  const effectiveTemplate = useMemo(() => {
    if (size.width > 0 && size.width < 680) return { cols: 1, rows: childCount, arrangement: "grid" as const };
    if (size.width >= 680 && size.width < 1000 && template.cols > 2) return { cols: 2, rows: Math.ceil(childCount / 2), arrangement: "grid" as const };
    return template;
  }, [childCount, size.width, template]);

  const gridCss = useMemo(() => computeGridCSS(slotCount, effectiveTemplate), [effectiveTemplate, slotCount]);

  return (
    <div
      ref={containerRef}
      className="chart-grid"
      style={{ ...gridCss, minHeight: `${Math.max(1, effectiveTemplate.rows) * 440}px` }}
      data-slot-count={slotCount}
      data-grid-cols={effectiveTemplate.cols}
      data-grid-rows={effectiveTemplate.rows}
      data-testid="chart-grid"
    >
      {children}
    </div>
  );
}
