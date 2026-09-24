import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { compareMarketContext, type MarketContextPeriod, type MarketComparisonRow } from "../api/marketContext";
import { extractApiErrorMessage } from "../api/base";
import { SymbolSuggestions } from "../components/market/SymbolSuggestions";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

const SYMBOL_PATTERN = /^[A-Z0-9^._=-]{1,40}$/;
const PERIODS: MarketContextPeriod[] = ["1M", "3M", "6M"];
const PROXY_SUGGESTIONS = [
  { symbol: "SPY", label: "US broad market" },
  { symbol: "QQQ", label: "US tech" },
  { symbol: "^FTSE", label: "UK index" },
  { symbol: "^GDAXI", label: "German index" },
  { symbol: "BTC-USD", label: "Bitcoin" },
  { symbol: "ETH-USD", label: "Ethereum" },
] as const;

function defaultProxies(anchor: string): string[] {
  return ["SPY", "BTC-USD", "QQQ"].filter((symbol) => symbol !== anchor).slice(0, 2);
}

function parseSelection(anchorRaw: string, proxiesRaw: string): { anchor: string; comparisons: string[]; error: string | null } {
  const anchor = anchorRaw.trim().toUpperCase();
  const comparisons = [...new Set(proxiesRaw.split(",").map((part) => part.trim().toUpperCase()).filter(Boolean))];
  if (!SYMBOL_PATTERN.test(anchor)) return { anchor, comparisons, error: "Enter one valid anchor symbol." };
  if (comparisons.length < 1 || comparisons.length > 6) {
    return { anchor, comparisons, error: "Choose between one and six comparison symbols." };
  }
  if (comparisons.includes(anchor)) return { anchor, comparisons, error: "The anchor cannot also be a comparison symbol." };
  if (comparisons.some((symbol) => !SYMBOL_PATTERN.test(symbol))) {
    return { anchor, comparisons, error: "One or more comparison symbols are invalid." };
  }
  return { anchor, comparisons, error: null };
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPoints(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)} pp`;
}

function unavailableReason(row: MarketComparisonRow): string {
  if (row.reason === "provider_error") return "History provider failed; no comparison was calculated.";
  if (row.reason === "insufficient_overlap") return "Not enough shared daily closes for this window.";
  return "No usable daily history for this comparison.";
}

export function MarketContextPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const appliedAnchor = (searchParams.get("symbol") || "AAPL").trim().toUpperCase();
  const appliedProxies = searchParams.get("proxies") || defaultProxies(appliedAnchor).join(",");
  const rawPeriod = searchParams.get("period") || "1M";
  const appliedPeriod: MarketContextPeriod = PERIODS.includes(rawPeriod as MarketContextPeriod)
    ? (rawPeriod as MarketContextPeriod)
    : "1M";
  const [anchorInput, setAnchorInput] = useState(appliedAnchor);
  const [proxiesInput, setProxiesInput] = useState(appliedProxies);
  const [periodInput, setPeriodInput] = useState<MarketContextPeriod>(appliedPeriod);
  const [proxyLookup, setProxyLookup] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const selectedProxies = useMemo(
    () => [...new Set(proxiesInput.split(",").map((part) => part.trim().toUpperCase()).filter(Boolean))],
    [proxiesInput],
  );

  useEffect(() => {
    setAnchorInput(appliedAnchor);
    setProxiesInput(appliedProxies);
    setPeriodInput(appliedPeriod);
    setFormError(null);
  }, [appliedAnchor, appliedProxies, appliedPeriod]);

  const selection = useMemo(
    () => parseSelection(appliedAnchor, appliedProxies),
    [appliedAnchor, appliedProxies],
  );
  const query = useQuery({
    queryKey: ["market-context", selection.anchor, selection.comparisons, appliedPeriod],
    queryFn: () => compareMarketContext(selection.anchor, selection.comparisons, appliedPeriod),
    enabled: !selection.error,
    staleTime: 5 * 60_000,
    retry: false,
  });

  function applySelection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = parseSelection(anchorInput, proxiesInput);
    if (next.error) {
      setFormError(next.error);
      return;
    }
    setFormError(null);
    setSearchParams({ symbol: next.anchor, proxies: next.comparisons.join(","), period: periodInput });
  }

  function addProxy(symbol: string) {
    const normalized = symbol.trim().toUpperCase();
    if (normalized === anchorInput.trim().toUpperCase()) {
      setFormError("The anchor cannot also be a comparison symbol.");
      return;
    }
    if (selectedProxies.includes(normalized)) return;
    if (selectedProxies.length >= 6) {
      setFormError("Choose no more than six comparison symbols.");
      return;
    }
    setProxiesInput([...selectedProxies, normalized].join(", "));
    setProxyLookup("");
    setFormError(null);
  }

  function removeProxy(symbol: string) {
    setProxiesInput(selectedProxies.filter((item) => item !== symbol).join(", "));
    setFormError(null);
  }

  return (
    <div className="h-full min-h-0 space-y-3 overflow-auto p-3">
      <div>
        <h1 className="ot-type-heading-lg text-terminal-text">Cross-market context</h1>
        <p className="mt-1 text-sm text-terminal-muted">
          Experimental price context: each asset/proxy pair uses its own shared observation dates. Co-movement is not causation.
        </p>
      </div>

      <TerminalPanel title="Select evidence" subtitle="One anchor · up to six comparison symbols">
        <form onSubmit={applySelection} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[130px] flex-1">
            <SymbolSuggestions
              label="Anchor symbol"
              value={anchorInput}
              onChange={setAnchorInput}
              onPick={setAnchorInput}
              placeholder="AAPL, SAP.DE, BTC-USD…"
            />
          </div>
          <label className="min-w-[220px] flex-[2] text-xs text-terminal-muted">
            Comparison symbols (comma separated)
            <input
              value={proxiesInput}
              onChange={(event) => setProxiesInput(event.target.value.toUpperCase())}
              className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-sm text-terminal-text"
              aria-label="Comparison symbols"
            />
          </label>
          <label className="text-xs text-terminal-muted">
            Window
            <select
              value={periodInput}
              onChange={(event) => setPeriodInput(event.target.value as MarketContextPeriod)}
              className="mt-1 block rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-sm text-terminal-text"
              aria-label="Window"
            >
              {PERIODS.map((period) => <option key={period} value={period}>{period}</option>)}
            </select>
          </label>
          <button type="submit" className="rounded border border-terminal-accent bg-terminal-accent/10 px-3 py-2 text-sm text-terminal-accent">
            Compare dated moves
          </button>
        </form>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <SymbolSuggestions
            label="Find a proxy to add"
            value={proxyLookup}
            onChange={setProxyLookup}
            onPick={addProxy}
            exclude={[anchorInput, ...selectedProxies]}
            placeholder="Search US, EU, or crypto symbols"
          />
          <div>
            <p className="text-xs text-terminal-muted">Suggested proxies</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {PROXY_SUGGESTIONS.filter(({ symbol }) => symbol !== anchorInput.trim().toUpperCase()).map(({ symbol, label }) => {
                const added = selectedProxies.includes(symbol);
                return (
                  <button
                    key={symbol}
                    type="button"
                    onClick={() => added ? removeProxy(symbol) : addProxy(symbol)}
                    className={`rounded border px-2 py-1 text-xs ${added ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent" : "border-terminal-border text-terminal-text hover:border-terminal-accent"}`}
                    aria-label={`${added ? "Remove" : "Add"} ${symbol}`}
                    title={label}
                  >
                    {added ? "✓ " : "+ "}{symbol} <span className="text-terminal-muted">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-terminal-muted">Suggestions identify symbols; daily-history availability is checked when you compare.</p>
        {formError || selection.error ? <p role="alert" className="mt-2 text-xs text-terminal-neg">{formError || selection.error}</p> : null}
      </TerminalPanel>

      <TerminalPanel title="Observed comparison" subtitle={`${selection.anchor} · ${appliedPeriod} requested window`}>
        <p className="mb-3 text-xs text-terminal-muted">
          Daily closes are paired only when both symbols have an observation on the same UTC date. Returns are in each
          symbol’s native quote currency, not FX-normalized. The underlying history provider is not identified by this API.
        </p>
        {query.isPending && !selection.error ? <p role="status" className="text-sm text-terminal-muted">Loading dated market history…</p> : null}
        {query.isError ? (
          <div role="alert" className="text-sm text-terminal-neg">
            {extractApiErrorMessage(query.error, "Could not load cross-market context.")}
            <button type="button" className="ml-3 underline" onClick={() => void query.refetch()}>Retry</button>
          </div>
        ) : null}
        {query.data ? (
          <div className="space-y-2">
            <p className="text-xs text-terminal-muted">Requested {query.data.period}; retrieved {new Date(query.data.retrieved_at).toLocaleString()}.</p>
            {query.data.comparisons.map((row) => (
              <div key={row.symbol} className="rounded border border-terminal-border bg-terminal-bg p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-terminal-text">{selection.anchor} vs {row.symbol}</h2>
                  <span className={`text-xs ${row.status === "unavailable" || row.freshness === "stale" ? "text-terminal-warn" : "text-terminal-pos"}`}>
                    {row.status === "unavailable" ? "Unavailable" : row.freshness === "stale" ? "Stale history" : "Current history"}
                  </span>
                </div>
                {row.status === "available" ? (
                  <>
                    <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                      <div><span className="text-terminal-muted">{selection.anchor}:</span> <span>{formatPercent(row.anchor_return_pct)}</span></div>
                      <div><span className="text-terminal-muted">{row.symbol}:</span> <span>{formatPercent(row.comparison_return_pct)}</span></div>
                      <div><span className="text-terminal-muted">Return difference:</span> <span>{formatPoints(row.relative_return_pp)}</span></div>
                    </div>
                    <p className="mt-2 text-xs text-terminal-muted">
                      Shared closes: {row.start_date} to {row.end_date} · {row.observations} observations.
                      Latest source dates: {selection.anchor} {row.anchor_latest_date}, {row.symbol} {row.comparison_latest_date}.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-terminal-muted">{unavailableReason(row)} Latest dates: {selection.anchor} {row.anchor_latest_date || "unknown"}, {row.symbol} {row.comparison_latest_date || "unknown"}.</p>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </TerminalPanel>
    </div>
  );
}
