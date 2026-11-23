import { useMemo, useRef, useEffect, useState } from "react";
import * as d3 from "d3-hierarchy";
import { useNavigate } from "react-router-dom";

type HeatmapData = {
  ticker: string;
  name?: string;
  changePct: number;
  value: number; // Market cap or weight
  price: number;
};

type Props = {
  data: HeatmapData[];
  width: number;
  height: number;
  sizeBy: "marketCap" | "equal";
  responsive?: boolean;
};

export function HeatmapView({ data, width: requestedWidth, height, sizeBy, responsive = false }: Props) {
  const navigate = useNavigate();
  const hostRef = useRef<HTMLDivElement>(null);
  const [hostWidth, setHostWidth] = useState(1);
  useEffect(() => {
    if (!responsive || !hostRef.current) return;
    const host = hostRef.current;
    const measure = () => setHostWidth(Math.max(1, host.clientWidth));
    measure(); const observer = new ResizeObserver(measure); observer.observe(host);
    return () => observer.disconnect();
  }, [responsive]);
  const width = responsive ? hostWidth : requestedWidth;

  const getColor = (change: number) => {
    if (change <= -5) return "#991b1b"; // Deep red
    if (change <= -2) return "#ef4444"; // Light red
    if (change >= 5) return "#166534";  // Deep green
    if (change >= 2) return "#22c55e";  // Light green
    return "#4b5563"; // Gray
  };

  const treemapData = useMemo(() => {
    const root = d3.hierarchy({ children: data })
      .sum(d => (d as any).value || 1)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    d3.treemap()
      .size([width, height])
      .padding(1)
      (root as any);

    return root.leaves().filter(leaf => "ticker" in leaf.data);
  }, [data, width, height, sizeBy]);

  return (
    <div ref={hostRef} aria-label="Watchlist heatmap" className="relative overflow-hidden" style={{ width: responsive ? "100%" : width, height: data.length ? height : 0 }}>
      <svg width={width} height={height} className="block">
        {treemapData.map((d: any, i) => {
          const item = d.data as HeatmapData;
          const rectWidth = d.x1 - d.x0;
          const rectHeight = d.y1 - d.y0;
          const color = getColor(item.changePct);
          const textColor = ["#ef4444", "#22c55e"].includes(color) ? "#0a0e14" : "white";

          return (
            <g
              key={item.ticker}
              transform={`translate(${d.x0},${d.y0})`}
              className="cursor-pointer group"
              role="link" tabIndex={0} aria-label={`Open ${item.ticker} chart · ${item.changePct.toFixed(2)}%`}
              onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); navigate(`/equity/stocks?ticker=${encodeURIComponent(item.ticker)}`); } }}
              onClick={() => navigate(`/equity/stocks?ticker=${encodeURIComponent(item.ticker)}`)}
            >
              <title>{item.ticker}: {item.changePct.toFixed(2)}%</title>
              <rect
                width={Math.max(0, rectWidth)}
                height={Math.max(0, rectHeight)}
                fill={color}
                className="transition-opacity hover:opacity-80"
              />
              {rectWidth > Math.max(60, item.ticker.length * 8 + 12) && rectHeight > 35 && (
                <text
                  x={rectWidth / 2}
                  y={rectHeight / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={textColor}
                  className="pointer-events-none select-none text-xs font-bold"
                >
                  {item.ticker}
                </text>
              )}
              {rectWidth > Math.max(60, item.ticker.length * 8 + 12) && rectHeight > 55 && (
                <text
                  x={rectWidth / 2}
                  y={rectHeight / 2 + 16}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={textColor}
                  fillOpacity={1}
                  className="pointer-events-none select-none text-xs"
                >
                  {item.changePct >= 0 ? "+" : ""}{item.changePct.toFixed(2)}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
