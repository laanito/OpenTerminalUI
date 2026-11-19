import { useId, type HTMLAttributes, type ReactNode } from "react";

type PageProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  context?: ReactNode;
};

/** Page hierarchy only: keep scrolling with the shell, not a second viewport. */
export function TerminalPage({ title, description, actions, context, children, className = "", ...rest }: PageProps) {
  return <div {...rest} className={`min-w-0 space-y-4 p-4 ${className}`.trim()}>
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-56">
        <h1 className="break-words text-2xl font-semibold tracking-tight text-terminal-text">{title}</h1>
        {description ? <div className="mt-1 break-words text-sm text-terminal-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
    {context}
    <div className="min-w-0 space-y-4">{children}</div>
  </div>;
}

type ScopeProps = {
  label: string;
  scope: string;
  facts?: ReadonlyArray<{ label: string; value: ReactNode }>;
  actions?: ReactNode;
};

/** Scope facts are supplied by their owner; no global ticker or currency fallback. */
export function TerminalScopeBar({ label, scope, facts = [], actions }: ScopeProps) {
  const id = useId();
  return <section aria-label={label} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded border border-terminal-border bg-terminal-panel p-3">
    <div className="min-w-0 flex-1 basis-48">
      <h2 id={id} className="break-words text-sm font-semibold text-terminal-text">{scope}</h2>
      {facts.length ? <dl className="mt-1 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-terminal-muted">
        {facts.map(fact => <div key={fact.label} className="flex min-w-0 flex-wrap gap-x-1"><dt>{fact.label}:</dt><dd className="break-words">{fact.value}</dd></div>)}
      </dl> : null}
    </div>
    {actions ? <div className="flex min-w-0 max-w-full flex-wrap gap-2">{actions}</div> : null}
  </section>;
}

type DataStateProps = {
  kind: "loading" | "empty" | "filtered-empty" | "partial" | "error" | "stale" | "unavailable";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
};

/** Presentation only: the caller decides availability; missing data is not zero. */
export function TerminalDataState({ kind, title, children, action }: DataStateProps) {
  const tone = kind === "error" ? "border-terminal-neg/60 text-terminal-neg"
    : ["partial", "stale", "unavailable"].includes(kind) ? "border-terminal-warn/60 text-terminal-warn"
      : "border-terminal-border text-terminal-muted";
  return <section aria-label={title} role={kind === "error" ? "alert" : "status"}
    className={`min-w-0 rounded border bg-terminal-panel p-3 text-sm ${tone}`}>
    <h3 className="break-words font-semibold">{title}</h3>
    {children ? <div className="mt-1 break-words text-sm">{children}</div> : null}
    {action ? <div className="mt-3 flex min-w-0 flex-wrap gap-2">{action}</div> : null}
  </section>;
}
