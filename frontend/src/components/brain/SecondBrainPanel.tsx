import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Brain, RefreshCw, Send, Sparkles } from "lucide-react";

import {
  askBrain,
  fetchBrainStatus,
  reindexBrain,
  type BrainCitation,
} from "../../api/brain";
import { extractApiErrorMessage } from "../../api/base";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalPanel } from "../terminal/TerminalPanel";

interface Exchange {
  question: string;
  answer: string;
  citations: BrainCitation[];
  llm?: boolean | null;
  error?: string | null;
}

const SUGGESTIONS = [
  "What setups tend to lose me money?",
  "How do my emotions affect my trades?",
  "Summarize my thesis on my biggest position.",
  "Which mistakes do I keep repeating?",
];

const sourceLabels: Record<string, string> = {
  journal: "Journal",
  portfolio: "Portfolio",
  holding: "Position",
  transaction: "Transaction",
};

function CitationCard({ citation }: { citation: BrainCitation }) {
  const label = sourceLabels[citation.source] ?? citation.source;
  const body = (
    <div className="rounded-sm border border-terminal-border bg-terminal-bg/60 p-2.5 transition-colors hover:border-terminal-accent/40">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-terminal-text">
          <span className="flex h-4 w-4 items-center justify-center rounded-sm border border-terminal-accent/50 text-[9px] text-terminal-accent">
            {citation.n}
          </span>
          {citation.title}
        </span>
        <span className="shrink-0 text-[9px] uppercase tracking-wide text-terminal-muted">
          {label}
          {citation.score ? ` · ${(citation.score * 100).toFixed(0)}%` : ""}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-terminal-muted">{citation.snippet}</p>
    </div>
  );
  return citation.route ? (
    <Link to={citation.route} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function SecondBrainPanel() {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<Exchange[]>([]);
  const [error, setError] = useState<string | null>(null);

  const statusQuery = useQuery({ queryKey: ["brain", "status"], queryFn: fetchBrainStatus });

  const askMutation = useMutation({
    mutationFn: (q: string) => askBrain(q),
    onSuccess: (data, q) => {
      setHistory((prev) => [
        { question: q, answer: data.answer, citations: data.citations, llm: data.llm, error: data.error },
        ...prev,
      ]);
      setQuestion("");
      void queryClient.invalidateQueries({ queryKey: ["brain", "status"] });
    },
    onError: (err) => setError(extractApiErrorMessage(err, "Failed to ask your second brain.")),
  });

  const reindexMutation = useMutation({
    mutationFn: reindexBrain,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["brain", "status"] }),
    onError: (err) => setError(extractApiErrorMessage(err, "Reindex failed.")),
  });

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || askMutation.isPending) return;
    setError(null);
    askMutation.mutate(trimmed);
  };

  const status = statusQuery.data;

  return (
    <TerminalPanel
      title="Second Brain"
      subtitle="Private RAG over your journal, theses & notes — answers grounded only in your own writing"
      actions={
        <div className="flex items-center gap-2 text-[10px] text-terminal-muted">
          {status ? (
            <span className="uppercase tracking-wide">
              {status.indexed_chunks} indexed · {status.backend} · {status.embed_model}
            </span>
          ) : null}
          <TerminalButton
            size="sm"
            variant="ghost"
            leftIcon={<RefreshCw className={`h-3 w-3 ${reindexMutation.isPending ? "animate-spin" : ""}`} />}
            loading={reindexMutation.isPending}
            onClick={() => reindexMutation.mutate()}
          >
            Reindex
          </TerminalButton>
        </div>
      }
    >
      <div className="space-y-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(question);
          }}
        >
          <TerminalInput
            as="textarea"
            rows={2}
            value={question}
            placeholder="Ask your second brain about your trades, theses, or notes…"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit(question);
              }
            }}
          />
          <TerminalButton
            type="submit"
            variant="accent"
            loading={askMutation.isPending}
            leftIcon={<Send className="h-3.5 w-3.5" />}
          >
            Ask
          </TerminalButton>
        </form>

        {history.length === 0 && !askMutation.isPending ? (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="rounded-sm border border-terminal-border bg-terminal-bg/60 px-2 py-1 text-[11px] text-terminal-muted transition-colors hover:border-terminal-accent/40 hover:text-terminal-text"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}

        {error ? <p className="text-[11px] text-terminal-neg">{error}</p> : null}

        {askMutation.isPending ? (
          <p className="flex items-center gap-2 text-[11px] text-terminal-muted">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-terminal-accent" />
            Searching your notes and synthesizing…
          </p>
        ) : null}

        <div className="space-y-4">
          {history.map((ex, idx) => (
            <div key={idx} className="space-y-2 rounded-sm border border-terminal-border bg-terminal-bg/40 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-terminal-text">
                <Brain className="h-3.5 w-3.5 text-terminal-accent" />
                {ex.question}
              </p>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-terminal-text">{ex.answer}</p>
              {ex.error ? (
                <p className="text-[10px] uppercase tracking-wide text-terminal-neg">degraded: {ex.error}</p>
              ) : null}
              {ex.citations.length ? (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[10px] uppercase tracking-wide text-terminal-muted">Sources from your notes</p>
                  {ex.citations.map((c) => (
                    <CitationCard key={c.n} citation={c} />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </TerminalPanel>
  );
}
