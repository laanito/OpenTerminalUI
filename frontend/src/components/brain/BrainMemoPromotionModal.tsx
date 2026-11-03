import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { extractApiErrorMessage } from "../../api/base";
import { promoteBrainMemoToNote, type BrainMemo } from "../../api/brainMemos";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalModal } from "../terminal/TerminalModal";

function localDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function BrainMemoPromotionModal({ memo, evidenceStatus, onClose, onPromoted }: {
  memo: BrainMemo;
  evidenceStatus: "current" | "stale" | "unverifiable" | "unknown";
  onClose: () => void;
  onPromoted: (noteId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(memo.title);
  const technicalFootnotes = memo.technical_context?.groups.map((group) =>
    `${group.symbol} · captured ${group.retrieved_at} · source ${group.source ?? "unknown"}/${group.feed ?? "unknown"} · snapshot ${group.snapshot_id}\n` +
    group.metrics.map((metric) => `Captured ${metric.citation_id} · ${metric.name}: ${metric.status === "available" ? `${metric.value} ${metric.unit}` : `unavailable (${metric.reason})`}; ${metric.start_date ?? "unknown"} to ${metric.end_date ?? "unknown"}; observation ${metric.observation_id ?? "none"}.`).join("\n")
  ).join("\n\n");
  const promotedAnswer = technicalFootnotes ? memo.answer.replace(/\[(T[1-3]\.[1-3])\]/g, "(captured $1)") : memo.answer;
  const [body, setBody] = useState(promotedAnswer + (technicalFootnotes ? `\n\nCaptured technical context (descriptive, current-source history; not independently verified):\n${technicalFootnotes}\nFull supporting dates and closes remain in the saved Brain Log memo ${memo.id}.` : ""));
  const [symbol, setSymbol] = useState(memo.symbol ?? "");
  const [tags, setTags] = useState(memo.tags.join(", "));
  const [effectiveAt, setEffectiveAt] = useState(localDateTime(memo.generated_at));
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedTags = [...new Set(tags.split(",").map((tag) => tag.trim()).filter(Boolean))];
  const invalid = !body.trim() || body.length > 10000 || parsedTags.length > 32 || parsedTags.some((tag) => tag.length > 64);

  const promote = useMutation({
    mutationFn: () => promoteBrainMemoToNote(memo.id, {
      title: title.trim(),
      body: body.trim(),
      symbol: symbol.trim() || null,
      tags: parsedTags,
      effective_at: effectiveAt ? new Date(effectiveAt).toISOString() : null,
    }),
    onMutate: () => setError(null),
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: ["notes"] });
      onPromoted(note.id);
    },
    onError: (err) => setError(extractApiErrorMessage(err, "Could not promote memo to Note.")),
  });

  return (
    <TerminalModal open onClose={onClose} title="Promote to Note" subtitle="Review the text before making it Second Brain evidence" size="lg" busy={promote.isPending}
      footer={<div className="flex justify-end gap-2"><TerminalButton size="sm" onClick={onClose} disabled={promote.isPending}>Cancel</TerminalButton><TerminalButton size="sm" variant="accent" loading={promote.isPending} disabled={!confirmed || invalid} onClick={() => promote.mutate()}>Create reviewed Note</TerminalButton></div>}>
      <div className="space-y-3">
        <p className="text-[11px] text-terminal-muted">
          This is a dated model synthesis, not a verified fact. Review and edit it for accuracy and current relevance. The original memo stays unchanged; the new Note will enter Second Brain indexing.
        </p>
        {evidenceStatus === "stale" ? <p role="alert" className="text-[11px] text-terminal-neg">Some cited evidence changed or is unavailable. Check current sources before confirming this Note.</p> : null}
        {evidenceStatus === "unverifiable" || evidenceStatus === "unknown" ? <p role="alert" className="text-[11px] text-terminal-muted">Current evidence could not be fully verified. Check the cited sources before confirming this Note.</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-[11px] text-terminal-muted">Note title
            <TerminalInput value={title} maxLength={256} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="space-y-1 text-[11px] text-terminal-muted">Symbol (optional)
            <TerminalInput value={symbol} maxLength={64} onChange={(event) => setSymbol(event.target.value)} />
          </label>
        </div>
        <label className="block space-y-1 text-[11px] text-terminal-muted">Reviewed note text
          <TerminalInput as="textarea" rows={9} value={body} onChange={(event) => setBody(event.target.value)} />
          <span className={`block text-[10px] ${body.length > 10000 ? "text-terminal-neg" : "text-terminal-muted"}`}>{body.length}/10,000 characters</span>
        </label>
        <label className="block space-y-1 text-[11px] text-terminal-muted">Tags (comma-separated)
          <TerminalInput value={tags} onChange={(event) => setTags(event.target.value)} />
        </label>
        <label className="block space-y-1 text-[11px] text-terminal-muted">Effective date and time
          <TerminalInput type="datetime-local" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} />
          <span className="block text-[10px]">Defaults to the memo generation time. Change it if the reviewed information applies at another time.</span>
        </label>
        {invalid ? <p role="alert" className="text-[11px] text-terminal-neg">Note text must be 1–10,000 characters; use at most 32 tags of 64 characters each.</p> : null}
        <label className="flex items-start gap-2 text-[11px] text-terminal-text">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          I reviewed this text and want it added to my Notes as evidence.
        </label>
        {error ? <p role="alert" className="text-[11px] text-terminal-neg">{error}</p> : null}
      </div>
    </TerminalModal>
  );
}
