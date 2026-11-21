import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, StickyNote, X } from "lucide-react";
import { Link } from "react-router-dom";

import {
  createNote,
  deleteNote,
  listNotes,
  updateNote,
  type Note,
  type NoteContext,
} from "../../api/notes";
import { extractApiErrorMessage } from "../../api/base";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";

const contextBadge: Record<NoteContext, string> = {
  general: "Note",
  security: "Research",
  watchlist: "Watchlist",
  news: "News",
  holding: "Position",
  transaction: "Transaction",
  brain_memo: "From Brain Log",
};

function toIsoDateTime(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function toLocalDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function displayDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface Props {
  /** Scope notes to a symbol. Omit on the hub to show all notes. */
  symbol?: string | null;
  /** Context stamped on notes created here. */
  context?: NoteContext;
  /** Optional link back to the source object (news article id, holding id, …). */
  refId?: string | null;
  /** Compact mode for dense rows: a toggle that expands a mini composer. */
  compact?: boolean;
  /** Allow typing a symbol when none is provided (hub "general" notes). */
  allowSymbolInput?: boolean;
  className?: string;
}

export function NotesPanel({
  symbol,
  context = "general",
  refId = null,
  compact = false,
  allowSymbolInput = false,
  className = "",
}: Props) {
  const queryClient = useQueryClient();
  const effectiveAtId = useId();
  const normalizedSymbol = symbol ? symbol.toUpperCase() : undefined;
  const [body, setBody] = useState("");
  const [freeSymbol, setFreeSymbol] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editEffectiveAt, setEditEffectiveAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(!compact);

  const queryKey = ["notes", normalizedSymbol ?? "all"] as const;
  const notesQuery = useQuery({
    queryKey,
    queryFn: () => listNotes(normalizedSymbol ? { symbol: normalizedSymbol } : undefined),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ["notes", "all"] });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      createNote({
        body,
        symbol: normalizedSymbol ?? (freeSymbol.trim().toUpperCase() || null),
        context,
        ref_id: refId,
        effective_at: toIsoDateTime(effectiveAt),
      }),
    onSuccess: () => {
      setBody("");
      setFreeSymbol("");
      setEffectiveAt("");
      setError(null);
      setNotice("Note saved. Second Brain indexing was queued and may take a moment.");
      invalidate();
    },
    onError: (err) => {
      setNotice(null);
      setError(extractApiErrorMessage(err, "Failed to save note."));
    },
  });

  const editMutation = useMutation({
    mutationFn: (id: string) =>
      updateNote(id, { body: editBody, effective_at: toIsoDateTime(editEffectiveAt) }),
    onSuccess: () => {
      setEditingId(null);
      setEditBody("");
      setEditEffectiveAt("");
      setError(null);
      setNotice("Note updated. Second Brain indexing was queued and may take a moment.");
      invalidate();
    },
    onError: (err) => {
      setNotice(null);
      setError(extractApiErrorMessage(err, "Failed to update note."));
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: invalidate,
    onError: (err) => setError(extractApiErrorMessage(err, "Failed to delete note.")),
  });

  const notes = notesQuery.data ?? [];
  const count = notes.length;

  const submit = () => {
    if (!body.trim() || addMutation.isPending) return;
    setError(null);
    setNotice(null);
    addMutation.mutate();
  };

  if (compact && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-sm border border-terminal-border px-1.5 py-0.5 text-xs text-terminal-muted transition-colors hover:border-terminal-accent/40 hover:text-terminal-text ${className}`}
        title="Notes"
      >
        <StickyNote className="h-3 w-3" />
        {count > 0 ? count : "Note"}
      </button>
    );
  }

  return (
    <div className={`min-w-0 space-y-4 [&_button]:!text-xs [&_button]:tracking-normal ${className}`}>
      {compact ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex flex-wrap items-center gap-1.5 text-xs tracking-normal text-terminal-muted">
            <StickyNote className="h-3 w-3" /> Notes{normalizedSymbol ? ` · ${normalizedSymbol}` : ""}
          </span>
          <button type="button" aria-label="Close notes" onClick={() => setOpen(false)} className="min-h-8 px-2 text-xs text-terminal-muted hover:text-terminal-text focus-visible:outline">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="space-y-1 text-xs text-terminal-muted">
          <label htmlFor={`${effectiveAtId}-body`}>New note</label>
          <TerminalInput
            id={`${effectiveAtId}-body`}
            className="!text-sm"
            as="textarea"
            rows={compact ? 2 : 3}
            value={body}
            placeholder={normalizedSymbol ? `Jot a note on ${normalizedSymbol}…` : "Jot a note…"}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <div className={allowSymbolInput && !normalizedSymbol ? "grid items-start gap-3 sm:grid-cols-2" : "min-w-0"}>
          {allowSymbolInput && !normalizedSymbol ? (
            <label className="block space-y-1 text-xs text-terminal-muted">
              <span>Symbol (optional)</span>
              <TerminalInput
                size="sm"
                className="!text-sm"
                value={freeSymbol}
                placeholder="Symbol (optional, e.g. AAPL)"
                onChange={(e) => setFreeSymbol(e.target.value)}
              />
            </label>
          ) : null}
          <label htmlFor={effectiveAtId} className="block space-y-1">
            <span className="text-xs tracking-normal text-terminal-muted">
              Effective date and time <span className="normal-case">(optional)</span>
            </span>
            <TerminalInput
              id={effectiveAtId}
              className="min-w-0 !text-sm"
              type="datetime-local"
              size="sm"
              value={effectiveAt}
              onChange={(e) => setEffectiveAt(e.target.value)}
            />
            {!compact ? (
              <span className="block text-xs text-terminal-muted">
                When this information applied. Leave blank to use the save time.
              </span>
            ) : null}
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-terminal-muted">⌘/Ctrl+Enter to save</span>
          <TerminalButton
            size="sm"
            variant="accent"
            disabled={!body.trim()}
            className="!text-xs tracking-normal"
            loading={addMutation.isPending}
            leftIcon={<Plus className="h-3 w-3" />}
            onClick={submit}
          >
            Add note
          </TerminalButton>
        </div>
      </div>

      {error ? <p role="alert" className="text-xs text-terminal-neg">{error}</p> : null}
      {notice ? <p role="status" className="text-xs text-terminal-pos">{notice}</p> : null}

      <div className="space-y-3">
        {notesQuery.isPending ? (
          <p role="status" className="flex flex-wrap items-center gap-1.5 text-xs text-terminal-muted">
            <RefreshCw className="h-3 w-3 animate-spin" /> Loading notes…
          </p>
        ) : null}
        {notesQuery.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-terminal-neg">
            <span>{extractApiErrorMessage(notesQuery.error, "Failed to load notes.")}</span>
            <TerminalButton size="sm" variant="ghost" onClick={() => void notesQuery.refetch()}>
              Retry
            </TerminalButton>
          </div>
        ) : null}
        {notes.map((note: Note) => (
          <article key={note.id} aria-label={`${note.symbol || "General"} ${contextBadge[note.context]}`} className="min-w-0 rounded-sm border border-terminal-border bg-terminal-bg/50 p-3 [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="flex flex-wrap items-center gap-1.5 text-xs tracking-normal text-terminal-muted">
                <span className="rounded-sm border border-terminal-border px-1 text-terminal-accent">
                  {contextBadge[note.context]}
                </span>
                {note.symbol ? <span>{note.symbol}</span> : null}
                {note.context === "brain_memo" && note.ref_id ? (
                  <Link to={`/equity/brain?memo=${encodeURIComponent(note.ref_id)}#brain-log`} className="text-terminal-accent hover:underline">
                    Source memo
                  </Link>
                ) : null}
                {note.effective_at ? (
                  <span>Effective {displayDate(note.effective_at)}</span>
                ) : note.updated_at ? (
                  <span>Updated {displayDate(note.updated_at)}</span>
                ) : null}
              </span>
              <span className="flex items-center gap-1.5">
                {editingId === note.id ? (
                  <>
                    <button
                      type="button"
                      className="min-h-8 px-2 text-xs text-terminal-pos hover:opacity-80 focus-visible:outline" disabled={editMutation.isPending || !editBody.trim()}
                      onClick={() => editMutation.mutate(note.id)}
                      title="Save"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="min-h-8 px-2 text-xs text-terminal-muted hover:text-terminal-text focus-visible:outline"
                      onClick={() => setEditingId(null)}
                      title="Cancel"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="min-h-8 px-2 text-xs text-terminal-muted hover:text-terminal-text focus-visible:outline"
                      onClick={() => {
                        setEditingId(note.id);
                        setEditBody(note.body);
                        setEditEffectiveAt(toLocalDateTime(note.effective_at));
                        setError(null);
                        setNotice(null);
                      }}
                      title="Edit"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="min-h-8 px-2 text-xs text-terminal-muted hover:text-terminal-neg focus-visible:outline" disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate(note.id)}
                      title="Delete"
                    >
                      Delete
                    </button>
                  </>
                )}
              </span>
            </div>
            {editingId === note.id ? (
              <div className="mt-1.5 space-y-1.5">
                <TerminalInput
                  as="textarea"
                  aria-label="Edit note"
                  className="!text-sm"
                  rows={3}
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                />
                <label className="block space-y-1">
                  <span className="text-xs tracking-normal text-terminal-muted">
                    Effective date and time (optional)
                  </span>
                  <TerminalInput
                    type="datetime-local"
                    className="min-w-0 !text-sm"
                    size="sm"
                    value={editEffectiveAt}
                    onChange={(e) => setEditEffectiveAt(e.target.value)}
                  />
                </label>
              </div>
            ) : (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-terminal-text">{note.body}</p>
            )}
          </article>
        ))}
        {count === 0 && !notesQuery.isPending && !notesQuery.isError ? (
          <p className="text-xs text-terminal-muted">No notes yet.</p>
        ) : null}
      </div>
    </div>
  );
}
