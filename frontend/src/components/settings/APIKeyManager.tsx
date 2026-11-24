import { useEffect, useRef, useState } from "react";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalModal } from "../terminal/TerminalModal";
import { api } from "../../api/client";

interface APIKey {
  id: number;
  name: string;
  prefix: string;
  permissions: string;
  is_active: number;
  last_used_at: string | null;
  created_at: string;
}

export function APIKeyManager({ onBusyChange }: { onBusyChange?: (busy: boolean) => void } = {}) {
  const [keys, setKeys] = useState<APIKey[]>([]);
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<"read" | "read_write">("read");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [readError, setReadError] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [copyNotice, setCopyNotice] = useState("");
  const readVersion = useRef(0);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const focusFeedback = useRef(false);

  useEffect(() => { onBusyChange?.(busy || Boolean(generatedKey)); }, [busy, generatedKey, onBusyChange]);

  async function loadKeys() {
    const version = ++readVersion.current;
    setReading(true); setReadError(false);
    try {
      const res = await api.get("/settings/api-keys");
      if (version !== readVersion.current) return;
      setKeys(Array.isArray(res.data) ? res.data : []); setLoaded(true);
    } catch { if (version === readVersion.current) setReadError(true); }
    finally { if (version === readVersion.current) setReading(false); }
  }
  useEffect(() => { void loadKeys(); return () => { readVersion.current++; }; }, []);
  useEffect(() => { if (!generatedKey && focusFeedback.current) { focusFeedback.current = false; feedbackRef.current?.focus(); } }, [feedback, generatedKey]);

  async function createKey() {
    if (busy || !name.trim()) return;
    setBusy(true); setFeedback(null); setCopyNotice("");
    try {
      const res = await api.post("/settings/api-keys", { name: name.trim(), permissions });
      // Never put the one-time credential in a list, query cache or browser storage.
      const { key, ...metadata } = res.data;
      readVersion.current++;
      setKeys(previous => [metadata, ...previous.filter(row => row.id !== metadata.id)]);
      setLoaded(true); setGeneratedKey(key); setName("");
      setFeedback({ error: false, text: "API key created. The full key is shown once in the dialog." });
      void loadKeys();
    } catch { focusFeedback.current = true; setFeedback({ error: true, text: "Could not confirm key creation. Your draft is still here; refresh the key list before retrying manually." }); }
    finally { setBusy(false); }
  }
  async function revokeKey(id: number) {
    if (busy || !window.confirm("Are you sure you want to revoke this API key?")) return;
    setBusy(true); setFeedback(null);
    try {
      await api.delete(`/settings/api-keys/${id}`);
      readVersion.current++; setKeys(previous => previous.filter(row => row.id !== id));
      focusFeedback.current = true; setFeedback({ error: false, text: "API key revoked." });
      void loadKeys();
    } catch { focusFeedback.current = true; setFeedback({ error: true, text: "Could not confirm key revocation. Refresh the key list before retrying manually." }); }
    finally { setBusy(false); }
  }
  function closeKey() { focusFeedback.current = true; setGeneratedKey(null); setCopyNotice(""); }

  return <section aria-label="Automation API keys" className="min-w-0 space-y-3 rounded border border-terminal-border bg-terminal-panel p-3 [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-sm font-semibold">Automation API Keys</h2><p className="text-xs text-terminal-muted">Read-only market access or read access plus external-note ingestion.</p></div><TerminalButton size="sm" disabled={reading || busy} onClick={() => void loadKeys()}>Refresh keys</TerminalButton></div>
    <form aria-label="Create API key" className="grid min-w-0 items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={event => { event.preventDefault(); void createKey(); }}>
      <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Key name</span><TerminalInput required aria-label="Key name" className="!text-sm" value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="Daily research agent" /></label>
      <label className="min-w-0 space-y-1"><span className="block text-xs text-terminal-muted">Key permissions</span><TerminalInput as="select" aria-label="Key permissions" className="!text-sm" value={permissions} disabled={busy} onChange={event => setPermissions(event.target.value as "read" | "read_write")}><option value="read">Read only</option><option value="read_write">Read + external notes</option></TerminalInput></label>
      <TerminalButton type="submit" variant="accent" loading={busy} disabled={!name.trim()}>Generate New Key</TerminalButton>
    </form>
    {feedback ? <p ref={feedbackRef} tabIndex={-1} role={feedback.error ? "alert" : "status"} className={`text-sm ${feedback.error ? "text-terminal-neg" : "text-terminal-muted"}`}>{feedback.text}</p> : null}
    {reading ? <p role="status" className="text-sm text-terminal-muted">Loading API keys…</p> : null}
    {readError ? <p role="alert" className="text-sm text-terminal-neg">Could not refresh API keys. Any previous keys below have not been refreshed.</p> : null}
    {loaded && !reading && !readError && !keys.length ? <p className="text-sm text-terminal-muted">No API keys generated.</p> : null}
    <div className="grid min-w-0 gap-3 lg:grid-cols-2">{keys.map(row => <article key={row.id} aria-label={`${row.name} API key`} className="min-w-0 space-y-2 rounded border border-terminal-border bg-terminal-bg p-3">
      <h3 className="text-sm font-semibold">{row.name}</h3><p className="text-sm"><code>{row.prefix}…</code> · {row.permissions === "read_write" ? "Read + external notes" : "Read only"}</p>
      <p className="text-xs text-terminal-muted">Created {new Date(row.created_at).toLocaleDateString()} · Last used {row.last_used_at ? new Date(row.last_used_at).toLocaleString() : "Never"}</p>
      <TerminalButton size="sm" variant="danger" disabled={busy} onClick={() => void revokeKey(row.id)}>Revoke</TerminalButton>
    </article>)}</div>
    <TerminalModal open={Boolean(generatedKey)} onClose={closeKey} title="New API Key Generated" subtitle="Save this key now. It will not be shown again." footer={<TerminalButton variant="accent" onClick={closeKey}>I have saved it</TerminalButton>}>
      <div className="min-w-0 space-y-3"><code className="block whitespace-pre-wrap break-all rounded border border-terminal-border bg-terminal-bg p-3 text-sm" aria-label="Generated API key">{generatedKey}</code><TerminalButton onClick={async () => { try { await navigator.clipboard.writeText(generatedKey || ""); setCopyNotice("Key copied."); } catch { setCopyNotice("Could not copy. Select and save the key above before closing."); } }}>Copy</TerminalButton>{copyNotice ? <p role="status" className="text-sm text-terminal-muted">{copyNotice}</p> : null}</div>
    </TerminalModal>
  </section>;
}
