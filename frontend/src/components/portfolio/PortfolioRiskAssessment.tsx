import { useState } from "react";
import { fetchAiRiskInsights } from "../../api/client";
import type { MultiPortfolioHolding } from "../../api/client";
import { AiInsightCard } from "../terminal/AiInsightCard";

export function PortfolioRiskAssessment({ portfolioId, holdings, metrics, disabled, metricsAvailable = true }: {
  portfolioId: string; holdings: MultiPortfolioHolding[]; metrics: Record<string, unknown>; disabled: boolean; metricsAvailable?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const symbols = [...new Set(holdings.filter((row) => row.shares > 0 && Number.isFinite(row.shares)).map((row) => row.symbol.trim().toUpperCase()))].sort();
  const eligible = symbols.filter((symbol) => /^[A-Z0-9^._=-]{1,40}$/.test(symbol));
  const active = selected.filter((symbol) => eligible.includes(symbol));
  // Changing holdings or selected scope unmounts the old lifecycle, cancelling
  // pending work and clearing completed prose/evidence before another Generate.
  const scopeKey = JSON.stringify([portfolioId, active, holdings.map((row) => [row.id, row.symbol, row.shares, row.currency, row.cost_basis_currency, row.lot_id]), metrics]);
  return <div className="min-w-0 space-y-2">
    <fieldset disabled={disabled} className="space-y-2 rounded border border-terminal-border p-2 text-xs">
      <legend className="px-1 text-terminal-muted">Optional holding technical context · up to 3 symbols</legend>
      <p className="text-terminal-muted">Choose held symbols relevant to this assessment. Generate collects their daily observations. Coverage is by symbol; no portfolio weights or aggregate technical risk are inferred.</p>
      <div className="flex flex-wrap gap-2">{eligible.map((symbol) => <button type="button" key={symbol} aria-pressed={active.includes(symbol)}
        disabled={!active.includes(symbol) && active.length >= 3} className="rounded border border-terminal-border px-2 py-1 text-terminal-accent disabled:opacity-50"
        onClick={() => setSelected(active.includes(symbol) ? active.filter((value) => value !== symbol) : [...active, symbol])}>{symbol}</button>)}</div>
      <p className="text-terminal-muted">{active.length} of {symbols.length} held symbols selected{eligible.length < symbols.length ? "; some holding symbols are unsupported" : ""}.</p>
    </fieldset>
    <AiInsightCard key={scopeKey} title="AI Risk Assessment"
      description="Narrative interpretation of available portfolio metrics and selected holding technical evidence"
      disabled={disabled || (!metricsAvailable && !active.length)} disabledMessage="Wait for portfolio loading, or choose held symbols when portfolio risk metrics are unavailable."
      fetcher={(_, options) => active.length
        ? fetchAiRiskInsights(metrics, "portfolio", options, { portfolioId, symbols: active })
        : fetchAiRiskInsights(metrics, "portfolio", options)} />
  </div>;
}
