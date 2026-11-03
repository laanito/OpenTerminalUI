import { useState, type ReactNode } from "react";
import type { BrainTechnicalContext } from "../../api/brainTechnical";
import { ResearchTechnicalEvidence, technicalCitations, type TechnicalInspection } from "../terminal/ResearchTechnicalEvidence";

export function BrainTechnicalAnswer({ answer, context, saved = false }: { answer: string; context?: BrainTechnicalContext | null; saved?: boolean }) {
  const [inspection, setInspection] = useState<TechnicalInspection>(null);
  const inspect = (id: string) => setInspection((previous) => ({ id, sequence: (previous?.sequence ?? 0) + 1 }));
  let formatted: ReactNode = answer;
  if (context && context.groups.length) {
    // Split once by all known group-local references, then use each evidence
    // renderer's own exact ID set. No arbitrary HTML or global DOM targets.
    formatted = answer.split(/(\[T[1-3]\.[1-3]\])/g).map((part, index) => {
      const group = context.groups.find((item) => item.metrics.some((metric) => `[${metric.citation_id}]` === part));
      return <span key={index}>{group ? technicalCitations(part, group, inspect) : part}</span>;
    });
  }
  const skipped: Record<string, string> = {
    private_context_unavailable: "No current technical history was fetched because matching private research was unavailable.",
    model_disabled: "The model is disabled; no current technical history was fetched.",
    preparation_timeout: "Preparation reached its deadline before technical evidence was available.",
  };
  return <>
    <p className="whitespace-pre-wrap text-xs leading-relaxed text-terminal-text">{formatted}</p>
    {context && <section aria-label="Brain technical evidence" className="space-y-2 rounded border border-terminal-border p-2">
      <p className="text-[11px] text-terminal-muted">Technical scope · {context.requested_symbols.join(", ")} · {context.status}</p>
      {saved ? <p className="text-[11px] text-terminal-warn">Saved market snapshots are shown as captured. Rechecking private citations does not refresh these market observations.</p>
        : <p className="text-[11px] text-terminal-muted">Current technical observations are separate from your dated private research; they are not automatically indexed.</p>}
      {context.status === "skipped" ? <p className="text-xs text-terminal-muted">{skipped[context.reason ?? ""]}</p> : context.groups.map((group) => (
        <ResearchTechnicalEvidence key={group.symbol} evidence={group}
          inspection={inspection && group.metrics.some((metric) => metric.citation_id === inspection.id) ? inspection : null} />
      ))}
    </section>}
  </>;
}
