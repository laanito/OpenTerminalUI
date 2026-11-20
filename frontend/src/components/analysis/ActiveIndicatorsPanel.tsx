import { useEffect, useMemo, useState } from "react";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalButton } from "../terminal/TerminalButton";
import { listIndicators, CUSTOM_JS_INDICATORS_UPDATED_EVENT } from "../../shared/chart/IndicatorManager";
import { getIndicatorEditableParams } from "../../shared/chart/indicatorCatalog";
import type { IndicatorConfig } from "../../shared/chart/types";

export function ActiveIndicatorsPanel({ indicators, onChange, onManage }: { indicators: IndicatorConfig[]; onChange: (next: IndicatorConfig[]) => void; onManage: () => void }) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const update = () => setVersion(value => value + 1);
    window.addEventListener(CUSTOM_JS_INDICATORS_UPDATED_EVENT, update);
    return () => window.removeEventListener(CUSTOM_JS_INDICATORS_UPDATED_EVENT, update);
  }, []);
  const names = useMemo(() => new Map(listIndicators().map(item => [item.id, item.name])), [version]);
  return <TerminalPanel title="Active indicators" actions={<TerminalButton size="sm" onClick={onManage}>Manage</TerminalButton>}>
    {!indicators.length ? <p className="text-sm text-terminal-muted">No studies selected. Open Manage to add an indicator.</p> : <ul tabIndex={0} className="max-h-96 space-y-3 overflow-y-auto" aria-label="Selected chart indicators">
      {indicators.map((indicator, index) => {
        const name = names.get(indicator.id) || indicator.id;
        return <li key={indicator.instanceId} className="min-w-0 rounded border border-terminal-border p-2">
          <p className="break-words text-sm font-medium text-terminal-text">{name}</p>
          <p className="mt-1 break-words text-xs text-terminal-muted">{Object.entries(getIndicatorEditableParams(indicator)).map(([key, value]) => `${key}: ${value}`).join(" · ") || "Default parameters"}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <TerminalButton size="sm" aria-label={`${indicator.visible ? "Hide" : "Show"} ${name} instance ${index + 1}`} onClick={() => onChange(indicators.map(item => item.instanceId === indicator.instanceId ? { ...item, visible: !item.visible } : item))}>{indicator.visible ? "Hide" : "Show"}</TerminalButton>
            <TerminalButton size="sm" aria-label={`Remove ${name} instance ${index + 1}`} onClick={() => onChange(indicators.filter(item => item.instanceId !== indicator.instanceId))}>Remove</TerminalButton>
          </div>
        </li>;
      })}
    </ul>}
  </TerminalPanel>;
}
