import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import {
  createAlert,
  deleteAlert,
  fetchAlertHistory,
  fetchAlertsFiltered,
  testAlertDelivery,
  updateAlert,
} from "../api/client";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { AlertBuilder, conditionLabel } from "../components/Alerts/AlertBuilder";
import { TerminalTabs, type TerminalTabItem } from "../components/terminal/TerminalTabs";
import { useAlertsStore } from "../store/alertsStore";
import type { AlertRule } from "../types";

const DELIVERY_SETTINGS_KEY = "ot.alert.delivery.defaults";

function alertsWsUrl(): string {
  const base = String(import.meta.env.VITE_API_BASE_URL || "/api");
  if (base.startsWith("http://") || base.startsWith("https://")) {
    const url = new URL(base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws/alerts`;
    return url.toString();
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${base.replace(/\/+$/, "")}/ws/alerts`;
}

function summarizeAlert(alert: AlertRule): string {
  const conditions =
    alert.conditions && alert.conditions.length
      ? alert.conditions
      : alert.threshold != null
        ? [{ field: "price", operator: alert.condition || "above", value: alert.threshold }]
        : [];
  const logic = alert.logic || "AND";
  return conditions.map(conditionLabel).join(` ${logic} `);
}

export function AlertsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryTicker = searchParams.get("ticker") || searchParams.get("symbol") || "";
  const [tab, setTab] = useState("active");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState<AlertRule | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [defaultsNotice, setDefaultsNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [defaultDeliveryConfig, setDefaultDeliveryConfig] = useState<Record<string, string>>(() => {
    try { const parsed = JSON.parse(localStorage.getItem(DELIVERY_SETTINGS_KEY) || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
  });
  const queryClient = useQueryClient();
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const returnFocus = useRef(false);
  const panelId = useId();
  const incrementUnread = useAlertsStore(state => state.incrementUnread);
  const resetUnread = useAlertsStore(state => state.resetUnread);
  const rulesRead = useQuery({ queryKey: ["alerts-console"], queryFn: () => fetchAlertsFiltered(), retry: false });
  const historyRead = useQuery({ queryKey: ["alerts-console-history", historyPage], queryFn: () => fetchAlertHistory(historyPage, 10), retry: false });
  const alerts = rulesRead.data || [];
  const history = historyRead.data?.history || [];
  const historyTotal = historyRead.data?.total || 0;
  const activeAlerts = alerts.filter(alert => alert.status !== "deleted" && (!queryTicker || String(alert.symbol || alert.ticker || "").toUpperCase().endsWith(queryTicker.toUpperCase())));

  useEffect(() => { resetUnread(); }, [resetUnread]);
  useEffect(() => { if (!builderOpen && returnFocus.current) { returnFocus.current = false; feedbackRef.current?.focus(); } }, [builderOpen, feedback]);
  useEffect(() => {
    const ws = new WebSocket(alertsWsUrl());
    ws.onmessage = event => {
      try {
        const payload = JSON.parse(String(event.data)); if (payload?.type !== "alert_triggered") return;
        incrementUnread();
        window.dispatchEvent(new CustomEvent("ot:alert-toast", { detail: { title: `Alert: ${String(payload.symbol || "").toUpperCase() || "SYMBOL"}`, message: `${String(payload.condition || "Condition met")} @ ${payload.triggered_value ?? "NA"}`, variant: "warning", ttlMs: 5000 } }));
        setHistoryPage(1); void queryClient.invalidateQueries({ queryKey: ["alerts-console-history"] }); void queryClient.invalidateQueries({ queryKey: ["alerts-console"] });
      } catch { /* Ignore malformed socket events. */ }
    };
    return () => ws.close();
  }, [incrementUnread, queryClient]);

  async function handleSaveAlert(payload: Parameters<typeof createAlert>[0]) {
    const result = editingAlert?.id ? await updateAlert(editingAlert.id, payload) : await createAlert(payload);
    await queryClient.cancelQueries({ queryKey: ["alerts-console"] });
    // Confirmation is independent of the following reads; never replay the write.
    if (result.alert) queryClient.setQueryData<AlertRule[]>(["alerts-console"], previous => [result.alert, ...(previous || []).filter(rule => rule.id !== result.alert.id)]);
    setFeedback({ error: false, text: editingAlert?.id ? "Alert updated." : "Alert created." });
    returnFocus.current = true; setBuilderOpen(false); setEditingAlert(null); setHistoryPage(1);
    void queryClient.invalidateQueries({ queryKey: ["alerts-console"] }); void queryClient.invalidateQueries({ queryKey: ["alerts-console-history"] });
  }

  async function runAction(alert: AlertRule, action: "toggle" | "delete" | "test") {
    if (busyAction) return;
    setBusyAction(`${alert.id}:${action}`); setFeedback(null);
    try {
      if (action === "delete") {
        await deleteAlert(alert.id);
        await queryClient.cancelQueries({ queryKey: ["alerts-console"] });
        queryClient.setQueryData<AlertRule[]>(["alerts-console"], previous => (previous || []).filter(rule => rule.id !== alert.id));
        setFeedback({ error: false, text: `Deleted alert for ${alert.symbol || alert.ticker}.` }); returnFocus.current = true;
      } else if (action === "test") {
        await testAlertDelivery(alert.id); setFeedback({ error: false, text: "Delivery test requested for configured channels." });
      } else {
        const status = alert.status === "paused" ? "active" : "paused";
        const result = await updateAlert(alert.id, { status });
        await queryClient.cancelQueries({ queryKey: ["alerts-console"] });
        queryClient.setQueryData<AlertRule[]>(["alerts-console"], previous => (previous || []).map(rule => rule.id === alert.id ? result.alert || { ...rule, status } : rule));
        setFeedback({ error: false, text: status === "paused" ? "Alert paused." : "Alert resumed." });
      }
      if (action !== "test") void queryClient.invalidateQueries({ queryKey: ["alerts-console"] });
    } catch { returnFocus.current = true; setFeedback({ error: true, text: `Could not confirm the ${action === "toggle" ? "status change" : action === "delete" ? "deletion" : "delivery test"}. Check the rules before retrying manually.` }); }
    finally { setBusyAction(null); }
  }

  const tabs: TerminalTabItem[] = [
    { id: "active", label: "Active Alerts", badge: rulesRead.data ? String(activeAlerts.length) : undefined },
    { id: "history", label: "Alert History", badge: historyRead.data ? String(historyTotal) : undefined },
    { id: "settings", label: "Delivery Settings" },
  ];
  const deliveryField = (key: string, label: string, type = "text") => <label className="block min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">{label}</span><TerminalInput aria-label={label} type={type} value={defaultDeliveryConfig[key] || ""} onChange={event => { setDefaultDeliveryConfig(previous => ({ ...previous, [key]: event.target.value })); setDefaultsNotice(null); }} className="!text-sm" /></label>;

  return (
    <main aria-label="Alerts console" className="min-w-0 space-y-3 p-3 [overflow-wrap:anywhere] md:p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h1 className="text-lg font-semibold">Alerts</h1><p className="text-sm text-terminal-muted">Review rules and triggered events; create or edit an alert when needed.</p></div>
        <TerminalButton variant="accent" disabled={Boolean(busyAction)} onClick={() => { setEditingAlert(queryTicker ? { id: "", ticker: queryTicker, symbol: queryTicker } as AlertRule : null); setBuilderOpen(true); }}>Create New Alert</TerminalButton>
      </header>
      {queryTicker ? <div className="flex flex-wrap items-center gap-2 text-sm"><span className="break-words">Rule filter: {queryTicker}</span><TerminalButton size="sm" onClick={() => { const next = new URLSearchParams(searchParams); next.delete("ticker"); next.delete("symbol"); setSearchParams(next); }}>Clear ticker filter</TerminalButton></div> : null}
      {feedback ? <p ref={feedbackRef} tabIndex={-1} role={feedback.error ? "alert" : "status"} className={`text-sm ${feedback.error ? "text-terminal-neg" : "text-terminal-muted"}`}>{feedback.text}</p> : null}
      <TerminalTabs ariaLabel="Alert sections" panelId={panelId} items={tabs} value={tab} onChange={setTab} variant="accent" />
      <section id={panelId} role="tabpanel" aria-label={tabs.find(item => item.id === tab)?.label} className="min-w-0 space-y-3">
        {tab === "active" ? <>
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Alert rules</h2><TerminalButton size="sm" disabled={rulesRead.isFetching || Boolean(busyAction)} onClick={() => void rulesRead.refetch()}>Refresh rules</TerminalButton></div>
          {rulesRead.isPending ? <p role="status" className="text-sm text-terminal-muted">Loading alert rules…</p> : null}
          {rulesRead.isError ? <p role="alert" className="text-sm text-terminal-neg">Could not refresh alert rules. Any previous rules below have not been refreshed.</p> : null}
          {!rulesRead.isPending && !rulesRead.isError && !activeAlerts.length ? <p className="text-sm text-terminal-muted">{queryTicker ? "No alerts match this ticker filter." : "No alerts configured."}</p> : null}
          {activeAlerts.map(alert => <article key={alert.id} aria-label={`${alert.symbol || alert.ticker} alert`} className="min-w-0 space-y-3 rounded border border-terminal-border bg-terminal-panel p-3 [overflow-wrap:anywhere]">
            <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-1"><h3 className="text-sm font-semibold text-terminal-accent">{alert.symbol || alert.ticker}</h3><p className="text-xs text-terminal-muted">Status: {alert.status || "active"}</p><p className="text-xs text-terminal-muted">Cooldown: {alert.cooldown_minutes || 0}m · Triggers: {alert.trigger_count || 0}{alert.max_triggers ? ` / ${alert.max_triggers}` : " / unlimited"}</p></div>
              <div className="min-w-0 space-y-1"><p className="text-sm">{summarizeAlert(alert)}</p><p className="text-xs text-terminal-muted">Logic: {alert.logic || "AND"}</p>{alert.note ? <details><summary className="cursor-pointer text-xs text-terminal-muted">Rule note</summary><p className="mt-2 whitespace-pre-wrap text-sm text-terminal-muted">{alert.note}</p></details> : null}{alert.expiry_date ? <p className="text-xs text-terminal-muted">Expires <time dateTime={alert.expiry_date}>{new Date(alert.expiry_date).toLocaleString()}</time></p> : null}</div>
              <div className="min-w-0 space-y-1"><h4 className="text-xs text-terminal-muted">Delivery</h4><div className="flex flex-wrap gap-2">{(alert.delivery_channels || alert.channels || []).map(channel => <span key={channel} className="break-words rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted">{channel.replace(/_/g, " ")}</span>)}</div></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <TerminalButton size="sm" disabled={Boolean(busyAction)} onClick={() => { setEditingAlert(alert); setBuilderOpen(true); }}>Edit</TerminalButton>
              <TerminalButton size="sm" disabled={Boolean(busyAction)} loading={busyAction === `${alert.id}:toggle`} onClick={() => void runAction(alert, "toggle")}>{alert.status === "paused" ? "Resume" : "Pause"}</TerminalButton>
              <TerminalButton size="sm" disabled={Boolean(busyAction)} loading={busyAction === `${alert.id}:test`} onClick={() => void runAction(alert, "test")}>Test delivery</TerminalButton>
              <TerminalButton size="sm" variant="danger" disabled={Boolean(busyAction)} loading={busyAction === `${alert.id}:delete`} onClick={() => void runAction(alert, "delete")}>Delete</TerminalButton>
            </div>
          </article>)}
        </> : tab === "history" ? <>
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Triggered events</h2><TerminalButton size="sm" disabled={historyRead.isFetching} onClick={() => void historyRead.refetch()}>Refresh history</TerminalButton></div>
          {historyRead.isPending ? <p role="status" className="text-sm text-terminal-muted">Loading alert history…</p> : null}
          {historyRead.isError ? <p role="alert" className="text-sm text-terminal-neg">Could not refresh alert history. Any previous events below have not been refreshed.</p> : null}
          {!historyRead.isPending && !historyRead.isError && !history.length ? <p className="text-sm text-terminal-muted">No triggered alerts yet.</p> : null}
          {history.map(item => <article key={item.id} aria-label={`${item.symbol} event`} className="min-w-0 space-y-1 rounded border border-terminal-border bg-terminal-panel p-3 [overflow-wrap:anywhere]"><h3 className="text-sm font-semibold">{item.symbol}</h3><p className="text-sm">{item.condition_type.replace(/_/g, " ")}</p><p className="text-xs text-terminal-muted">Value: {item.triggered_value ?? "—"} · <time dateTime={item.triggered_at}>{new Date(item.triggered_at).toLocaleString()}</time></p></article>)}
          <nav aria-label="History pages" className="flex flex-wrap items-center justify-between gap-2 text-xs"><TerminalButton size="sm" disabled={historyRead.isFetching || historyPage <= 1} onClick={() => setHistoryPage(page => page - 1)}>Previous</TerminalButton><span>Page {historyPage}{historyRead.data ? ` of ${Math.max(1, Math.ceil(historyTotal / 10))}` : ""}</span><TerminalButton size="sm" disabled={historyRead.isFetching || !historyRead.data || historyPage >= Math.ceil(historyTotal / 10)} onClick={() => setHistoryPage(page => page + 1)}>Next</TerminalButton></nav>
        </> : <form aria-label="Default delivery settings" className="min-w-0 space-y-3 rounded border border-terminal-border bg-terminal-panel p-3" onSubmit={event => { event.preventDefault(); try { localStorage.setItem(DELIVERY_SETTINGS_KEY, JSON.stringify(defaultDeliveryConfig)); setDefaultsNotice({ error: false, text: "Delivery defaults saved in this browser." }); } catch { setDefaultsNotice({ error: true, text: "Could not save delivery defaults in this browser. Your draft is still here." }); } }}>
          <h2 className="text-sm font-semibold">Default delivery settings</h2><p className="text-xs text-terminal-muted">Used when opening a new alert in this browser.</p>
          {deliveryField("webhook_url", "Default Webhook URL", "url")}
          <div className="grid min-w-0 gap-3 md:grid-cols-2">{deliveryField("telegram_token", "Default Telegram Bot Token", "password")}{deliveryField("telegram_chat_id", "Default Telegram Chat ID")}</div>
          {deliveryField("discord_webhook_url", "Default Discord Webhook URL", "url")}
          <TerminalButton type="submit" variant="accent">Save Delivery Defaults</TerminalButton>
          {defaultsNotice ? <p role={defaultsNotice.error ? "alert" : "status"} className={`text-sm ${defaultsNotice.error ? "text-terminal-neg" : "text-terminal-muted"}`}>{defaultsNotice.text}</p> : null}
        </form>}
      </section>
      <AlertBuilder open={builderOpen} mode={editingAlert?.id ? "edit" : "create"} initialAlert={editingAlert} defaultDeliveryConfig={defaultDeliveryConfig} onClose={() => { setBuilderOpen(false); setEditingAlert(null); }} onSave={handleSaveAlert} onTestChannel={editingAlert?.id ? async () => { await testAlertDelivery(editingAlert.id); } : undefined} />
    </main>
  );
}
