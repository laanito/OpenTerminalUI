import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Pin, Trash2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { extractApiErrorMessage } from "../../api/base";
import {
  deleteBrainMemo,
  getBrainMemo,
  getBrainMemoEvidenceStatus,
  listBrainMemos,
  updateBrainMemo,
  type BrainMemo,
} from "../../api/brainMemos";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalModal } from "../terminal/TerminalModal";
import { CitationCard, scopeLabel } from "./BrainEvidence";
import { BrainMemoPromotionModal } from "./BrainMemoPromotionModal";
import { BrainTechnicalAnswer } from "./BrainTechnicalEvidence";

const PAGE_SIZE = 25;

function dateLabel(value: string) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function MemoDetail({ memo, onDeleted }: { memo: BrainMemo; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(memo.title);
  const [symbol, setSymbol] = useState(memo.symbol ?? "");
  const [tags, setTags] = useState(memo.tags.join(", "));
  const [annotation, setAnnotation] = useState(memo.annotation);
  const [pinned, setPinned] = useState(memo.pinned);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promotedNoteId, setPromotedNoteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const evidence = useQuery({
    queryKey: ["brain", "memo-evidence", memo.id],
    queryFn: () => getBrainMemoEvidenceStatus(memo.id),
  });
  const evidenceResult = evidence.isError || evidence.isFetching ? undefined : evidence.data;

  const update = useMutation({
    mutationFn: () => updateBrainMemo(memo.id, {
      title: title.trim().slice(0, 256),
      symbol: symbol.trim().slice(0, 64) || null,
      tags: [...new Set(tags.split(",").map((tag) => tag.trim()).filter(Boolean))],
      annotation: annotation.trim(),
      pinned,
    }),
    onMutate: () => setError(null),
    onSuccess: (saved) => {
      queryClient.setQueryData(["brain", "memo", memo.id], saved);
      void queryClient.invalidateQueries({ queryKey: ["brain", "memos"] });
    },
    onError: (err) => setError(extractApiErrorMessage(err, "Could not update memo.")),
  });

  const remove = useMutation({
    mutationFn: () => deleteBrainMemo(memo.id),
    onMutate: () => setError(null),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["brain", "memo", memo.id] });
      void queryClient.invalidateQueries({ queryKey: ["brain", "memos"] });
      onDeleted();
    },
    onError: (err) => {
      setConfirmDelete(false);
      setError(extractApiErrorMessage(err, "Could not delete memo."));
    },
  });

  return (
    <section aria-label="Saved research memo" className="space-y-4 rounded-sm border border-terminal-border bg-terminal-bg/40 p-3">
      <div>
        <h3 className="text-sm font-semibold text-terminal-text">{memo.title}</h3>
        <p className="mt-1 text-[11px] text-terminal-muted">
          Generated {dateLabel(memo.generated_at)} · Evidence scope: {scopeLabel(memo.sources)}
          {memo.llm_model ? ` · ${memo.llm_provider ? `${memo.llm_provider} / ` : ""}${memo.llm_model}` : ""}
        </p>
      </div>
      <div className="space-y-1 text-xs text-terminal-text">
        <p className="font-semibold">{memo.question}</p>
        <BrainTechnicalAnswer answer={memo.answer} context={memo.technical_context} saved />
      </div>
      <div className="space-y-1.5 rounded-sm border border-terminal-border bg-terminal-bg/60 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wide text-terminal-muted">Evidence identity check</p>
          <TerminalButton type="button" size="sm" variant="ghost" loading={evidence.isFetching} onClick={() => void evidence.refetch()}>Recheck</TerminalButton>
        </div>
        {evidence.isFetching ? <p role="status" className="text-[11px] text-terminal-muted">Checking saved citations against current sources…</p> : null}
        {evidence.isError ? <p role="alert" className="text-[11px] text-terminal-neg">Could not check current evidence. Citation status is unknown.</p> : null}
        {evidenceResult?.status === "current" ? <p role="status" className="text-[11px] text-terminal-pos">Cited source identities match current records. This does not verify the answer's claims.</p> : null}
        {evidenceResult?.status === "stale" ? <p role="status" className="text-[11px] text-terminal-neg">Some cited evidence changed or is unavailable. Review current sources before reusing or promoting this answer.</p> : null}
        {evidenceResult?.status === "unverifiable" ? <p role="status" className="text-[11px] text-terminal-muted">Citation status cannot be verified from this snapshot.</p> : null}
        {evidenceResult ? <p className="text-[10px] text-terminal-muted">Checked {dateLabel(evidenceResult.checked_at)} · This compares source identity, not whether the conclusion is correct.</p> : null}
      </div>
      {memo.citations.length ? (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-terminal-muted">Cited evidence at generation time</p>
          {memo.citations.map((citation) => <CitationCard key={citation.n} citation={citation} evidenceStatus={evidenceResult?.citations.find((item) => item.n === citation.n)?.status} />)}
        </div>
      ) : null}
      <div className="space-y-2 border-t border-terminal-border pt-3">
        <p className="text-[11px] text-terminal-muted">Turn this historical synthesis into your own reviewed Note only if its claims are still useful. The memo stays unchanged.</p>
        <TerminalButton type="button" size="sm" onClick={() => setPromoteOpen(true)}>Promote to Note</TerminalButton>
        {promotedNoteId ? <p role="status" className="text-[11px] text-terminal-pos">Reviewed Note created; indexing was queued. <Link to="/equity/notes" className="underline">Open Notes</Link>.</p> : null}
      </div>
      <form className="space-y-3 border-t border-terminal-border pt-3" onSubmit={(event) => { event.preventDefault(); update.mutate(); }}>
        <p className="text-[10px] uppercase tracking-wide text-terminal-muted">Organize this memo · answer and evidence are fixed</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-[11px] text-terminal-muted">Title
            <TerminalInput value={title} maxLength={256} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="space-y-1 text-[11px] text-terminal-muted">Symbol (optional)
            <TerminalInput value={symbol} maxLength={64} onChange={(event) => setSymbol(event.target.value)} />
          </label>
        </div>
        <label className="block space-y-1 text-[11px] text-terminal-muted">Tags (comma-separated)
          <TerminalInput value={tags} onChange={(event) => setTags(event.target.value)} />
        </label>
        <label className="block space-y-1 text-[11px] text-terminal-muted">Your annotation
          <TerminalInput as="textarea" rows={3} value={annotation} maxLength={10000} onChange={(event) => setAnnotation(event.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-terminal-muted">
          <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} /> Pin this memo
        </label>
        {error ? <p role="alert" className="text-[11px] text-terminal-neg">{error}</p> : null}
        {update.isSuccess ? <p role="status" className="text-[11px] text-terminal-pos">Changes saved.</p> : null}
        <div className="flex justify-between gap-2">
          <TerminalButton type="submit" size="sm" variant="accent" loading={update.isPending}>Save details</TerminalButton>
          <TerminalButton type="button" size="sm" variant="danger" leftIcon={<Trash2 className="h-3 w-3" />} onClick={() => setConfirmDelete(true)}>Delete memo</TerminalButton>
        </div>
      </form>
      <TerminalModal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete research memo?" busy={remove.isPending} size="sm"
        footer={<div className="flex justify-end gap-2"><TerminalButton size="sm" onClick={() => setConfirmDelete(false)}>Cancel</TerminalButton><TerminalButton size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Delete permanently</TerminalButton></div>}>
        <p className="text-xs text-terminal-text">This removes the saved answer and citation snapshot. Notes promoted from it remain, but their source-memo link will no longer resolve. Original evidence is unaffected.</p>
      </TerminalModal>
      {promoteOpen ? <BrainMemoPromotionModal memo={memo} evidenceStatus={evidenceResult?.status ?? "unknown"} onClose={() => setPromoteOpen(false)} onPromoted={(noteId) => { setPromotedNoteId(noteId); setPromoteOpen(false); }} /> : null}
    </section>
  );
}

export function BrainLogPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("memo");
  const setSelectedId = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("memo", id);
    else next.delete("memo");
    setSearchParams(next);
  };
  const [symbolInput, setSymbolInput] = useState("");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const list = useInfiniteQuery({
    queryKey: ["brain", "memos", symbolFilter, pinnedOnly],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listBrainMemos(pageParam, PAGE_SIZE, symbolFilter || undefined, pinnedOnly || undefined),
    getNextPageParam: (lastPage, pages) => lastPage.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
  });
  const detail = useQuery({
    queryKey: ["brain", "memo", selectedId],
    queryFn: () => getBrainMemo(selectedId!),
    enabled: Boolean(selectedId),
  });
  const memos = list.data?.pages.flat() ?? [];

  return (
    <div id="brain-log">
      <TerminalPanel title="Brain Log" subtitle="Saved, dated answers — not automatically reused as evidence" actions={<Bookmark className="h-4 w-4 text-terminal-accent" />}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <form className="flex min-w-48 flex-1 items-end gap-2" onSubmit={(event) => { event.preventDefault(); setSymbolFilter(symbolInput.trim().toUpperCase()); setSelectedId(null); }}>
              <label className="flex-1 space-y-1 text-[11px] text-terminal-muted">Filter by symbol
                <TerminalInput size="sm" value={symbolInput} onChange={(event) => setSymbolInput(event.target.value)} placeholder="e.g. MSFT" />
              </label>
              <TerminalButton type="submit" size="sm">Apply</TerminalButton>
            </form>
            <label className="flex min-h-8 items-center gap-2 text-[11px] text-terminal-muted">
              <input type="checkbox" checked={pinnedOnly} onChange={(event) => { setPinnedOnly(event.target.checked); setSelectedId(null); }} /> Pinned only
            </label>
          </div>
          {list.isPending ? <p role="status" className="text-xs text-terminal-muted">Loading saved research…</p> : null}
          {list.isError ? <p role="alert" className="text-xs text-terminal-neg">{extractApiErrorMessage(list.error, "Could not load Brain Log.")}</p> : null}
          {list.isError ? <TerminalButton size="sm" onClick={() => void list.refetch()}>Retry</TerminalButton> : null}
          {list.isSuccess && memos.length === 0 && !selectedId ? <p className="text-xs text-terminal-muted">{symbolFilter || pinnedOnly ? "No saved memos match these filters." : "No saved answers yet. Ask your Second Brain, then save a completed answer here."}</p> : null}
          {memos.length || selectedId ? (
            <div className="grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_minmax(0,2fr)]">
              <div className="space-y-1.5" aria-label="Saved memos">
                {memos.map((memo) => (
                  <button key={memo.id} type="button" aria-pressed={selectedId === memo.id} onClick={() => setSelectedId(memo.id)}
                    className={`block w-full rounded-sm border p-2.5 text-left transition-colors ${selectedId === memo.id ? "border-terminal-accent bg-terminal-accent/10" : "border-terminal-border bg-terminal-bg/40 hover:border-terminal-accent/40"}`}>
                    <span className="flex items-center gap-1 text-xs font-semibold text-terminal-text">{memo.pinned ? <Pin aria-label="Pinned" className="h-3 w-3 text-terminal-accent" /> : null}{memo.title}</span>
                    <span className="mt-1 block text-[10px] text-terminal-muted">{dateLabel(memo.generated_at)}{memo.symbol ? ` · ${memo.symbol}` : ""} · {memo.citation_count} citations</span>
                    {memo.tags.length ? <span className="mt-1 block text-[10px] text-terminal-accent">{memo.tags.join(" · ")}</span> : null}
                    <span className="mt-1 line-clamp-2 block text-[11px] text-terminal-muted">{memo.answer_preview}</span>
                  </button>
                ))}
                {list.hasNextPage ? <TerminalButton size="sm" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</TerminalButton> : null}
                {list.isFetchNextPageError ? <p role="alert" className="text-[11px] text-terminal-neg">Could not load older memos. Try again.</p> : null}
              </div>
              <div>
                {!selectedId ? <p className="text-xs text-terminal-muted">Select a saved memo to read its answer and cited evidence.</p> : null}
                {selectedId && detail.isPending ? <p role="status" className="text-xs text-terminal-muted">Loading memo…</p> : null}
                {detail.isError ? <p role="alert" className="text-xs text-terminal-neg">{extractApiErrorMessage(detail.error, "Could not load memo.")}</p> : null}
                {detail.isError ? <TerminalButton size="sm" onClick={() => void detail.refetch()}>Retry</TerminalButton> : null}
                {detail.data ? <MemoDetail key={detail.data.id} memo={detail.data} onDeleted={() => setSelectedId(null)} /> : null}
              </div>
            </div>
          ) : null}
        </div>
      </TerminalPanel>
    </div>
  );
}
