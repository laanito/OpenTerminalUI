import type { ReactNode } from "react";

type GuidedAction = {
  label: string;
  onClick?: () => void;
  href?: string;
};

export function GuidedEmptyState({
  title,
  message,
  actions = [],
  icon = "EMPTY",
}: {
  title: string;
  message: string;
  actions?: GuidedAction[];
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-sm border border-dashed border-terminal-border bg-terminal-bg/60 px-3 py-4 text-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm border border-terminal-border px-2 py-0.5 text-xs uppercase tracking-normal text-terminal-accent">
              {icon}
            </span>
            <span className="font-semibold uppercase tracking-normal text-terminal-text">{title}</span>
          </div>
          <p className="mt-2 max-w-2xl text-xs text-terminal-muted">{message}</p>
        </div>
        {actions.length ? (
          <div className="flex min-w-0 flex-wrap gap-2">
            {actions.map((action) =>
              action.href ? (
                <a
                  key={action.label}
                  href={action.href}
                  className="rounded-sm border border-terminal-border px-2 py-1 text-xs uppercase tracking-normal text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                >
                  {action.label}
                </a>
              ) : (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className="rounded-sm border border-terminal-border px-2 py-1 text-xs uppercase tracking-normal text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                >
                  {action.label}
                </button>
              ),
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
