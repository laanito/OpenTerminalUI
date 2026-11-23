import { useState } from "react";

import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalInput } from "../../../components/terminal/TerminalInput";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

export function AdvancedArithmetic() {
  const { query, setQuery } = useScreenerContext();
  const [left, setLeft] = useState("Total Borrowings");
  const [op, setOp] = useState("/");
  const [right, setRight] = useState("EBITDA");
  const [cmp, setCmp] = useState("<");
  const [value, setValue] = useState("3");

  return (
    <TerminalPanel title="Advanced Arithmetic" subtitle="Expression Builder" bodyClassName="space-y-1">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Left field</span><TerminalInput value={left} onChange={(event) => setLeft(event.target.value)} /></label>
        <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Arithmetic operator</span><TerminalInput value={op} onChange={(event) => setOp(event.target.value)} /></label>
        <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Right field</span><TerminalInput value={right} onChange={(event) => setRight(event.target.value)} /></label>
        <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Comparison operator</span><TerminalInput value={cmp} onChange={(event) => setCmp(event.target.value)} /></label>
        <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Comparison value</span><TerminalInput value={value} onChange={(event) => setValue(event.target.value)} /></label>
      </div>
      <TerminalButton onClick={() => setQuery(`${query}${query ? " AND " : ""}(${left} ${op} ${right}) ${cmp} ${value}`)}>Append Equation</TerminalButton>
    </TerminalPanel>
  );
}
