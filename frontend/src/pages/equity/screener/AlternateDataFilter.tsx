import { useState } from "react";

import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalInput } from "../../../components/terminal/TerminalInput";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

export function AlternateDataFilter() {
  const { query, setQuery } = useScreenerContext();
  const [sector, setSector] = useState("Chemicals");

  return (
    <TerminalPanel title="Alternate Data" subtitle="Tijori-style filters">
      <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Sector</span><TerminalInput as="select" value={sector} onChange={(event) => setSector(event.target.value)}>
          <option>Chemicals</option>
          <option>Electronics</option>
          <option>Textiles</option>
          <option>Pharma API</option>
          <option>Auto Components</option>
        </TerminalInput></label>
        <TerminalButton onClick={() => setQuery(`${query}${query ? " AND " : ""}Sector = '${sector}'`)}>Add Sector</TerminalButton>
      </div>
    </TerminalPanel>
  );
}
