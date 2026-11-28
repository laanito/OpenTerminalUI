import type { ReactNode } from "react";
import { getAppVersion, REPOSITORY_LABEL, REPOSITORY_URL } from "../../utils/constants";
export function AuthFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main aria-label={`${title} form`} className="relative z-10 min-h-screen min-w-0 bg-terminal-bg px-4 py-6 text-sm text-terminal-text [overflow-wrap:anywhere]">
    <div className="mx-auto w-full max-w-lg space-y-5">
      <header className="flex min-w-0 items-center gap-3"><img src="/icon-192.png" alt="OpenTerminalUI logo" className="h-12 w-12 shrink-0 object-contain" /><div className="min-w-0"><p className="text-lg font-semibold">OpenTerminalUI</p><p className="text-xs text-terminal-muted">Market research and portfolio context</p></div></header>
      <section className="min-w-0 space-y-4 rounded border border-terminal-border bg-terminal-panel p-4 sm:p-6"><header><h1 className="text-xl font-semibold text-terminal-accent">{title}</h1><p className="mt-2 text-sm leading-6 text-terminal-muted">{description}</p></header>{children}</section>
      <footer className="text-xs leading-6 text-terminal-muted">v{getAppVersion()} · MIT license<br /><a href={REPOSITORY_URL} target="_blank" rel="noreferrer" className="break-all text-terminal-accent underline">{REPOSITORY_LABEL}</a></footer>
    </div>
  </main>;
}
export const AUTH_INPUT_CLASS = "min-h-11 min-w-0 w-full rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-base text-terminal-text outline-none focus:border-terminal-accent disabled:opacity-60";
export const AUTH_BUTTON_CLASS = "min-h-11 rounded border border-terminal-accent bg-terminal-accent/10 px-4 py-2 text-sm text-terminal-accent focus-visible:outline focus-visible:outline-terminal-accent disabled:opacity-60";
