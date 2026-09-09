import { useCallback, useEffect, useRef, useState } from "react";

import { terminalColors } from "../../theme/terminal";
import type { InsightData, InsightSection } from "../../api/types";
import type { InsightPhase, InsightRequestOptions } from "../../api/insightLifecycle";

export type { InsightData, InsightSection } from "../../api/types";

type Props = {
  title: string;
  description?: string;
  disabled?: boolean;
  disabledMessage?: string;
  /** Resolves the insight. `refresh` is true after the first attempt. */
  fetcher: (refresh?: boolean, options?: InsightRequestOptions) => Promise<InsightData>;
};

function toneColor(tone: InsightSection["tone"]): string {
  if (tone === "positive") return terminalColors.positive;
  if (tone === "negative") return terminalColors.negative;
  return terminalColors.muted;
}

function unavailableMessage(data: InsightData): string {
  switch (data.failure?.code) {
    case "timeout":
      return "The model exceeded the server-owned generation deadline. You can retry when the provider is less busy.";
    case "invalid_response":
      return "The model response was not valid after one bounded repair attempt. No partial analysis was published.";
    case "provider_error":
      return "The model provider failed during generation. Check its logs or retry.";
    case "disabled":
      return "LLM insights are disabled by the host configuration.";
    default:
      return "Start your LLM endpoint (e.g. Ollama), then click Regenerate.";
  }
}

/**
 * On-demand AI analysis card backed by the local LLM. Kept lazy because
 * local LLM inference is slow — nothing runs until the user asks for it.
 */
export function AiInsightCard({ title, description, disabled = false, disabledMessage, fetcher }: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error" | "cancelled">("idle");
  const [data, setData] = useState<InsightData | null>(null);
  const [progress, setProgress] = useState<{ phase: InsightPhase; elapsed: number } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const run = useCallback(async () => {
    if (disabled) return;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setStatus("loading");
    setData(null);
    setProgress({ phase: "queued", elapsed: 0 });
    try {
      // A button labelled Regenerate must not simply return the same cached AI
      // payload. Fetchers that do not cache may safely ignore this argument.
      const result = await fetcher(status !== "idle", {
        signal: controller.signal,
        onProgress: (phase, elapsed) => {
          if (mountedRef.current && controllerRef.current === controller) {
            setProgress({ phase, elapsed });
          }
        },
      });
      if (controller.signal.aborted || !mountedRef.current) return;
      setData(result);
      setStatus("done");
    } catch (error) {
      if (mountedRef.current) setStatus(controller.signal.aborted ? "cancelled" : "error");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [disabled, fetcher, status]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const engineLive = data?.engine === "llm";
  const engineLabel = engineLive
    ? data?.model ?? "LLM"
    : data?.engine === "lexical"
      ? "Lexical fallback"
      : "LLM unavailable";

  return (
    <section className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {description && <div className="text-[11px] text-terminal-muted">{description}</div>}
        </div>
        <div className="flex items-center gap-2">
          {status === "done" && (
            <span
              className="rounded border px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                borderColor: engineLive ? terminalColors.accent : terminalColors.border,
                color: engineLive ? terminalColors.accent : terminalColors.muted,
              }}
            >
              {engineLabel}
            </span>
          )}
          <button
            className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-text hover:border-terminal-accent disabled:opacity-50"
            onClick={status === "loading" ? cancel : run}
            disabled={disabled && status !== "loading"}
          >
            {status === "loading" ? "Cancel" : status === "idle" || status === "cancelled" ? "Generate" : "Regenerate"}
          </button>
        </div>
      </div>

      {status === "idle" && (
        <div className="mt-2 text-[11px] text-terminal-muted">
          {disabled
            ? disabledMessage ?? "Required terminal data is not available yet."
            : "Runs locally via your LLM endpoint (Ollama by default) — analysis can take a minute."}
        </div>
      )}

      {status === "loading" && (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] text-terminal-muted" aria-live="polite">
            {progress?.phase === "queued" ? "Preparing analysis…" : "Generating analysis with the local LLM…"}
            {progress?.elapsed ? ` ${Math.round(progress.elapsed)}s` : ""}
          </div>
          <div className="h-24 animate-pulse rounded bg-terminal-bg" />
        </div>
      )}

      {status === "cancelled" && (
        <div className="mt-3 rounded border border-terminal-border bg-terminal-bg p-2 text-xs text-terminal-muted">
          Analysis cancelled. No result was published.
        </div>
      )}

      {status === "error" && (
        <div className="mt-3 rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">
          Could not generate AI analysis. Check that your LLM endpoint is running, then retry.
        </div>
      )}

      {status === "done" && data && (
        <div className="mt-3 space-y-3">
          {data.summary && (
            <p className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs text-terminal-text">
              {data.summary}
            </p>
          )}
          {data.sections.map((section, idx) => (
            <div key={`${section.title}-${idx}`}>
              <div
                className="mb-1 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: toneColor(section.tone) }}
              >
                {section.title}
              </div>
              <ul className="space-y-1">
                {section.points.map((point, pIdx) => (
                  <li key={pIdx} className="flex gap-2 text-xs text-terminal-text">
                    <span style={{ color: toneColor(section.tone) }}>▸</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {data.engine !== "llm" && !data.sections.length && (
            <div className="text-[11px] text-terminal-muted">
              {unavailableMessage(data)}
            </div>
          )}
          {data.note_count !== undefined && (
            <div className="text-[10px] text-terminal-muted">
              {data.note_count > 0
                ? `Grounded in ${data.note_count} of your note${data.note_count === 1 ? "" : "s"} on this ticker`
                : "No notes recorded on this ticker yet — add your thesis to ground the interrogation"}
              {data.related_count
                ? ` + ${data.related_count} related from your other notes`
                : ""}
              .
            </div>
          )}
        </div>
      )}
    </section>
  );
}
