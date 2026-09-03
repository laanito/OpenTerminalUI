import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { fetchFeedHealth, fetchKillSwitches, fetchOpsDataQuality, type OpsDataQualityReport } from "../api/client";
import type { KillSwitch } from "../types";
import { DataQualityPanel } from "../components/ops/DataQualityPanel";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

export function OpsDashboardPage() {
  const [feed, setFeed] = useState<Record<string, unknown>>({});
  const [switches, setSwitches] = useState<KillSwitch[]>([]);
  const [dataQuality, setDataQuality] = useState<OpsDataQualityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [health, kill, quality] = await Promise.all([
        fetchFeedHealth(),
        fetchKillSwitches(),
        fetchOpsDataQuality(),
      ]);
      setFeed(health);
      setSwitches(kill);
      setDataQuality(quality);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load operational status.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-3 p-4 font-mono">
      <div className="flex items-center justify-between rounded border border-terminal-border bg-terminal-panel p-3">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wider text-terminal-accent">System Monitor</div>
          <div className="text-[10px] text-terminal-muted">
            Compatibility view of measured feed health and configured global stops. No execution controls are exposed here.
          </div>
        </div>
        <button
          className="flex items-center gap-2 rounded border border-terminal-border px-3 py-1 text-xs hover:bg-terminal-border/30"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          {loading ? "SYNCING..." : "SYNC STATE"}
        </button>
      </div>

      {error ? (
        <div className="rounded border border-terminal-neg/60 bg-terminal-neg/10 p-3 text-xs text-terminal-neg">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TerminalPanel title="FEED HEALTH" subtitle="Runtime measurements">
          <div className="space-y-1 p-1 text-[10px]">
            <Metric label="Kite Stream" value={feed.kite_stream_status} />
            <Metric label="US Primary Provider" value={feed.us_primary_provider} />
            <Metric label="WS Clients" value={feed.ws_connected_clients} />
            <Metric label="WS Subscriptions" value={feed.ws_subscriptions} />
            <Metric label="Measured At" value={feed.timestamp} />
          </div>
        </TerminalPanel>

        <TerminalPanel title="GLOBAL KILL SWITCHES" subtitle="Read-only; administrator API controls changes">
          <div className="space-y-2 p-1">
            {!loading && switches.length === 0 ? (
              <div className="p-2 text-xs italic text-terminal-dim">No global kill switches are configured.</div>
            ) : null}
            {switches.map((item) => (
              <div key={item.id} className="border-b border-terminal-border/20 py-2 text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="font-bold uppercase text-terminal-accent">{item.scope}</span>
                  <span className={item.enabled ? "text-terminal-neg" : "text-terminal-pos"}>
                    {item.enabled ? "HALTED" : "OPERATIONAL"}
                  </span>
                </div>
                <div className="text-terminal-muted">{item.reason || "No reason recorded."}</div>
              </div>
            ))}
          </div>
        </TerminalPanel>
      </div>

      <DataQualityPanel report={dataQuality} loading={loading} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: unknown }) {
  const display = value === null || value === undefined || value === "" ? "UNKNOWN" : String(value);
  return (
    <div className="flex justify-between gap-3 border-b border-terminal-border/20 pb-1">
      <span className="text-terminal-muted">{label}</span>
      <span className="break-all text-right text-terminal-text">{display}</span>
    </div>
  );
}
