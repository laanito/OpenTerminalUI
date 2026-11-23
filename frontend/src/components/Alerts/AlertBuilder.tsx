import { useLayoutEffect, useId, useMemo, useState } from "react";

import type { AlertCondition, AlertRule } from "../../types";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalModal } from "../terminal/TerminalModal";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  initialAlert?: AlertRule | null;
  defaultDeliveryConfig?: Record<string, string>;
  onClose: () => void;
  onSave: (payload: {
    symbol: string;
    conditions: AlertCondition[];
    logic: string;
    delivery_channels: string[];
    delivery_config: Record<string, string>;
    cooldown_minutes: number;
    expiry_date: string | null;
    max_triggers: number;
  }) => Promise<void>;
  onTestChannel?: (channel: string) => Promise<void>;
};

const FIELD_OPTIONS = [
  { value: "price", label: "Price", operators: ["above", "below", "cross_above", "cross_below"] },
  { value: "change_pct", label: "% Change", operators: ["above", "below"] },
  { value: "volume", label: "Volume", operators: ["above", "spike"] },
  { value: "rsi_14", label: "RSI(14)", operators: ["above", "below"] },
  { value: "macd_signal", label: "MACD Signal Cross", operators: ["cross_above", "cross_below"] },
  { value: "ema_cross", label: "EMA Cross", operators: ["cross_above", "cross_below"] },
  { value: "oi_change", label: "OI Change", operators: ["above", "below"] },
  { value: "iv", label: "IV", operators: ["above", "below"] },
] as const;

const DELIVERY_CHANNELS = [
  { value: "in_app", label: "In-App" },
  { value: "webhook", label: "Webhook" },
  { value: "telegram", label: "Telegram" },
  { value: "discord", label: "Discord" },
] as const;

const DEFAULT_CONDITION: AlertCondition = { field: "price", operator: "above", value: 2500, params: {} };

export function conditionLabel(condition: AlertCondition): string {
  const field = FIELD_OPTIONS.find((option) => option.value === condition.field);
  const op = String(condition.operator || "").replace(/_/g, " ");
  return `${field?.label || condition.field} ${op} ${condition.value ?? ""}`.trim();
}

function expiryInput(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function normalizeAlert(alert?: AlertRule | null, defaults?: Record<string, string>) {
  const conditions =
    alert?.conditions && alert.conditions.length
      ? alert.conditions
      : alert?.threshold != null
        ? [{ field: "price", operator: alert.condition || "above", value: alert.threshold, params: {} }]
        : [DEFAULT_CONDITION];
  return {
    symbol: alert?.symbol || alert?.ticker || "AAPL",
    conditions,
    logic: alert?.logic || "AND",
    delivery_channels: alert?.delivery_channels || alert?.channels || ["in_app"],
    delivery_config: {
      webhook_url: String(alert?.delivery_config?.webhook_url || defaults?.webhook_url || ""),
      telegram_token: String(alert?.delivery_config?.telegram_token || defaults?.telegram_token || ""),
      telegram_chat_id: String(alert?.delivery_config?.telegram_chat_id || defaults?.telegram_chat_id || ""),
      discord_webhook_url: String(alert?.delivery_config?.discord_webhook_url || defaults?.discord_webhook_url || ""),
    },
    cooldown_minutes: Number(alert?.cooldown_minutes || 0),
    expiry_date: expiryInput(alert?.expiry_date),
    max_triggers: Number(alert?.max_triggers || 0),
  };
}

export function AlertBuilder({
  open,
  mode,
  initialAlert,
  defaultDeliveryConfig,
  onClose,
  onSave,
  onTestChannel,
}: Props) {
  const [symbol, setSymbol] = useState("AAPL");
  const [conditions, setConditions] = useState<AlertCondition[]>([DEFAULT_CONDITION]);
  const [logic, setLogic] = useState("AND");
  const [deliveryChannels, setDeliveryChannels] = useState<string[]>(["in_app"]);
  const [deliveryConfig, setDeliveryConfig] = useState<Record<string, string>>({
    webhook_url: "",
    telegram_token: "",
    telegram_chat_id: "",
    discord_webhook_url: "",
  });
  const [cooldownMinutes, setCooldownMinutes] = useState(0);
  const [expiryDate, setExpiryDate] = useState("");
  const [maxTriggers, setMaxTriggers] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState("");
  const formId = useId();
  const busy = saving || testing;

  useLayoutEffect(() => {
    if (!open) return;
    const next = normalizeAlert(initialAlert, defaultDeliveryConfig);
    setSymbol(next.symbol);
    setConditions(next.conditions);
    setLogic(next.logic);
    setDeliveryChannels(next.delivery_channels);
    setDeliveryConfig(next.delivery_config);
    setCooldownMinutes(next.cooldown_minutes);
    setExpiryDate(next.expiry_date);
    setMaxTriggers(next.max_triggers);
    setError(null); setNotice("");
  }, [defaultDeliveryConfig, initialAlert, open]);

  const preview = useMemo(() => {
    const joined = conditions.map(conditionLabel).join(` ${logic} `);
    return `Alert when ${symbol || "SYMBOL"} ${joined}`;
  }, [conditions, logic, symbol]);

  async function handleSave() {
    if (busy) return;
    if (!symbol.trim()) { setError("Enter a symbol."); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        symbol: symbol.trim().toUpperCase(),
        conditions,
        logic,
        delivery_channels: deliveryChannels,
        delivery_config: deliveryConfig,
        cooldown_minutes: Math.max(0, cooldownMinutes),
        expiry_date: expiryDate ? new Date(expiryDate === expiryInput(initialAlert?.expiry_date) && initialAlert?.expiry_date ? initialAlert.expiry_date : expiryDate).toISOString() : null,
        max_triggers: Math.max(0, maxTriggers),
      });
    } catch {
      setError("Could not save this alert. Your draft is still here; check the rules before retrying manually.");
      return;
    } finally {
      setSaving(false);
    }
  }

  async function testDelivery() {
    if (!onTestChannel || busy) return;
    setTesting(true); setNotice(""); setError(null);
    try { await onTestChannel("all"); setNotice("Delivery test requested for the configured channels."); }
    catch { setError("Could not complete the delivery test. Your draft is unchanged."); }
    finally { setTesting(false); }
  }

  return (
    <TerminalModal open={open} onClose={onClose} title={mode === "edit" ? "Edit Alert" : "Create Alert"}
      subtitle="Define a rule, review its conditions and choose delivery." size="lg" busy={busy}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <TerminalButton size="sm" onClick={onClose} disabled={busy}>Cancel</TerminalButton>
        <TerminalButton size="sm" variant="accent" form={formId} type="submit" loading={saving} disabled={testing}>Save</TerminalButton>
      </div>}>
      <form aria-label="Alert rule" id={formId} className="min-w-0 space-y-4 [&_input]:min-w-0 [&_input]:!text-sm [&_select]:min-w-0 [&_select]:!text-sm" onSubmit={event => { event.preventDefault(); void handleSave(); }}>
        {error ? <p role="alert" className="text-sm text-terminal-neg">{error}</p> : null}
        {notice ? <p role="status" className="text-sm text-terminal-muted">{notice}</p> : null}
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <label className="block min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Symbol</span>
            <TerminalInput required value={symbol} onChange={event => setSymbol(event.target.value)} placeholder="AAPL" className="uppercase" />
          </label>
          <section aria-label="Alert conditions" className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-terminal-accent">Conditions</h2>
              <TerminalButton size="sm" type="button" onClick={() => setConditions(previous => [...previous, { ...DEFAULT_CONDITION, params: {} }])}>Add Condition</TerminalButton>
            </div>
            <p className="text-xs text-terminal-muted">Price thresholds use the symbol's quoted units; change thresholds use percentages.</p>
            {conditions.map((condition, index) => {
              const field = FIELD_OPTIONS.find(option => option.value === condition.field) || FIELD_OPTIONS[0];
              const set = (patch: Partial<AlertCondition>) => setConditions(previous => previous.map((row, i) => i === index ? { ...row, ...patch } : row));
              return <fieldset key={index} className="min-w-0 rounded border border-terminal-border bg-terminal-bg p-3">
                <legend className="px-1 text-xs text-terminal-muted">Condition {index + 1}</legend>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Field</span>
                    <TerminalInput as="select" aria-label={`Condition field ${index + 1}`} value={condition.field} onChange={event => { const next = FIELD_OPTIONS.find(option => option.value === event.target.value) || FIELD_OPTIONS[0]; set({ field: next.value, operator: next.operators[0], params: {} }); }}>{FIELD_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</TerminalInput>
                  </label>
                  <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Operator</span>
                    <TerminalInput as="select" aria-label={`Condition operator ${index + 1}`} value={condition.operator} onChange={event => set({ operator: event.target.value })}>{field.operators.map(operator => <option key={operator} value={operator}>{operator.replace(/_/g, " ")}</option>)}</TerminalInput>
                  </label>
                  <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Threshold</span>
                    <TerminalInput type="number" step="any" aria-label={`Condition value ${index + 1}`} value={String(condition.value ?? "")} onChange={event => set({ value: Number(event.target.value), params: condition.params || {} })} />
                  </label>
                  {condition.field === "ema_cross" ? <>
                    <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Fast EMA period</span><TerminalInput aria-label={`EMA fast ${index + 1}`} type="number" value={String(condition.params?.fast_period || 9)} onChange={event => set({ params: { ...(condition.params || {}), fast_period: Number(event.target.value) } })} /></label>
                    <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Slow EMA period</span><TerminalInput aria-label={`EMA slow ${index + 1}`} type="number" value={String(condition.params?.slow_period || 21)} onChange={event => set({ params: { ...(condition.params || {}), slow_period: Number(event.target.value) } })} /></label>
                  </> : condition.field === "volume" && condition.operator === "spike" ? <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Volume multiplier</span><TerminalInput aria-label={`Volume multiplier ${index + 1}`} type="number" step="any" value={String(condition.params?.multiplier || 2)} onChange={event => set({ params: { ...(condition.params || {}), multiplier: Number(event.target.value) } })} /></label> : null}
                </div>
                <div className="mt-3 flex justify-end"><TerminalButton type="button" size="sm" variant="danger" aria-label={`Remove condition ${index + 1}`} disabled={conditions.length <= 1} onClick={() => setConditions(previous => previous.filter((_, i) => i !== index))}>Remove condition</TerminalButton></div>
              </fieldset>;
            })}
            <div role="group" aria-label="Condition logic" className="flex flex-wrap items-center gap-2"><span className="text-xs text-terminal-muted">Join conditions</span>{["AND", "OR"].map(value => <TerminalButton key={value} size="sm" type="button" aria-pressed={logic === value} variant={logic === value ? "accent" : "default"} onClick={() => setLogic(value)}>{value}</TerminalButton>)}</div>
            <p aria-label="Rule preview" className="break-words rounded border border-terminal-border p-3 text-sm text-terminal-muted">{preview}</p>
          </section>
          <section aria-label="Alert delivery" className="min-w-0 space-y-3">
            <h2 className="text-sm font-semibold text-terminal-accent">Delivery</h2>
            <div className="flex flex-wrap gap-3">{DELIVERY_CHANNELS.map(channel => <label key={channel.value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={deliveryChannels.includes(channel.value)} onChange={() => setDeliveryChannels(previous => previous.includes(channel.value) ? previous.filter(value => value !== channel.value) : [...previous, channel.value])} />{channel.label}</label>)}</div>
            {deliveryChannels.includes("webhook") ? <label className="block space-y-1"><span className="block text-xs text-terminal-muted">Webhook URL</span><TerminalInput type="url" aria-label="Webhook URL" value={deliveryConfig.webhook_url || ""} onChange={event => setDeliveryConfig(previous => ({ ...previous, webhook_url: event.target.value }))} placeholder="https://example.com/hook" /></label> : null}
            {deliveryChannels.includes("telegram") ? <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Telegram Bot Token</span><TerminalInput type="password" aria-label="Telegram Bot Token" value={deliveryConfig.telegram_token || ""} onChange={event => setDeliveryConfig(previous => ({ ...previous, telegram_token: event.target.value }))} /></label>
              <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Telegram Chat ID</span><TerminalInput aria-label="Telegram Chat ID" value={deliveryConfig.telegram_chat_id || ""} onChange={event => setDeliveryConfig(previous => ({ ...previous, telegram_chat_id: event.target.value }))} /></label>
            </div> : null}
            {deliveryChannels.includes("discord") ? <label className="block space-y-1"><span className="block text-xs text-terminal-muted">Discord Webhook URL</span><TerminalInput type="url" aria-label="Discord Webhook URL" value={deliveryConfig.discord_webhook_url || ""} onChange={event => setDeliveryConfig(previous => ({ ...previous, discord_webhook_url: event.target.value }))} /></label> : null}
            {initialAlert?.id && onTestChannel ? <div className="space-y-2"><TerminalButton type="button" size="sm" onClick={() => void testDelivery()} loading={testing}>Test configured delivery</TerminalButton><p className="text-xs text-terminal-muted">Tests the saved rule. Save delivery changes before testing them.</p></div> : null}
          </section>
          <details className="rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Trigger limits and expiry</summary>
            <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
              <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Cooldown Minutes</span><TerminalInput aria-label="Cooldown Minutes" type="number" value={cooldownMinutes} onChange={event => setCooldownMinutes(Number(event.target.value))} /></label>
              <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Max Triggers</span><TerminalInput aria-label="Max Triggers" type="number" value={maxTriggers} onChange={event => setMaxTriggers(Number(event.target.value))} /></label>
              <label className="min-w-0 space-y-1 sm:col-span-2"><span className="block text-xs text-terminal-muted">Expiry Date</span><TerminalInput aria-label="Expiry Date" type="datetime-local" value={expiryDate} onChange={event => setExpiryDate(event.target.value)} /></label>
            </div>
            <p className="mt-2 text-xs text-terminal-muted">Optional limits are stored with the rule. Expiry uses your local time.</p>
          </details>
        </fieldset>
      </form>
    </TerminalModal>
  );
}
