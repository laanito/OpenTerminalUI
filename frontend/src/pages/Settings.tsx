import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createAlert, createScheduledReport, deleteAlert, deleteScheduledReport, downloadExport, fetchAlertsFiltered, fetchScheduledReports } from "../api/client";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalTabs } from "../components/terminal/TerminalTabs";
import { conditionLabel } from "../components/Alerts/AlertBuilder";
import { DataManager } from "../components/settings/DataManager";
import { APIKeyManager } from "../components/settings/APIKeyManager";
import { ErrorBoundary } from "../components/common/ErrorBoundary";
import { useSettingsStore, type DisplayCurrency } from "../store/settingsStore";
import { COUNTRY_MARKETS, type AlertRule, type CountryCode, type MarketCode, type ScheduledReport } from "../types";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">{label}</span>{children}</label>;
}
const dataTypes = ["positions", "watchlist", "trades", "screening_results", "backtest_trades"];
const readable = (text: string) => text.replace(/_/g, " ");
const panelClass = "min-w-0 space-y-3 rounded border border-terminal-border bg-terminal-panel p-3";

export function SettingsPage() {
  const preferences = useSettingsStore();
  const [tab, setTab] = useState("preferences");
  const [ticker, setTicker] = useState("AAPL");
  const [alertType, setAlertType] = useState("price");
  const [condition, setCondition] = useState("above");
  const [threshold, setThreshold] = useState(3000);
  const [note, setNote] = useState("");
  const [reportType, setReportType] = useState("portfolio_summary");
  const [frequency, setFrequency] = useState("daily");
  const [email, setEmail] = useState("");
  const [dataType, setDataType] = useState("positions");
  const [busy, setBusy] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const panelId = useId();
  const client = useQueryClient();
  const alertsRead = useQuery({ queryKey: ["settings-alerts"], queryFn: () => fetchAlertsFiltered(), enabled: tab === "automation", retry: false });
  const reportsRead = useQuery({ queryKey: ["settings-reports"], queryFn: fetchScheduledReports, enabled: tab === "automation", retry: false });
  useEffect(() => { if (feedback) feedbackRef.current?.focus(); }, [feedback]);

  async function run(action: string, write: () => Promise<void>, confirmation: string) {
    if (busy) return;
    setBusy(action); setFeedback(null);
    try { await write(); setFeedback({ error: false, text: confirmation }); }
    catch { setFeedback({ error: true, text: action.includes(":") ? "Could not confirm deletion. Refresh the relevant list before retrying manually." : "Could not confirm this action. Your draft is still here; refresh the relevant list before retrying manually." }); }
    finally { setBusy(""); }
  }
  async function saveAlert() {
    await run("alert", async () => {
      const result = await createAlert({ ticker: ticker.trim().toUpperCase(), alert_type: alertType, condition, threshold, note });
      await client.cancelQueries({ queryKey: ["settings-alerts"] });
      client.setQueryData<AlertRule[]>(["settings-alerts"], previous => [result.alert, ...(previous || []).filter(row => row.id !== result.alert.id)]);
      void client.invalidateQueries({ queryKey: ["settings-alerts"] });
      void client.invalidateQueries({ queryKey: ["alerts-console"] });
    }, "Alert created.");
  }
  async function saveReport() {
    await run("schedule", async () => {
      const result = await createScheduledReport({ report_type: reportType, frequency, email, data_type: dataType });
      await client.cancelQueries({ queryKey: ["settings-reports"] });
      client.setQueryData<ScheduledReport[]>(["settings-reports"], previous => [result, ...(previous || []).filter(row => row.id !== result.id)]);
      void client.invalidateQueries({ queryKey: ["settings-reports"] });
    }, "Report schedule saved.");
  }
  async function remove(kind: "alert" | "schedule", id: string) {
    await run(`${kind}:${id}`, async () => {
      const key = kind === "alert" ? "settings-alerts" : "settings-reports";
      if (kind === "alert") await deleteAlert(id); else await deleteScheduledReport(id);
      await client.cancelQueries({ queryKey: [key] });
      client.setQueryData<Array<{ id: string }>>([key], previous => (previous || []).filter(row => row.id !== id));
      void client.invalidateQueries({ queryKey: [key] });
      if (kind === "alert") void client.invalidateQueries({ queryKey: ["alerts-console"] });
    }, kind === "alert" ? "Alert deleted." : "Report schedule deleted.");
  }
  async function exportData(kind: string, format: "csv" | "xlsx" | "pdf") {
    if (busy) return;
    setBusy(`export:${kind}:${format}`); setFeedback(null);
    try {
      const blob = await downloadExport(kind, format);
      const url = URL.createObjectURL(blob);
      try { const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${kind}.${format}`; anchor.click(); }
      finally { URL.revokeObjectURL(url); }
      setFeedback({ error: false, text: `${readable(kind)} download prepared (${format.toUpperCase()}).` });
    } catch { setFeedback({ error: true, text: "Could not download the export. Retry manually when ready." }); }
    finally { setBusy(""); }
  }
  const tabs = [{ id: "preferences", label: "Preferences" }, { id: "automation", label: "Automation" }, { id: "data", label: "Data" }, { id: "host", label: "Host setup" }].map(item => ({ ...item, disabled: keyBusy && tab !== item.id }));

  return <main aria-label="Settings console" className="min-w-0 space-y-3 p-3 [overflow-wrap:anywhere] [&_input]:min-w-0 [&_input]:!text-sm [&_select]:min-w-0 [&_select]:!text-sm md:p-4">
    <header><h1 className="text-lg font-semibold">Settings</h1><p className="text-sm text-terminal-muted">Browser preferences, automation access and data tools.</p></header>
    <TerminalTabs ariaLabel="Settings sections" items={tabs} value={tab} onChange={value => { setTab(value); setFeedback(null); }} panelId={panelId} variant="accent" />
    {feedback ? <p ref={feedbackRef} tabIndex={-1} role={feedback.error ? "alert" : "status"} className={`text-sm ${feedback.error ? "text-terminal-neg" : "text-terminal-muted"}`}>{feedback.text}</p> : null}
    <div id={panelId} role="tabpanel" aria-label={tabs.find(item => item.id === tab)?.label} className="min-w-0">
      <section hidden={tab !== "preferences"} aria-label="Browser preferences" className={panelClass}>
        <h2 className="text-sm font-semibold">Browser preferences</h2><p className="text-xs text-terminal-muted">Saved automatically in this browser.</p>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Market context"><TerminalInput as="select" value={preferences.selectedCountry} onChange={event => preferences.setSelectedCountry(event.target.value as CountryCode)}><option value="US">United States</option><option value="EU">Europe</option><option value="IN">India</option><option value="CRYPTO">Crypto</option></TerminalInput></Field>
          <Field label="Exchange"><TerminalInput as="select" value={preferences.selectedMarket} onChange={event => preferences.setSelectedMarket(event.target.value as MarketCode)}>{COUNTRY_MARKETS[preferences.selectedCountry].map(market => <option key={market} value={market}>{market}</option>)}</TerminalInput></Field>
          <Field label="Display currency"><TerminalInput as="select" value={preferences.displayCurrency} onChange={event => preferences.setDisplayCurrency(event.target.value as DisplayCurrency)}>{["USD", "EUR", "INR"].map(currency => <option key={currency}>{currency}</option>)}</TerminalInput></Field>
          <Field label="Quote updates"><TerminalInput as="select" value={preferences.realtimeMode} onChange={event => preferences.setRealtimeMode(event.target.value as "polling" | "ws")}><option value="polling">Polling</option><option value="ws">WebSocket</option></TerminalInput></Field>
          <Field label="News auto-refresh"><TerminalInput as="select" value={preferences.newsAutoRefresh ? "on" : "off"} onChange={event => preferences.setNewsAutoRefresh(event.target.value === "on")}><option value="on">On</option><option value="off">Off</option></TerminalInput></Field>
          <Field label="News refresh interval (seconds)"><TerminalInput type="number" min={5} value={preferences.newsRefreshSec} onChange={event => preferences.setNewsRefreshSec(Math.max(5, Number(event.target.value) || 60))} /></Field>
        </div>
      </section>
      <div hidden={tab !== "automation"} className="min-w-0 space-y-3">
        <ErrorBoundary><APIKeyManager onBusyChange={setKeyBusy} /></ErrorBoundary>
        <section aria-label="Scheduled reports" className={panelClass}>
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Scheduled reports</h2><TerminalButton size="sm" disabled={reportsRead.isFetching || Boolean(busy)} onClick={() => void reportsRead.refetch()}>Refresh schedules</TerminalButton></div>
          <details><summary className="cursor-pointer text-sm text-terminal-accent">Add report schedule</summary><form aria-label="Add report schedule" className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); void saveReport(); }}><fieldset disabled={Boolean(busy)} className="grid min-w-0 items-end gap-3 sm:grid-cols-2">
            <Field label="Report type"><TerminalInput required value={reportType} onChange={event => setReportType(event.target.value)} /></Field>
            <Field label="Frequency"><TerminalInput as="select" value={frequency} onChange={event => setFrequency(event.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option></TerminalInput></Field>
            <Field label="Email (optional)"><TerminalInput type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Defaults to your account" /></Field>
            <Field label="Report data"><TerminalInput as="select" value={dataType} onChange={event => setDataType(event.target.value)}>{dataTypes.map(kind => <option key={kind} value={kind}>{readable(kind)}</option>)}</TerminalInput></Field>
          </fieldset><TerminalButton type="submit" variant="accent" disabled={Boolean(busy)} loading={busy === "schedule"}>Save schedule</TerminalButton></form></details>
          {reportsRead.isFetching ? <p role="status" className="text-sm text-terminal-muted">Loading report schedules…</p> : null}
          {reportsRead.isError ? <p role="alert" className="text-sm text-terminal-neg">Could not refresh schedules. Any previous schedules below have not been refreshed.</p> : null}
          {reportsRead.data?.length === 0 && !reportsRead.isError && !reportsRead.isFetching ? <p className="text-sm text-terminal-muted">No schedules configured.</p> : null}
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">{reportsRead.data?.map(row => <article key={row.id} aria-label={`${row.report_type} schedule`} className="min-w-0 space-y-2 rounded border border-terminal-border bg-terminal-bg p-3"><h3 className="text-sm font-semibold">{readable(row.report_type)}</h3><p className="text-sm">{readable(row.data_type)} · {row.frequency}</p><p className="text-sm text-terminal-muted">{row.email || "Account email"}</p><p className="text-xs text-terminal-muted">{row.enabled ? "Enabled" : "Disabled"}</p><TerminalButton size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => void remove("schedule", row.id)}>Delete schedule</TerminalButton></article>)}</div>
        </section>
        <section aria-label="Quick alerts" className={panelClass}>
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Quick alerts</h2><Link className="text-sm text-terminal-accent underline" to="/equity/alerts">Open Alerts console</Link></div>
          <details><summary className="cursor-pointer text-sm text-terminal-accent">Add quick alert</summary><form aria-label="Add quick alert" className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); void saveAlert(); }}><fieldset disabled={Boolean(busy)} className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Field label="Alert ticker"><TerminalInput required value={ticker} onChange={event => setTicker(event.target.value.toUpperCase())} /></Field>
            <Field label="Alert type"><TerminalInput as="select" value={alertType} onChange={event => setAlertType(event.target.value)}>{["price", "technical", "fundamental", "composite"].map(type => <option key={type}>{type}</option>)}</TerminalInput></Field>
            <Field label="Condition"><TerminalInput as="select" value={condition} onChange={event => setCondition(event.target.value)}>{["above", "below", "crosses"].map(type => <option key={type}>{type}</option>)}</TerminalInput></Field>
            <Field label={alertType === "price" ? "Threshold (quoted units)" : "Threshold"}><TerminalInput type="number" step="any" value={threshold} onChange={event => setThreshold(Number(event.target.value))} /></Field>
            <div className="min-w-0 sm:col-span-2"><Field label="Alert note"><TerminalInput value={note} onChange={event => setNote(event.target.value)} /></Field></div>
          </fieldset><TerminalButton type="submit" variant="accent" disabled={Boolean(busy)} loading={busy === "alert"}>Add Alert</TerminalButton></form></details>
          <TerminalButton size="sm" disabled={alertsRead.isFetching || Boolean(busy)} onClick={() => void alertsRead.refetch()}>Refresh quick alerts</TerminalButton>
          {alertsRead.isFetching ? <p role="status" className="text-sm text-terminal-muted">Loading alert rules…</p> : null}
          {alertsRead.isError ? <p role="alert" className="text-sm text-terminal-neg">Could not refresh quick alerts. Any previous rules below have not been refreshed.</p> : null}
          {alertsRead.data?.length === 0 && !alertsRead.isError && !alertsRead.isFetching ? <p className="text-sm text-terminal-muted">No alert rules configured.</p> : null}
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">{alertsRead.data?.map(row => <article key={row.id} aria-label={`${row.symbol || row.ticker} quick alert`} className="min-w-0 space-y-2 rounded border border-terminal-border bg-terminal-bg p-3"><h3 className="text-sm font-semibold">{row.symbol || row.ticker}</h3><p className="text-sm">{row.conditions?.length ? row.conditions.map(conditionLabel).join(` ${row.logic || "AND"} `) : `${row.alert_type} · ${row.condition} ${row.threshold ?? ""}`}</p>{row.note ? <p className="whitespace-pre-wrap text-sm text-terminal-muted">{row.note}</p> : null}<TerminalButton size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => void remove("alert", row.id)}>Delete alert</TerminalButton></article>)}</div>
        </section>
      </div>
      <div hidden={tab !== "data"} className="min-w-0 space-y-3">
        <section aria-label="Data export" className={panelClass}><h2 className="text-sm font-semibold">Data export</h2><div className="grid min-w-0 gap-3 lg:grid-cols-2">{["watchlist", "positions", "trades", "screening_results", "backtest_trades"].map(kind => <article key={kind} aria-label={`${readable(kind)} exports`} className="min-w-0 space-y-2 rounded border border-terminal-border bg-terminal-bg p-3"><h3 className="text-sm font-semibold capitalize">{readable(kind)}</h3><div className="flex flex-wrap gap-2">{(["csv", "xlsx", "pdf"] as const).map(format => <TerminalButton key={format} disabled={Boolean(busy)} loading={busy === `export:${kind}:${format}`} onClick={() => void exportData(kind, format)}>{format.toUpperCase()}</TerminalButton>)}</div></article>)}</div></section>
        <ErrorBoundary><DataManager /></ErrorBoundary>
      </div>
      <section hidden={tab !== "host"} aria-label="Host-managed providers" className={panelClass}><h2 className="text-sm font-semibold">Market data configuration</h2><p className="text-sm text-terminal-muted">Provider credentials are server-side environment settings, not account preferences. Ask the host operator to update the deployment and restart it; never paste provider secrets into browser storage.</p><div className="grid min-w-0 gap-3 lg:grid-cols-2">{[["FRED_API_KEY", "Live macro indicators and yield-curve series"], ["FMP_API_KEY", "Commodity data and broader US fundamentals"], ["FINNHUB_API_KEY", "Live US WebSocket ticks"], ["KITE_*", "India NSE/BSE F&O and market depth"], ["OPENTERMINALUI_NSE_PUBLIC_ENABLED", "Optional direct nseindia.com compatibility access (off by default)"]].map(([key, purpose]) => <article key={key} className="min-w-0 space-y-2 rounded border border-terminal-border bg-terminal-bg p-3"><code className="block break-all text-sm">{key}</code><p className="text-sm text-terminal-muted">{purpose}</p></article>)}</div><p className="text-sm text-terminal-muted">Automation API keys authenticate external clients such as note-ingestion tools. They do not unlock market-data providers.</p></section>
    </div>
  </main>;
}
