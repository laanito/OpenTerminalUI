import { useState } from "react";
import { compareGovernanceRuns, promoteGovernanceModel, registerGovernanceRun } from "../api/client";
import { ResearchField, ResearchStatus, ResearchWorkspace, useResearchRun } from "../components/backtesting/ResearchWorkflow";
import { AnalyticsTable } from "../components/terminal/AnalyticsRead";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

export function ModelGovernancePage() {
  const [runId, setRunId] = useState("");
  const [dataVersionId, setDataVersionId] = useState("");
  const [codeHash, setCodeHash] = useState("");
  const [compareIds, setCompareIds] = useState("");
  const registration = useResearchRun(registerGovernanceRun, "Could not register run metadata.");
  const comparison = useResearchRun(compareGovernanceRuns, "Could not compare runs.");
  const promotion = useResearchRun(promoteGovernanceModel, "Could not promote the run.");
  const ids = compareIds.split(",").map(value => value.trim()).filter(Boolean);
  const text = (value: unknown) => value == null || value === "" ? "Not supplied" : String(value);
  return <ResearchWorkspace title="Model Governance" path="/backtesting/model-governance" description="Register existing-run metadata, compare recorded runs and add a run to the staging registry.">
    <TerminalPanel title="Run metadata" subtitle="Use the ID of an existing run">
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (runId.trim()) void registration.run({ run_id: runId.trim(), data_version_id: dataVersionId || undefined, code_hash: codeHash || undefined, execution_profile: {} }); }}>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ResearchField label="Run ID"><TerminalInput className="min-w-0 text-sm" required value={runId} onChange={event => setRunId(event.target.value)} /></ResearchField>
          <ResearchField label="Data version ID (optional)"><TerminalInput className="min-w-0 text-sm" value={dataVersionId} onChange={event => setDataVersionId(event.target.value)} /></ResearchField>
          <ResearchField label="Code hash (optional)"><TerminalInput className="min-w-0 text-sm" value={codeHash} onChange={event => setCodeHash(event.target.value)} /></ResearchField>
        </div>
        <p className="text-xs text-terminal-muted">Registration replaces the run's stored data-version and code-hash fields. Blank optional fields clear them. The existing operation also sets its execution profile to an empty object.</p>
        <TerminalButton type="submit" disabled={!runId.trim()} loading={registration.pending}>Register run metadata</TerminalButton>
      </form>
      <ResearchStatus phase={registration.phase} error={registration.error} idle="" pending="Registering the submitted run metadata…" />
      {registration.phase === "done" && <div role="status" className="mt-3 text-sm text-terminal-pos">Metadata registered for {registration.input?.run_id}.<dl className="mt-2 space-y-1 text-xs text-terminal-muted"><div><dt>Data version</dt><dd>{text(registration.input?.data_version_id)}</dd></div><div><dt>Code hash</dt><dd>{text(registration.input?.code_hash)}</dd></div></dl></div>}
    </TerminalPanel>
    <TerminalPanel title="Compare runs" subtitle="Comma-separated existing run IDs">
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (ids.length) void comparison.run(ids); }}><div className="min-w-0 flex-1 basis-80"><ResearchField label="Run IDs to compare"><TerminalInput className="min-w-0 text-sm" value={compareIds} onChange={event => setCompareIds(event.target.value)} /></ResearchField></div><TerminalButton type="submit" disabled={!ids.length} loading={comparison.pending}>Compare runs</TerminalButton></form>
      <ResearchStatus phase={comparison.phase} error={comparison.error} idle="" pending="Loading the submitted run comparison…" />
      {comparison.input && <p className="my-3 text-xs text-terminal-muted">Submitted IDs: {comparison.input.join(", ")}. Editing the field prepares the next comparison.</p>}
      {comparison.data && <><p className="mb-3 text-xs text-terminal-muted">Returned {comparison.data.length} run(s). Unreturned IDs are not confirmed by this response.</p><AnalyticsTable name="Governance run comparison" headers={["Run ID", "Status", "Data version", "Code hash", "Experiment", "Started", "Finished"]} rows={comparison.data.map(row => [text(row.id), text(row.status), text(row.data_version_id), text(row.code_hash), text(row.experiment_id), text(row.started_at), text(row.finished_at)])} /><details className="mt-3"><summary className="cursor-pointer text-sm">Returned execution profiles</summary><div className="mt-3 space-y-3">{comparison.data.map((row, index) => <section key={index} aria-label={`Execution profile ${text(row.id)}`}><h2 className="text-xs">{text(row.id)}</h2><pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(row.execution_profile ?? {}, null, 2)}</pre></section>)}</div></details></>}
    </TerminalPanel>
    <details className="rounded border border-terminal-border bg-terminal-panel p-3"><summary className="cursor-pointer text-sm">Staging registry</summary><div className="mt-3 space-y-3"><p className="text-sm">Draft target run: {runId.trim() || "Enter a Run ID above"}</p><p className="text-xs text-terminal-muted">Registry: default-model · target stage: staging. This records a registry entry for the Run ID above.</p><TerminalButton type="button" variant="accent" disabled={!runId.trim()} loading={promotion.pending} onClick={() => { if (runId.trim()) void promotion.run({ registry_name: "default-model", run_id: runId.trim(), stage: "staging" }); }}>Promote to staging</TerminalButton><ResearchStatus phase={promotion.phase} error={promotion.error} idle="" pending="Adding the submitted run to staging…" />{promotion.phase === "done" && <p role="status" className="text-sm text-terminal-pos">Run {promotion.input?.run_id} added to {promotion.input?.registry_name} · {promotion.input?.stage}.</p>}</div></details>
  </ResearchWorkspace>;
}
