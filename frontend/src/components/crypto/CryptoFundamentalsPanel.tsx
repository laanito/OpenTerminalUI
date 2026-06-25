import { useQuery } from "@tanstack/react-query";

import { fetchCryptoFundamentals } from "../../api/crypto";
import { useDisplayCurrency } from "../../hooks/useDisplayCurrency";

type Tone = "neutral" | "good" | "warn";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "text-terminal-text",
  good: "text-terminal-pos",
  warn: "text-terminal-neg",
};

function MetricCard({ label, value, note, tone = "neutral" }: { label: string; value: string; note: string; tone?: Tone }) {
  return (
    <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-terminal-muted">{label}</div>
      <div className={`mt-1 text-sm font-semibold tabular-nums ${TONE_CLASS[tone]}`}>{value}</div>
      <div className="mt-1 text-[11px] leading-snug text-terminal-muted">{note}</div>
    </div>
  );
}

function fmtNum(value: number | null, suffix = ""): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}${suffix}`;
}

function fmtRatio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}×`;
}

export function CryptoFundamentalsPanel({ symbol }: { symbol: string }) {
  // Crypto is quoted in USD upstream; formatCompactMoney converts to the display currency.
  const { formatCompactMoney } = useDisplayCurrency();
  const money = (v: number | null) => (v === null || !Number.isFinite(v) ? "-" : formatCompactMoney(v, "USD"));

  const { data, isLoading, error } = useQuery({
    queryKey: ["crypto-fundamentals", symbol],
    queryFn: () => fetchCryptoFundamentals(symbol),
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  if (isLoading) {
    return <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs text-terminal-muted">Loading fundamentals…</div>;
  }
  if (error || !data) {
    return <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs text-terminal-muted">Fundamentals are unavailable for this asset.</div>;
  }

  const { tokenomics: tk, valuation: val, onchain: oc } = data;

  // Heuristic "don't get fooled" tones. Deliberately conservative — these are
  // flags to investigate, not verdicts.
  const circTone: Tone = tk.circulating_pct === null ? "neutral" : tk.circulating_pct < 50 ? "warn" : tk.circulating_pct >= 90 ? "good" : "neutral";
  const fdvTone: Tone = val.fdv_mcap_ratio === null ? "neutral" : val.fdv_mcap_ratio >= 2 ? "warn" : val.fdv_mcap_ratio <= 1.1 ? "good" : "neutral";

  return (
    <div className="space-y-3">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Fundamentals</div>
        <p className="mt-1 text-[11px] leading-snug text-terminal-muted">
          Is the price backed by real supply discipline and on-chain usage — or just a story? Tokenomics come from CoinGecko; on-chain value and
          fee revenue from DefiLlama.
        </p>
      </div>

      {/* Tokenomics */}
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-terminal-muted">Tokenomics</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Circulating Supply"
            value={fmtNum(tk.circulating_supply)}
            note="Tokens in the market right now."
          />
          <MetricCard
            label="Max Supply"
            value={tk.max_supply === null ? "Uncapped" : fmtNum(tk.max_supply)}
            note={tk.max_supply === null ? "No hard cap — supply can keep growing." : "The hard ceiling on total tokens."}
          />
          <MetricCard
            label="% Circulating"
            value={tk.circulating_pct === null ? "-" : fmtNum(tk.circulating_pct, "%")}
            note="Low % means a lot of supply is still to be released (future dilution)."
            tone={circTone}
          />
          <MetricCard
            label="Total Supply"
            value={fmtNum(tk.total_supply)}
            note="Minted so far, incl. locked/reserved."
          />
        </div>
      </div>

      {/* Valuation */}
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-terminal-muted">Valuation</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Market Cap" value={money(val.market_cap)} note="Price × circulating supply." />
          <MetricCard label="Fully Diluted Val." value={money(val.fully_diluted_valuation)} note="Price × max supply — the valuation if every token existed." />
          <MetricCard
            label="FDV / Market Cap"
            value={fmtRatio(val.fdv_mcap_ratio)}
            note="Above ~2× means most supply hasn't hit the market yet — heavy dilution risk."
            tone={fdvTone}
          />
          <MetricCard
            label="Market Cap / TVL"
            value={fmtRatio(val.mcap_tvl_ratio)}
            note="How richly the token is priced vs the value locked in its protocol. Lower = cheaper vs usage."
          />
          <MetricCard
            label="Price / Fees (annual)"
            value={fmtRatio(val.price_to_fees_ratio)}
            note="Like a P/E for protocols: market cap vs annualised fee revenue."
          />
          <MetricCard
            label="From All-Time High"
            value={val.ath_change_pct === null ? "-" : fmtNum(val.ath_change_pct, "%")}
            note={`ATH ${money(val.ath)}. How far price sits below its peak.`}
            tone="neutral"
          />
        </div>
      </div>

      {/* On-chain usage */}
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-terminal-muted">On-chain Usage</div>
          {oc.category ? <span className="rounded border border-terminal-border bg-terminal-bg px-2 py-0.5 text-[10px] text-terminal-muted">{oc.category}</span> : null}
        </div>
        {oc.tracked ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard label="Total Value Locked" value={money(oc.tvl)} note="Capital deposited in the protocol — real skin in the game." />
            <MetricCard label="Fees (24h)" value={money(oc.fees_24h)} note="What users paid to use it yesterday." />
            <MetricCard label="Fees (annualised)" value={money(oc.fees_annualized)} note="Run-rate revenue the protocol actually earns." />
          </div>
        ) : (
          <p className="text-[11px] leading-snug text-terminal-muted">
            DefiLlama doesn't track on-chain protocol data for this asset (common for base-layer coins and tokens without a DeFi protocol). Tokenomics
            and valuation above still apply.
          </p>
        )}
        {oc.tracked && oc.chains && oc.chains.length > 0 ? (
          <div className="mt-2 text-[11px] text-terminal-muted">Chains: {oc.chains.slice(0, 8).join(", ")}{oc.chains.length > 8 ? "…" : ""}</div>
        ) : null}
      </div>

      <p className="text-[10px] leading-snug text-terminal-muted">
        Sources: {data.sources.join(" + ")}. Heuristic colour cues flag things worth investigating, not verdicts. A precise token unlock/vesting
        calendar needs a paid data source and isn't shown — FDV/Market Cap and % circulating are the free proxies for dilution risk.
      </p>
    </div>
  );
}
