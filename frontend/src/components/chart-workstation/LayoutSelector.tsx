import type { GridTemplate } from "../../store/chartWorkstationStore";
import { TerminalTooltip } from "../terminal/TerminalTooltip";
import "./ChartWorkstation.css";

const LAYOUTS: Array<{ cols: number; rows: number; label: string }> = [
  { cols: 1, rows: 1, label: "1x1" },
  { cols: 2, rows: 1, label: "2x1" },
  { cols: 2, rows: 2, label: "2x2" },
  { cols: 3, rows: 2, label: "3x2" },
  { cols: 3, rows: 3, label: "3x3" },
];

interface Props {
  current: GridTemplate;
  onChange: (t: GridTemplate) => void;
}

export function LayoutSelector({ current, onChange }: Props) {
  return (
    <div role="group" className="layout-selector" aria-label="Chart layout selector">
      {LAYOUTS.map((l) => {
        const isActive = current.cols === l.cols && current.rows === l.rows;
        return (
          <TerminalTooltip key={l.label} content={`Layout ${l.label}`} side="bottom">
            <button
              type="button"
              title={l.label}
              aria-label={`Layout ${l.label}`}
              aria-pressed={isActive}
              className={`layout-btn ${isActive ? "active" : ""}`}
              onClick={() => onChange({ cols: l.cols, rows: l.rows, arrangement: "grid" })}
            >
              <span aria-hidden="true" className="grid gap-px"
                style={{
                  gridTemplateColumns: `repeat(${l.cols}, 6px)`,
                  gridTemplateRows: `repeat(${l.rows}, 6px)`,
                }}
              >
                {Array.from({ length: l.cols * l.rows }).map((_, i) => <span key={i} className="layout-btn-cell" />)}
              </span>
              <span className="text-xs">{l.label}</span>
            </button>
          </TerminalTooltip>
        );
      })}
    </div>
  );
}
