import { useEffect, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { api } from "../api/client";

const views = { calendar: "Upcoming calendar", income: "Portfolio income", analysis: "Stock history", aristocrats: "Aristocrats" } as const;
type View = keyof typeof views;
type Row = { symbol?: string; date?: string; ex_date?: string; month?: string; amount?: number | null; type?: string; estimated?: boolean; years_growth?: number | null; yield?: number | null };
type Income = { annual_income?: number | null; monthly_breakdown: Row[] };
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 6 }) : "Unavailable";

function DataTable({ name, headers, rows }: { name: string; headers: string[]; rows: ReactNode[][] }) {
  return <div role="region" aria-label={name} tabIndex={0} className="min-w-0 overflow-x-auto rounded border border-terminal-border focus-visible:outline focus-visible:outline-terminal-accent">
    <table className="w-full min-w-[480px] text-left text-sm">
      <thead className="bg-terminal-bg text-terminal-muted"><tr>{headers.map(header => <th key={header} scope="col" className={`px-3 py-3 text-xs font-medium normal-case tracking-normal ${headers.length === 4 && header === "Type" ? "min-w-[240px]" : "min-w-[112px]"}`}>{header}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i} className="border-t border-terminal-border">{row.map((cell, j) => <td key={j} className={`px-3 py-3 align-top ${j === 0 ? "font-medium break-words" : "tabular-nums"}`}>{cell}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

function AmountChart({ rows, dateKey, name }: { rows: Row[]; dateKey: "date" | "month"; name: string }) {
  // Missing amounts remain gaps. Never turn a missing payment into zero.
  const values = rows.map(row => ({ ...row, amount: typeof row.amount === "number" && Number.isFinite(row.amount) ? row.amount : null }));
  return <div role="img" aria-label={name} className="h-64 min-w-0 w-full" >
    <ResponsiveContainer width="100%" height="100%"><BarChart data={values} margin={{ top: 12, right: 8, bottom: 8, left: 0 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
      <XAxis dataKey={dateKey} minTickGap={24} tick={{ fill: "#8e98a8", fontSize: 12 }} />
      <YAxis width={64} tick={{ fill: "#8e98a8", fontSize: 12 }} />
      <Tooltip formatter={value => [number(value), "Reported amount"]} />
      <Bar dataKey="amount" fill="#5aa9ff" isAnimationActive={false} />
    </BarChart></ResponsiveContainer>
  </div>;
}

function DividendRead({ view, symbol }: { view: View; symbol: string }) {
  const [attempt, retry] = useState(0);
  const [read, setRead] = useState<{ loading: boolean; failed: boolean; data: Row[] | Income | null }>({ loading: true, failed: false, data: null });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setRead({ loading: true, failed: false, data: null });
    const path = view === "analysis" ? `history/${encodeURIComponent(symbol)}` : view === "income" ? "portfolio-income" : view;
    void api.get(`/dividends/${path}`, { signal: controller.signal }).then(response => {
      const data = response.data;
      if (view === "income" ? !data || !Array.isArray(data.monthly_breakdown) : !Array.isArray(data)) throw new Error("Invalid dividend response");
      if (active) setRead({ loading: false, failed: false, data });
    }).catch(() => { if (active) setRead({ loading: false, failed: true, data: null }); });
    return () => { active = false; controller.abort(); };
  }, [view, symbol, attempt]);
  const rows = Array.isArray(read.data) ? read.data : [];
  const income = read.data && !Array.isArray(read.data) ? read.data : null;
  const empty = view !== "income" && !rows.length;
  const units = "Reported amounts · currency not supplied";
  return <section aria-label="Dividend results" aria-busy={read.loading} className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="min-w-0 max-w-full break-words text-base font-semibold">{views[view]}{view === "analysis" ? ` · ${symbol}` : ""}</h2>
      <TerminalButton type="button" disabled={read.loading} onClick={() => retry(value => value + 1)} className="normal-case tracking-normal">Refresh view</TerminalButton>
    </div>
    {read.loading ? <p role="status" className="text-sm text-terminal-muted">Loading {views[view].toLowerCase()}…</p>
      : read.failed ? <div role="alert" className="space-y-2 rounded border border-terminal-neg p-4 text-sm"><p>Could not load this dividend view. No previous result is shown.</p><p className="text-terminal-muted">Your history symbol is kept. Refresh view to retry.</p></div>
      : empty ? <p role="status" className="rounded border border-terminal-border p-4 text-sm">No dividend rows returned for this scope.</p>
      : <>
        {view === "calendar" && <TerminalPanel title="Upcoming dividends" subtitle="Next 30 days · holdings and watchlist, or the default US basket if both are empty">
          <p className="mb-3 text-xs text-terminal-muted">{units} per share. Estimated dates remain labelled.</p>
          <DataTable name="Upcoming dividends table" headers={["Symbol", "Ex-date", "Amount per share", "Type"]} rows={rows.map(row => [row.symbol || "Unavailable", row.ex_date || "Unavailable", number(row.amount), <span className="block max-w-64 whitespace-normal break-words">{row.estimated ? "Estimated" : row.type || "Unavailable"}</span>])} />
        </TerminalPanel>}
        {view === "income" && income && <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(240px,1fr)_minmax(0,3fr)]">
          <TerminalPanel title="Annual projection"><p className="break-words text-3xl font-semibold tabular-nums text-terminal-pos">{number(income.annual_income)}</p><p className="mt-2 text-xs text-terminal-muted">Reported total · currency not supplied</p><p className="mt-4 text-sm text-terminal-muted">Current holdings resolved by the service. This view has no portfolio selector.</p></TerminalPanel>
          <TerminalPanel className="min-w-0" title="Monthly breakdown" subtitle="Scheduled dividends by calendar month; annual yield estimates may not appear in these bars">
            <p className="mb-3 text-xs text-terminal-muted">{units}. No currency conversion is established by this response.</p>
            {income.monthly_breakdown.length ? <AmountChart rows={income.monthly_breakdown} dateKey="month" name="Monthly reported dividend amounts" /> : <p role="status" className="text-sm">No monthly amounts returned.</p>}
          </TerminalPanel>
          {income.monthly_breakdown.length > 0 && <div className="min-w-0 xl:col-span-2"><DataTable name="Monthly dividend amounts" headers={["Month", "Reported amount"]} rows={income.monthly_breakdown.map(row => [row.month || "Unavailable", number(row.amount)])} /></div>}
        </div>}
        {view === "analysis" && <TerminalPanel title={`Dividend history · ${symbol}`} subtitle="Historical payments returned for the applied symbol">
          <p className="mb-3 text-xs text-terminal-muted">{units} per share.</p>
          <AmountChart rows={rows} dateKey="date" name={`Reported dividend history for ${symbol}`} />
          <DataTable name="Historical dividends table" headers={["Event date / ex-date", "Amount per share"]} rows={rows.map(row => [row.date || "Unavailable", number(row.amount)])} />
        </TerminalPanel>}
        {view === "aristocrats" && <TerminalPanel title="Dividend aristocrats" subtitle="Curated US reference list · approximate growth streaks dated 2025, not verified current membership">
          <DataTable name="Dividend aristocrats table" headers={["Symbol", "Growth streak (years)", "Trailing yield (%)"]} rows={rows.map(row => [row.symbol || "Unavailable", number(row.years_growth), typeof row.yield === "number" && Number.isFinite(row.yield) ? `${row.yield.toFixed(2)}%` : "Unavailable"])} />
        </TerminalPanel>}
      </>}
  </section>;
}

export function DividendDashboardPage() {
  const [view, setView] = useState<View>("calendar");
  const [draft, setDraft] = useState("AAPL");
  const [symbol, setSymbol] = useState("AAPL");
  const [submission, setSubmission] = useState(0);
  return <main aria-label="Dividends workspace" className="min-w-0 space-y-4 p-3 text-terminal-text sm:p-4">
    <header className="space-y-2"><h1 className="text-lg font-semibold">Dividends</h1><p className="text-sm text-terminal-muted">Upcoming payments, income estimates and a dated dividend record.</p></header>
    <nav aria-label="Dividend views" className="flex flex-wrap gap-2">{(Object.keys(views) as View[]).map(key => <TerminalButton key={key} type="button" aria-pressed={view === key} variant={view === key ? "accent" : "default"} onClick={() => setView(key)} className="normal-case tracking-normal">{views[key]}</TerminalButton>)}</nav>
    {view === "analysis" && <form aria-label="Dividend history scope" className="flex flex-wrap items-end gap-3 rounded border border-terminal-border bg-terminal-panel p-3" onSubmit={event => { event.preventDefault(); if (draft.trim()) { setSymbol(draft.trim().toUpperCase()); setSubmission(value => value + 1); } }}>
      <label className="min-w-0 flex-1 basis-56 space-y-2 text-xs">History symbol<TerminalInput value={draft} onChange={event => setDraft(event.target.value)} className="block text-sm" required maxLength={80} placeholder="AAPL or a native listing symbol" /></label>
      <TerminalButton type="submit" variant="accent" disabled={!draft.trim()} className="normal-case tracking-normal">Load history</TerminalButton>
      <p className="w-full break-words text-xs text-terminal-muted">Applied symbol: {symbol}. Edit the symbol, then load history.</p>
    </form>}
    <DividendRead key={`${view}:${symbol}:${submission}`} view={view} symbol={symbol} />
    <details className="rounded border border-terminal-border p-3 text-sm"><summary className="cursor-pointer text-sm">Coverage and projection method</summary><div className="mt-3 space-y-2 text-sm text-terminal-muted">
      <p>The calendar combines holdings and watchlist symbols, falling back to a small US basket when neither supplies symbols. Returned estimates are not confirmed payment dates.</p>
      <p>Income combines upcoming dividend events over 12 months with trailing-yield estimates where no event is scheduled. Monthly bars include scheduled events only. Ex-dates are not cash settlement dates.</p>
      <p>These endpoints supply no currency or conversion metadata. Mixed-currency totals are not a verified base-currency income forecast. An empty response does not establish that no dividends exist.</p>
      <p>The aristocrat list and streaks are a dated reference; displayed yields alone do not verify continued membership. Source freshness and coverage are not established by this screen.</p>
    </div></details>
  </main>;
}
