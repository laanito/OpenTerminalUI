import type { ReactNode } from "react";
import type { PortfolioTechnicalContext } from "../../api/portfolioTechnicalContext";
import { ResearchTechnicalEvidence, technicalCitations, type TechnicalInspection } from "../terminal/ResearchTechnicalEvidence";

export function portfolioTechnicalCitations(text: string, context: PortfolioTechnicalContext, inspect: (id: string) => void): ReactNode {
  return text.split(/(\[H[1-3]\.[1-3]\])/g).map((part, index) => {
    const group = context.groups.find((item) => item.metrics.some((metric) => `[${metric.citation_id}]` === part));
    return <span key={index}>{group ? technicalCitations(part, group, inspect) : part}</span>;
  });
}
export function PortfolioTechnicalEvidence({ context, inspection }: { context: PortfolioTechnicalContext; inspection: TechnicalInspection }) {
  return <section aria-label="Portfolio technical evidence" className="space-y-2 rounded border border-terminal-border p-2 text-xs">
    <p>Selected holdings · {context.selected_symbols.length} of {context.total_held_symbols} held symbols · {context.status}</p>
    <p className="text-terminal-muted">Coverage counts symbols, not portfolio value. Unselected holdings have no technical observations here. Position quantities are not exposure weights; single-asset volatility is not portfolio risk. No technical aggregation is computed.</p>
    {context.groups.map((group, index) => {
      const position = context.positions[index];
      return <div key={group.symbol}>
        <p>{group.symbol} · recorded quantity {position.quantity} across {position.lot_count} lot(s) · cost currencies {position.recorded_cost_currencies.join(", ") || "unknown"}{position.unknown_cost_currency && position.recorded_cost_currencies.length ? "; some unknown" : ""}.</p>
        <ResearchTechnicalEvidence evidence={group} inspection={inspection && group.metrics.some((metric) => metric.citation_id === inspection.id) ? inspection : null} />
      </div>;
    })}
  </section>;
}
