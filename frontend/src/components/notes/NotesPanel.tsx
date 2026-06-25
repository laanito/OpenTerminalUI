import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, StickyNote, Trash2, X } from "lucide-react";

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
};

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
  const normalizedSymbol = symbol ? symbol.toUpperCase() : undefined;
  const [body, setBody] = useState("");
  const [freeSymbol, setFreeSymbol] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [error, setError] = useState<string | null>(null);
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
      }),
    onSuccess: () => {
      setBody("");
      setFreeSymbol("");
      setError(null);
      invalidate();
    },
    onError: (err) => setError(extractApiErrorMessage(err, "Failed to save note.")),
  });

  const editMutation = useMutation({
    mutationFn: (id: string) => updateNote(id, { body: editBody }),
    onSuccess: () => {
      setEditingId(null);
      setEditBody("");
      invalidate();
    },
    onError: (err) => setError(extractApiErrorMessage(err, "Failed to update note.")),
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
    addMutation.mutate();
  };

  if (compact && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-sm border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-muted transition-colors hover:border-terminal-accent/40 hover:text-terminal-text ${className}`}
        title="Notes"
      >
        <StickyNote className="h-3 w-3" />
        {count > 0 ? count : "Note"}
      </button>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {compact ? (
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-terminal-muted">
            <StickyNote className="h-3 w-3" /> Notes{normalizedSymbol ? ` · ${normalizedSymbol}` : ""}
          </span>
          <button type="button" onClick={() => setOpen(false)} className="text-terminal-muted hover:text-terminal-text">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div className="space-y-1.5">
        {allowSymbolInput && !normalizedSymbol ? (
          <TerminalInput
            size="sm"
            value={freeSymbol}
            placeholder="Symbol (optional, e.g. AAPL)"
            onChange={(e) => setFreeSymbol(e.target.value)}
          />
        ) : null}
        <TerminalInput
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
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-terminal-muted">⌘/Ctrl+Enter to save</span>
          <TerminalButton
            size="sm"
            variant="accent"
            loading={addMutation.isPending}
            leftIcon={<Plus className="h-3 w-3" />}
            onClick={submit}
          >
            Add note
          </TerminalButton>
        </div>
      </div>

      {error ? <p className="text-[11px] text-terminal-neg">{error}</p> : null}

      <div className="space-y-1.5">
        {notes.map((note: Note) => (
          <div key={note.id} className="rounded-sm border border-terminal-border bg-terminal-bg/50 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-terminal-muted">
                <span className="rounded-sm border border-terminal-border px-1 text-terminal-accent">
                  {contextBadge[note.context]}
                </span>
                {note.symbol ? <span>{note.symbol}</span> : null}
                {note.updated_at ? <span>{new Date(note.updated_at).toLocaleDateString()}</span> : null}
              </span>
              <span className="flex items-center gap-1.5">
                {editingId === note.id ? (
                  <>
                    <button
                      type="button"
                      className="text-terminal-pos hover:opacity-80"
                      onClick={() => editMutation.mutate(note.id)}
                      title="Save"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="text-terminal-muted hover:text-terminal-text"
                      onClick={() => setEditingId(null)}
                      title="Cancel"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="text-terminal-muted hover:text-terminal-text"
                      onClick={() => {
                        setEditingId(note.id);
                        setEditBody(note.body);
                      }}
                      title="Edit"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="text-terminal-muted hover:text-terminal-neg"
                      onClick={() => removeMutation.mutate(note.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
              </span>
            </div>
            {editingId === note.id ? (
              <TerminalInput
                as="textarea"
                rows={3}
                className="mt-1.5"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
              />
            ) : (
              <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-terminal-text">{note.body}</p>
            )}
          </div>
        ))}
        {count === 0 && !notesQuery.isLoading ? (
          <p className="text-[11px] text-terminal-muted">No notes yet.</p>
        ) : null}
      </div>
    </div>
  );
}
