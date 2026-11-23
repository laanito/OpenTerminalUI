import { TerminalInput } from "../../../components/terminal/TerminalInput";
import { TerminalButton } from "../../../components/terminal/TerminalButton";
import type { ScreenerView } from "./ScreenerContext";
import { useScreenerContext } from "./ScreenerContext";

const views: Array<{ id: ScreenerView; label: string }> = [
  { id: "table", label: "Table" },
  { id: "charts", label: "Charts" },
  { id: "treemap", label: "Treemap" },
  { id: "scatter", label: "Scatter" },
  { id: "scorecard", label: "Scorecard" },
  { id: "split", label: "Split" },
];

export function ViewToggle() {
  const { view, setView } = useScreenerContext();
  return (
    <div role="group" aria-label="Result view" className="min-w-0">
      <label className="flex items-center gap-3 sm:hidden"><span className="shrink-0 text-xs text-terminal-muted">Result view</span><TerminalInput as="select" value={view} onChange={event => setView(event.target.value as ScreenerView)}>{views.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</TerminalInput></label>
      <div className="hidden flex-wrap items-center gap-2 sm:flex"><span className="text-xs text-terminal-muted">Result view</span>
        {views.map((item) => (
          <TerminalButton aria-pressed={view === item.id} key={item.id} variant={view === item.id ? "accent" : "default"} onClick={() => setView(item.id)}>
            {item.label}
          </TerminalButton>
        ))}
      </div>
    </div>
  );
}
