import { Link } from "react-router-dom";
import type { BrainCitation, BrainSource } from "../../api/brain";
import type { CitationEvidenceState } from "../../api/brainMemos";

const sourceLabels: Record<BrainSource, string> = {
  note: "Notes",
  journal: "Journal",
  portfolio: "Portfolio theses",
  holding: "Position notes",
  transaction: "Transaction notes",
};

export function scopeLabel(sources: BrainSource[]) {
  if (sources.length === 5) return "All private sources";
  return sources.map((source) => sourceLabels[source] ?? source).join(", ");
}

const evidenceLabels: Record<CitationEvidenceState, string> = {
  current: "Source matches",
  changed: "Source changed",
  unavailable: "Cited section unavailable",
  unverifiable: "Cannot verify",
};

export function CitationCard({ citation, evidenceStatus }: { citation: BrainCitation; evidenceStatus?: CitationEvidenceState }) {
  const evidenceTime = citation.effective_at ?? citation.updated_at ?? citation.recorded_at;
  const evidenceDate = evidenceTime
    ? new Date(evidenceTime).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;
  const body = (
    <div className="min-w-0 break-words rounded-sm border border-terminal-border bg-terminal-bg/60 p-2.5 transition-colors hover:border-terminal-accent/40">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 items-start gap-2 text-sm font-semibold text-terminal-text">
          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-sm border border-terminal-accent/50 text-xs text-terminal-accent">
            {citation.n}
          </span>
          {citation.title}
        </span>
        <span className="text-xs uppercase tracking-normal text-terminal-muted">
          {sourceLabels[citation.source as BrainSource] ?? citation.source}
          {evidenceDate ? ` · ${evidenceDate}` : ""}
          {typeof citation.score === "number" && Number.isFinite(citation.score) ? ` · ${(citation.score * 100).toFixed(0)}%` : ""}
        </span>
      </div>
      {evidenceStatus ? <p className={`mt-1 text-xs uppercase tracking-normal ${evidenceStatus === "current" ? "text-terminal-pos" : evidenceStatus === "changed" || evidenceStatus === "unavailable" ? "text-terminal-neg" : "text-terminal-muted"}`}>{evidenceLabels[evidenceStatus]}</p> : null}
      <p className="mt-1 text-xs leading-relaxed text-terminal-muted">{citation.snippet}</p>
    </div>
  );
  return citation.route ? <Link to={citation.route} className="block">{body}</Link> : body;
}
