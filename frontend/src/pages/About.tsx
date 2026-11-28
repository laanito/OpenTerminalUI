import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { REPOSITORY_URL } from "../utils/constants";

const MODULE_GROUPS = [
  {
    title: "Equity & Analysis",
    items: [
      "Terminal shell + GO bar",
      "Security hub + stock detail",
      "Chart workstation + launchpad",
      "Screener + portfolio + watchlist",
      "Economics + yield curve",
      "Crypto workspace",
      "Paper trading",
    ],
  },
  {
    title: "F&O Derivatives",
    items: [
      "Option chain + Greeks",
      "OI + IV analysis",
      "Strategy builder",
      "PCR + heatmap",
      "Futures terminal",
      "Expiry dashboard",
    ],
  },
  {
    title: "Quant & Risk",
    items: [
      "Risk Engine (VaR/CVaR)",
      "Risk Compute metrics",
      "Statistical analysis",
      "Pair-trading research",
      "Walk-forward validation",
      "Execution simulator",
      "Backtesting control deck",
    ],
  },
  {
    title: "Platform & Ops",
    items: [
      "Local administrator plugin loader",
      "Alert engine",
      "Provider registry",
      "Auth + account flows",
      "Export pathways",
    ],
  },
] as const;

const QUICK_LINKS = [
  { label: "Market Home", to: "/equity/stocks", badge: "F1" },
  { label: "Security Hub", to: "/equity/security", badge: "SH" },
  { label: "Launchpad", to: "/equity/launchpad", badge: "LP" },
  { label: "Workstation", to: "/equity/chart-workstation", badge: "6" },
  { label: "Crypto", to: "/equity/crypto", badge: "CR" },
  { label: "Economics", to: "/equity/economics", badge: "E" },
  { label: "F&O Home", to: "/fno", badge: "F8" },
  { label: "Backtesting", to: "/backtesting", badge: "F9" },
  { label: "Risk Dashboard", to: "/equity/risk", badge: "RSK" },
  { label: "Paper Trading", to: "/equity/paper", badge: "P" },
  { label: "Breakout Scanner", to: "/equity/screener", badge: "SCAN" },
] as const;

function buildDateLabel(value: string): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "unknown";
  return new Date(ts).toLocaleString();
}

function commitLabel(value: string): string {
  if (!value || value === "unknown") return "unknown";
  return value.slice(0, 7);
}


export interface AboutProps { terminalType?: "market" | "fno"; }
export function AboutPage({ terminalType = "market" }: AboutProps) {
  const navigate = useNavigate();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="dialog"]')) { event.preventDefault(); navigate(-1); } };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); if (timer.current != null) window.clearTimeout(timer.current); };
  }, [navigate]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(REPOSITORY_URL); setCopyState("copied"); }
    catch { setCopyState("failed"); }
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopyState("idle"), 2500);
  };
  const desk = terminalType === "fno" ? "Derivatives Desk" : "Market Desk";
  return <main aria-label="About OpenTerminalUI" className="min-w-0 space-y-3 p-3 pb-6 text-sm [overflow-wrap:anywhere]">
    <header className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><img src="/icon-192.png" alt="OpenTerminalUI logo" className="h-12 w-12 shrink-0 object-contain" /><div><h1 className="text-xl font-semibold text-terminal-text">OpenTerminal UI</h1><p className="text-sm text-terminal-muted">{desk} · open-source market research terminal</p></div></div><TerminalButton type="button" onClick={() => navigate(-1)} aria-label="Go back">Back</TerminalButton></header>
    <p className="text-sm leading-6 text-terminal-muted">Bring charts, cross-market context, portfolio records and dated research together to investigate market questions. Available data and analysis depend on your configured providers.</p>
    <TerminalPanel title="Build identity" subtitle="Version information embedded in this application build"><dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Version", (__APP_VERSION__ || "unknown").trim()], ["Commit", commitLabel(__GIT_COMMIT__)], ["Built", buildDateLabel(__BUILD_DATE__)], ["License", "MIT"]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-terminal-muted">{label}</dt><dd className="mt-1 break-words text-sm">{value}</dd></div>)}</dl></TerminalPanel>
    <TerminalPanel title="Quick Navigation"><section aria-label="Quick Navigation" className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"><Link to={terminalType === "fno" ? "/fno" : "/equity/stocks"} className="rounded border border-terminal-border p-3 text-sm">Return To Desk</Link><Link to="/" className="rounded border border-terminal-border p-3 text-sm">Open Home</Link>{QUICK_LINKS.map(item => <Link key={item.label} to={item.to} aria-label={item.label} className="min-w-0 rounded border border-terminal-border p-3 text-sm hover:border-terminal-accent">{item.label}</Link>)}</section></TerminalPanel>
    <TerminalPanel title="Repository and documentation"><section aria-label="Repository Intelligence" className="space-y-3"><p className="break-all text-sm text-terminal-muted">{REPOSITORY_URL}</p><div className="flex flex-wrap gap-2">{[["Open GitHub", REPOSITORY_URL], ["Star on GitHub", `${REPOSITORY_URL}/stargazers`], ["Release notes", `${REPOSITORY_URL}/releases`], ["Documentation", `${REPOSITORY_URL}/wiki`]].map(([label, href]) => <a key={label} href={href} aria-label={label} target="_blank" rel="noopener noreferrer" className="rounded border border-terminal-border px-3 py-3 text-sm hover:border-terminal-accent">{label}</a>)}<TerminalButton type="button" onClick={() => void copy()} aria-label="Copy repository URL">Copy URL</TerminalButton></div>{copyState === "copied" && <p role="status" className="text-sm text-terminal-pos">Copied</p>}{copyState === "failed" && <p role="alert" className="text-sm text-terminal-warning">Could not copy the link. Select the repository address above to copy it manually.</p>}</section></TerminalPanel>
    <details className="rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Module Registry</summary><section aria-label="Module Registry" className="mt-3 grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-2">{MODULE_GROUPS.map(group => <section key={group.title} aria-label={group.title} className="rounded border border-terminal-border p-3"><h2 className="text-sm text-terminal-accent">{group.title}</h2><ul className="mt-2 space-y-2 text-sm text-terminal-muted">{group.items.map(item => <li key={item}>{item}</li>)}</ul></section>)}</section></details>
    <details className="rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Tech Stack and keyboard navigation</summary><div className="mt-3 grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-2"><section aria-label="Tech Stack"><h2 className="mb-3 text-sm text-terminal-accent">Tech Stack</h2><dl className="space-y-3 text-sm">{[["Frontend", "React, TypeScript and Vite"], ["Backend", "FastAPI and Python"], ["Charts", "Lightweight Charts, Recharts and SVG"], ["Storage", "PostgreSQL or SQLite; optional Redis caching"], ["Deployment", "Docker Compose"], ["Tests", "Vitest and Playwright"]].map(([label, value]) => <div key={label}><dt className="text-xs text-terminal-muted">{label}</dt><dd>{value}</dd></div>)}</dl></section><section aria-label="Command Surfaces"><h2 className="mb-3 text-sm text-terminal-accent">Command Surfaces</h2><dl className="space-y-3 text-sm"><div><dt>Ctrl / Cmd + G</dt><dd className="text-terminal-muted">Focus the GO bar.</dd></div><div><dt>Ctrl / Cmd + K</dt><dd className="text-terminal-muted">Open the command palette.</dd></div><div><dt>Escape</dt><dd className="text-terminal-muted">Go back from About when no dialog is open.</dd></div></dl></section></div></details>
  </main>;
}
