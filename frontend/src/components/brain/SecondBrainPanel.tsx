import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Brain, RefreshCw, Send, Sparkles } from "lucide-react";

import {
  askBrain,
  fetchBrainStatus,
  reindexBrain,
  type BrainCitation,
  type BrainSource,
} from "../../api/brain";
import { extractApiErrorMessage } from "../../api/base";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalPanel } from "../terminal/TerminalPanel";

interface Exchange {
  question: string;
  answer: string;
  citations: BrainCitation[];
  sources: BrainSource[];
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
  note: "Note",
  journal: "Journal",
  portfolio: "Portfolio",
  holding: "Position",
  transaction: "Transaction",
};

const sourceOptions: { value: BrainSource; label: string }[] = [
  { value: "note", label: "Notes" },
  { value: "journal", label: "Journal" },
  { value: "portfolio", label: "Portfolio theses" },
  { value: "holding", label: "Position notes" },
  { value: "transaction", label: "Transaction notes" },
];

const allSources = sourceOptions.map((option) => option.value);

function scopeLabel(sources: BrainSource[]) {
  if (sources.length === sourceOptions.length) return "All private sources";
  return sources.map((source) => sourceOptions.find((option) => option.value === source)?.label ?? source).join(", ");
}

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
  const [selectedSources, setSelectedSources] = useState<BrainSource[]>(allSources);

  const statusQuery = useQuery({ queryKey: ["brain", "status"], queryFn: fetchBrainStatus });

  const askMutation = useMutation({
    mutationFn: ({ question: q, sources }: { question: string; sources: BrainSource[] }) =>
      askBrain(q, 6, sources),
    onSuccess: (data, variables) => {
      setHistory((prev) => [
        {
          question: variables.question,
          answer: data.answer,
          citations: data.citations,
          sources: data.sources ?? variables.sources,
          llm: data.llm,
          error: data.error,
        },
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
    askMutation.mutate({ question: trimmed, sources: selectedSources });
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

        <div className="space-y-1.5 rounded-sm border border-terminal-border/70 bg-terminal-bg/30 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wide text-terminal-muted">
              Evidence scope · {scopeLabel(selectedSources)}
            </p>
            <button
              type="button"
              aria-pressed={selectedSources.length === sourceOptions.length}
              onClick={() => setSelectedSources(allSources)}
              className="text-[10px] text-terminal-accent hover:underline"
            >
              Select all
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Private evidence sources">
            {sourceOptions.map((option) => {
              const selected = selectedSources.includes(option.value);
              const count = status?.source_counts[option.value] ?? 0;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setSelectedSources((current) => {
                      const isSelected = current.includes(option.value);
                      if (isSelected && current.length === 1) return current;
                      return isSelected
                        ? current.filter((source) => source !== option.value)
                        : [...current, option.value];
                    })
                  }
                  className={`rounded-sm border px-2 py-1 text-[10px] transition-colors ${
                    selected
                      ? "border-terminal-accent/60 bg-terminal-accent/10 text-terminal-accent"
                      : "border-terminal-border text-terminal-muted hover:border-terminal-accent/30"
                  }`}
                >
                  {option.label} · {count}
                </button>
              );
            })}
          </div>
        </div>

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
            Searching selected private sources and synthesizing…
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
              <p className="text-[10px] uppercase tracking-wide text-terminal-muted">
                Evidence scope · {scopeLabel(ex.sources)}
              </p>
              {ex.error ? (
                <p className="text-[10px] uppercase tracking-wide text-terminal-neg">degraded: {ex.error}</p>
              ) : null}
              {ex.citations.length ? (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[10px] uppercase tracking-wide text-terminal-muted">Sources from your private record</p>
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
