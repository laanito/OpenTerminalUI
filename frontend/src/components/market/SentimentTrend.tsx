import type { DailySentimentPoint } from "../../api/types";
import { terminalColors } from "../../theme/terminal";

type Props = {
  data: DailySentimentPoint[];
};

const WIDTH = 600;
const HEIGHT = 100;
const PAD_X = 8;
const PAD_Y = 8;

function clampScore(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function coordinates(data: DailySentimentPoint[]): Array<{ x: number; y: number; point: DailySentimentPoint }> {
  const rangeX = WIDTH - PAD_X * 2;
  const rangeY = HEIGHT - PAD_Y * 2;
  return data.map((point, index) => ({
    x: data.length === 1 ? WIDTH / 2 : PAD_X + (index / (data.length - 1)) * rangeX,
    y: PAD_Y + ((1 - clampScore(point.avg_score)) / 2) * rangeY,
    point,
  }));
}

/** Small dependency-free chart for the axis-free News sentiment trend. */
export function SentimentTrend({ data }: Props) {
  const plotted = coordinates(data);
  if (!plotted.length) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-terminal-muted">
        No daily sentiment trend yet
      </div>
    );
  }

  const polyline = plotted.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg
      aria-label="Daily sentiment trend"
      className="h-full w-full"
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    >
      <line
        stroke={terminalColors.border}
        strokeDasharray="4 4"
        strokeWidth="1"
        x1={PAD_X}
        x2={WIDTH - PAD_X}
        y1={HEIGHT / 2}
        y2={HEIGHT / 2}
      />
      <polyline
        fill="none"
        points={polyline}
        stroke={terminalColors.accent}
        strokeLinejoin="round"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      {plotted.map(({ x, y, point }) => (
        <circle key={point.date} cx={x} cy={y} fill={terminalColors.accent} r="3" vectorEffect="non-scaling-stroke">
          <title>{`${point.date}: ${clampScore(point.avg_score).toFixed(2)} from ${point.count} article${point.count === 1 ? "" : "s"}`}</title>
        </circle>
      ))}
    </svg>
  );
}
