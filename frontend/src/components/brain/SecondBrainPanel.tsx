import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Brain, RefreshCw, Save, Send, Sparkles } from "lucide-react";

import {
  askBrainStream,
  fetchBrainStatus,
  reindexBrain,
  type BrainCitation,
  type BrainSource,
} from "../../api/brain";
import { extractApiErrorMessage } from "../../api/base";
import { createBrainMemo } from "../../api/brainMemos";
import type { InsightModelProfile } from "../../api/types";
import { CitationCard, scopeLabel } from "./BrainEvidence";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalPanel } from "../terminal/TerminalPanel";

interface Exchange {
  id: number;
  question: string;
  answer: string;
  citations: BrainCitation[];
  sources: BrainSource[];
  llm?: boolean | null;
  error?: string | null;
  generated_at?: string | null;
  llm_provider?: string | null;
  llm_model?: string | null;
  model_profile?: InsightModelProfile | null;
  savedMemoId?: string;
}

const SUGGESTIONS = [
  "What setups tend to lose me money?",
  "How do my emotions affect my trades?",
  "Summarize my thesis on my biggest position.",
  "Which mistakes do I keep repeating?",
];

const sourceOptions: { value: BrainSource; label: string }[] = [
  { value: "note", label: "Notes" },
  { value: "journal", label: "Journal" },
  { value: "portfolio", label: "Portfolio theses" },
  { value: "holding", label: "Position notes" },
  { value: "transaction", label: "Transaction notes" },
];

const allSources = sourceOptions.map((option) => option.value);

function ExchangeCard({ exchange, onSave, saving, saveDisabled, saveError }: {
  exchange: Exchange;
  onSave?: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  saveError?: string | null;
}) {
  return (
    <div className="space-y-2 rounded-sm border border-terminal-border bg-terminal-bg/40 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-terminal-text">
        <Brain className="h-3.5 w-3.5 text-terminal-accent" />
        {exchange.question}
      </p>
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-terminal-text">
        {exchange.answer}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-terminal-muted">
        Evidence scope · {scopeLabel(exchange.sources)}
      </p>
      {exchange.model_profile ? <p className="break-words text-[11px] text-terminal-muted">
        {exchange.model_profile.resolved_profile === "deep" ? "Deep profile" : "Default profile (Deep not configured)"}
        {" · "}{exchange.llm_model}
      </p> : null}
      {exchange.error ? (
        <p className="text-[10px] uppercase tracking-wide text-terminal-neg">
          degraded: {exchange.error}
        </p>
      ) : null}
      {onSave ? (
        <div className="flex items-center gap-2">
          <TerminalButton
            type="button"
            size="sm"
            leftIcon={<Save className="h-3 w-3" />}
            loading={saving}
            disabled={saveDisabled || Boolean(exchange.savedMemoId)}
            onClick={onSave}
          >
            {exchange.savedMemoId ? "Saved to Brain Log" : "Save answer"}
          </TerminalButton>
          {exchange.savedMemoId ? <a href="#brain-log" className="text-[11px] text-terminal-accent hover:underline">View log</a> : null}
          {saveError ? <span role="alert" className="text-[11px] text-terminal-neg">{saveError}</span> : null}
        </div>
      ) : null}
      {exchange.citations.length ? (
        <div className="space-y-1.5 pt-1">
          <p className="text-[10px] uppercase tracking-wide text-terminal-muted">
            Sources from your private record
          </p>
          {exchange.citations.map((citation) => (
            <CitationCard key={citation.n} citation={citation} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SecondBrainPanel() {
  const queryClient = useQueryClient();
  const nextExchangeId = useRef(0);
  const askController = useRef<AbortController | null>(null);
  useEffect(() => () => askController.current?.abort(), []);
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<Exchange[]>([]);
  const [streamingExchange, setStreamingExchange] = useState<Exchange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<BrainSource[]>(allSources);
  const [saveError, setSaveError] = useState<{ id: number; message: string } | null>(null);

  const statusQuery = useQuery({ queryKey: ["brain", "status"], queryFn: fetchBrainStatus });

  const askMutation = useMutation({
    mutationFn: ({ question: q, sources }: { question: string; sources: BrainSource[] }) => {
      const controller = new AbortController();
      askController.current = controller;
      return askBrainStream(q, 6, sources, (response) => {
        if (controller.signal.aborted) return;
        setStreamingExchange({
          id: -1,
          question: q,
          answer: response.answer,
          citations: response.citations,
          sources: response.sources.length ? response.sources : sources,
          llm: response.llm,
          error: response.error,
          generated_at: response.generated_at,
          llm_provider: response.llm_provider,
          llm_model: response.llm_model,
          model_profile: response.model_profile,
        });
      }, { signal: controller.signal });
    },
    onSuccess: (data, variables) => {
      setHistory((prev) => [
        {
          id: ++nextExchangeId.current,
          question: variables.question,
          answer: data.answer,
          citations: data.citations,
          sources: data.sources ?? variables.sources,
          llm: data.llm,
          error: data.error,
          generated_at: data.generated_at,
          llm_provider: data.llm_provider,
          llm_model: data.llm_model,
          model_profile: data.model_profile,
        },
        ...prev,
      ]);
      setStreamingExchange(null);
      setQuestion("");
      void queryClient.invalidateQueries({ queryKey: ["brain", "status"] });
    },
    onError: (err) => {
      setStreamingExchange(null);
      setError(err instanceof DOMException && err.name === "AbortError"
        ? "Brain request cancelled. No answer was kept."
        : extractApiErrorMessage(err, "The Brain request failed. No answer was kept; retry manually."));
    },
    onSettled: () => { askController.current = null; },
  });

  const saveMutation = useMutation({
    mutationFn: (exchange: Exchange) => createBrainMemo({
      question: exchange.question,
      answer: exchange.answer,
      sources: exchange.sources,
      citations: exchange.citations,
      generated_at: exchange.generated_at!,
      llm: exchange.llm ?? null,
      llm_provider: exchange.llm_provider ?? null,
      llm_model: exchange.llm_model ?? null,
    }),
    onMutate: () => setSaveError(null),
    onSuccess: (memo, exchange) => {
      setHistory((current) => current.map((item) => item.id === exchange.id ? { ...item, savedMemoId: memo.id } : item));
      void queryClient.invalidateQueries({ queryKey: ["brain", "memos"] });
    },
    onError: (err, exchange) => setSaveError({
      id: exchange.id,
      message: extractApiErrorMessage(err, "Could not save this answer."),
    }),
  });

  const reindexMutation = useMutation({
    mutationFn: reindexBrain,
    onMutate: () => setError(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["brain", "status"] }),
    onError: (err) => setError(extractApiErrorMessage(err, "Reindex failed.")),
  });

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || askMutation.isPending) return;
    setError(null);
    const sources = [...selectedSources];
    setStreamingExchange({ id: -1, question: trimmed, answer: "", citations: [], sources });
    askMutation.mutate({ question: trimmed, sources });
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
        {reindexMutation.isPending ? (
          <p role="status" className="flex items-center gap-1.5 text-[11px] text-terminal-muted">
            <RefreshCw className="h-3 w-3 animate-spin text-terminal-accent" />
            Reindexing private memory… Notes remain available while embeddings are refreshed.
          </p>
        ) : reindexMutation.isSuccess ? (
          <p role="status" className="text-[11px] text-terminal-pos">
            Reindex complete · {reindexMutation.data.total} chunks · {reindexMutation.data.indexed} refreshed · {reindexMutation.data.removed} removed
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 text-[11px]">
          <Link
            to="/equity/journal"
            className="rounded-sm border border-terminal-border px-2 py-1 text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
          >
            Add journal entry
          </Link>
          <Link
            to="/equity/portfolio"
            className="rounded-sm border border-terminal-border px-2 py-1 text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
          >
            Edit portfolio theses
          </Link>
        </div>
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
          {askMutation.isPending ? <TerminalButton type="button" onClick={() => askController.current?.abort()}>
            Cancel
          </TerminalButton> : null}
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
          {streamingExchange ? <ExchangeCard exchange={streamingExchange} /> : null}
          {history.map((exchange) => (
            <ExchangeCard
              key={exchange.id}
              exchange={exchange}
              onSave={exchange.generated_at && exchange.answer.trim() && !exchange.error && exchange.llm
                ? () => saveMutation.mutate(exchange)
                : undefined}
              saving={saveMutation.isPending && saveMutation.variables?.id === exchange.id}
              saveDisabled={saveMutation.isPending}
              saveError={saveError?.id === exchange.id ? saveError.message : null}
            />
          ))}
        </div>
      </div>
    </TerminalPanel>
  );
}
