import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { captureMarketFundamentals, compareMarketContext, compareMarketFundamentalCaptures, fetchMarketContextFundamentalReleases, fetchMarketContextHeadlines, fetchMarketContextMacroEvents, getMarketFundamentalCapture, listMarketFundamentalCaptures, type MarketContextPeriod, type MarketComparisonRow } from "../api/marketContext";
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

function sourceLabel(source: string | null): string {
  const labels: Record<string, string> = {
    yahoo: "Yahoo Finance",
    fmp: "FMP",
    alpaca: "Alpaca",
    kite: "Kite",
    crypto: "Crypto adapter",
    us_options: "US options adapter",
  };
  return source ? (labels[source] || source) : "Not identified";
}

function historyPathLabel(source: string | null, feed: string | null | undefined): string {
  if (!feed) return sourceLabel(source);
  const feedLabel = feed === "yahoo_chart" ? "Yahoo chart" : feed === "fmp_historical_price" ? "FMP historical prices" : feed;
  return `${sourceLabel(source)} → ${feedLabel}`;
}

function unavailableReason(row: MarketComparisonRow): string {
  if (row.reason === "provider_error") return "History provider failed; no comparison was calculated.";
  if (row.reason === "insufficient_overlap") return "Not enough shared daily closes for this window.";
  return "No usable daily history for this comparison.";
}

function AlignedPaths({ anchor, row }: { anchor: string; row: MarketComparisonRow }) {
  const [open, setOpen] = useState(false);
  if (!row.points || row.points.length < 2) return null;

  return (
    <div className="mt-3 border-t border-terminal-border pt-3">
      <button type="button" className="text-xs text-terminal-accent underline" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? "Hide" : "Show"} aligned price paths for {anchor} vs {row.symbol}
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-terminal-muted">
            Both paths start at 100 on the first shared close. Only observed shared UTC dates are plotted; no dates are filled in.
            Values remain in each symbol’s native quote currency, not FX-normalized. Timing alone does not show causation.
          </p>
          <div className="h-56 w-full" role="img" aria-label={`Indexed daily-close paths for ${anchor} and ${row.symbol} from ${row.start_date} to ${row.end_date}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={row.points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                <XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5)} stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={10} minTickGap={25} />
                <YAxis stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={10} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", fontSize: "11px" }} formatter={(value) => typeof value === "number" ? value.toFixed(2) : value} />
                <Line type="linear" dataKey="anchor_index" name={anchor} stroke="var(--ot-color-accent-primary)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
                <Line type="linear" dataKey="comparison_index" name={row.symbol} stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-terminal-muted">{anchor}: accent line · {row.symbol}: amber line · {row.points.length} shared closes.</p>
          <details className="text-xs text-terminal-muted">
            <summary className="cursor-pointer text-terminal-accent">View exact aligned observations</summary>
            <div className="mt-2 max-h-56 overflow-auto">
              <table className="w-full text-left">
                <thead><tr><th className="py-1 pr-3">UTC date</th><th className="py-1 pr-3">{anchor} index</th><th className="py-1">{row.symbol} index</th></tr></thead>
                <tbody>{row.points.map((point) => (
                  <tr key={point.date}><td className="py-0.5 pr-3">{point.date}</td><td className="py-0.5 pr-3">{point.anchor_index.toFixed(2)}</td><td className="py-0.5">{point.comparison_index.toFixed(2)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}

function TechnicalObservations({ anchor, row }: { anchor: string; row: MarketComparisonRow }) {
  const [open, setOpen] = useState(false);
  const technical = row.technical_observations;
  if (!technical) return null;

  return (
    <div className="mt-3 border-t border-terminal-border pt-3">
      <button type="button" className="text-xs text-terminal-accent underline" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? "Hide" : "Show"} observed technical measures for {anchor} vs {row.symbol}
      </button>
      {open ? (
        <div className="mt-2 space-y-2 text-xs">
          <p className="text-terminal-muted">
            As of {technical.as_of_date}. Calculated only from the pair’s shared, unadjusted daily closes—no missing dates filled in.
            Crypto weekend closes are omitted when the other asset has no close. Splits and other corporate actions can distort unadjusted prices.
            These are descriptive observations, not trading signals or causes of price moves.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {([{ symbol: anchor, measures: technical.anchor }, { symbol: row.symbol, measures: technical.comparison }]).map(({ symbol, measures }) => (
              <div key={symbol} className="rounded border border-terminal-border p-2 text-terminal-text">
                <h3 className="font-semibold">{symbol}</h3>
                <p className="mt-1">Maximum observed drawdown: {measures.max_drawdown_pct.toFixed(2)}%</p>
                <p className="text-terminal-muted">
                  {measures.max_drawdown_peak_date && measures.max_drawdown_trough_date
                    ? `Peak ${measures.max_drawdown_peak_date} → trough ${measures.max_drawdown_trough_date}`
                    : "No decline from an earlier shared-date peak."}
                </p>
                <p className="mt-1">
                  20-shared-close average gap: {measures.sma20_gap_pct == null ? "Unavailable (fewer than 20 shared closes)" : formatPercent(measures.sma20_gap_pct)}
                </p>
              </div>
            ))}
          </div>
          {row.native_technical_observations ? (
            <div className="border-t border-terminal-border pt-2">
              <h3 className="font-semibold text-terminal-text">Each asset’s own dated closes</h3>
              <p className="mt-1 text-terminal-muted">
                Same observed pair window, but each asset uses all of its own available UTC close dates. Extra dates—such as crypto weekends—are included here, not in the paired comparison above. These unadjusted, provider-dated observations are not verified exchange-session indicators or trading signals.
              </p>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                {([
                  { symbol: anchor, native: row.native_technical_observations.anchor },
                  { symbol: row.symbol, native: row.native_technical_observations.comparison },
                ]).map(({ symbol, native }) => (
                  <div key={symbol} className="rounded border border-terminal-border p-2 text-terminal-text">
                    <h4 className="font-semibold">{symbol} own-date measures</h4>
                    <p className="mt-1 text-terminal-muted">
                      {native.observations} closes, {native.start_date} to {native.end_date} · {native.additional_dates_vs_pair} dates beyond pair overlap
                    </p>
                    <p className="mt-1">Maximum observed drawdown: {native.technical_measures.max_drawdown_pct.toFixed(2)}%</p>
                    <p className="text-terminal-muted">
                      {native.technical_measures.max_drawdown_peak_date && native.technical_measures.max_drawdown_trough_date
                        ? `Peak ${native.technical_measures.max_drawdown_peak_date} → trough ${native.technical_measures.max_drawdown_trough_date}`
                        : "No decline from an earlier own-date peak."}
                    </p>
                    <p className="mt-1">
                      20-own-close average gap: {native.technical_measures.sma20_gap_pct == null ? "Unavailable (fewer than 20 own closes)" : formatPercent(native.technical_measures.sma20_gap_pct)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {row.adjusted_close_coverage ? (
            <div className="border-t border-terminal-border pt-2">
              <p className="text-terminal-muted">
                Provider-adjusted close coverage on these shared dates. This is a current, retrospective Yahoo series—not a historical vintage or verification of every corporate action. The primary chart, returns, and measures above still use unadjusted closes.
              </p>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                {([
                  { symbol: anchor, coverage: row.adjusted_close_coverage.anchor },
                  { symbol: row.symbol, coverage: row.adjusted_close_coverage.comparison },
                ]).map(({ symbol, coverage }) => (
                  <p key={symbol} className="rounded border border-terminal-border p-2 text-terminal-text">
                    {symbol}: {coverage.status === "unavailable"
                      ? "No usable provider-adjusted closes in this response."
                      : `${coverage.status} · ${coverage.available_observations}/${coverage.shared_observations} shared closes from Yahoo adjclose.`}
                  </p>
                ))}
              </div>
              {row.adjusted_observations ? (
                <div className="mt-3">
                  <p className="text-terminal-muted">
                    Separate Yahoo-adjusted observations as of {row.adjusted_observations.as_of_date}. Calculated only when an asset has adjusted closes on every pair-shared date; a missing date never gets filled or silently changes the window. These are descriptive, not verified trading signals.
                  </p>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    {([
                      { symbol: anchor, observations: row.adjusted_observations.anchor },
                      { symbol: row.symbol, observations: row.adjusted_observations.comparison },
                    ]).map(({ symbol, observations }) => (
                      <div key={symbol} className="rounded border border-terminal-border p-2 text-terminal-text">
                        <h4 className="font-semibold">{symbol} adjusted observations</h4>
                        {observations ? (
                          <>
                            <p className="mt-1">Adjusted return: {formatPercent(observations.return_pct)}</p>
                            <p>Maximum observed drawdown: {observations.technical_measures.max_drawdown_pct.toFixed(2)}%</p>
                            <p className="text-terminal-muted">
                              {observations.technical_measures.max_drawdown_peak_date && observations.technical_measures.max_drawdown_trough_date
                                ? `Peak ${observations.technical_measures.max_drawdown_peak_date} → trough ${observations.technical_measures.max_drawdown_trough_date}`
                                : "No decline from an earlier shared-date peak."}
                            </p>
                            <p>20-shared-close average gap: {observations.technical_measures.sma20_gap_pct == null ? "Unavailable (fewer than 20 shared closes)" : formatPercent(observations.technical_measures.sma20_gap_pct)}</p>
                          </>
                        ) : <p className="mt-1 text-terminal-muted">Unavailable without complete Yahoo-adjusted coverage.</p>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {row.action_disclosure ? (
            <div className="border-t border-terminal-border pt-2">
              <p className="text-terminal-muted">
                Corporate-action markers reported by the selected Yahoo chart response within this window. These are not a complete action audit and the prices above remain unadjusted.
              </p>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                {([
                  { symbol: anchor, disclosure: row.action_disclosure.anchor },
                  { symbol: row.symbol, disclosure: row.action_disclosure.comparison },
                ]).map(({ symbol, disclosure }) => (
                  <div key={symbol} className="rounded border border-terminal-border p-2">
                    <h4 className="font-semibold text-terminal-text">{symbol} action markers</h4>
                    {disclosure.source === "unavailable" ? (
                      <p className="mt-1 text-terminal-muted">Action metadata unavailable from the selected history path.</p>
                    ) : disclosure.matched_count === 0 ? (
                      <p className="mt-1 text-terminal-muted">No actions reported in this response; completeness is not verified.</p>
                    ) : (
                      <>
                        <p className="mt-1 text-terminal-muted">{disclosure.matched_count} reported; showing up to {disclosure.display_limit}.</p>
                        <ul className="mt-1 space-y-1 text-terminal-text">
                          {disclosure.actions.map((action) => <li key={`${action.date}-${action.type}`}>{action.date} · {action.type}</li>)}
                        </ul>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DatedHeadlines({ anchor, row }: { anchor: string; row: MarketComparisonRow }) {
  const [open, setOpen] = useState(false);
  const startDate = row.start_date || "";
  const endDate = row.end_date || "";
  const query = useQuery({
    queryKey: ["market-context-headlines", anchor, row.symbol, startDate, endDate],
    queryFn: () => fetchMarketContextHeadlines(anchor, row.symbol, startDate, endDate),
    enabled: open && !!startDate && !!endDate,
    staleTime: 5 * 60_000,
    retry: false,
  });

  return (
    <div className="mt-3 border-t border-terminal-border pt-3">
      <button
        type="button"
        className="text-xs text-terminal-accent underline"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? "Hide" : "Show"} dated headlines for {anchor} vs {row.symbol}
      </button>
      {open ? (
        <div className="mt-2 space-y-2 text-xs">
          <p className="text-terminal-muted">
            Possible context, not a cause of these moves. This searches only the current keyless feeds; results are neither a complete archive nor independently verified publication dates.
          </p>
          {query.isPending ? <p role="status" className="text-terminal-muted">Checking current headline feeds…</p> : null}
          {query.isError ? (
            <p role="alert" className="text-terminal-neg">
              {extractApiErrorMessage(query.error, "Could not check headline feeds.")}
              <button type="button" className="ml-2 underline" onClick={() => void query.refetch()}>Retry headlines</button>
            </p>
          ) : null}
          {query.data ? (
            <>
              <p className="text-terminal-muted">
                Checked {new Date(query.data.retrieved_at).toLocaleString()} · up to {query.data.fetch_limit_per_symbol} recent candidates per symbol, showing at most {query.data.display_limit_per_symbol} matches each.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {query.data.groups.map((group) => (
                  <div key={group.symbol} className="rounded border border-terminal-border p-2">
                    <h3 className="font-semibold text-terminal-text">{group.symbol}</h3>
                    {group.status === "feed_error" ? (
                      <p className="mt-1 text-terminal-warn">Feed unavailable; headlines could not be checked.</p>
                    ) : (
                      <>
                        <p className="mt-1 text-terminal-muted">{group.matched_count} dated matches among {group.examined_count} recent candidates.</p>
                        {group.headlines.length === 0 ? <p className="mt-1 text-terminal-muted">No matches in this limited feed; this does not mean no news occurred.</p> : null}
                        <ul className="mt-2 space-y-2">
                          {group.headlines.map((headline) => (
                            <li key={headline.url}>
                              <a href={headline.url} target="_blank" rel="noopener noreferrer" className="text-terminal-accent underline">{headline.title}</a>
                              <p className="text-terminal-muted">{headline.source} · {new Date(headline.published_at).toLocaleString()}</p>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DatedMacroEvents({ anchor, row }: { anchor: string; row: MarketComparisonRow }) {
  const [open, setOpen] = useState(false);
  const startDate = row.start_date || "";
  const endDate = row.end_date || "";
  const query = useQuery({
    queryKey: ["market-context-macro-events", startDate, endDate],
    queryFn: () => fetchMarketContextMacroEvents(startDate, endDate),
    enabled: open && !!startDate && !!endDate,
    staleTime: 5 * 60_000,
    retry: false,
  });

  return (
    <div className="mt-3 border-t border-terminal-border pt-3">
      <button type="button" className="text-xs text-terminal-accent underline" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} economic calendar events for ${anchor} vs ${row.symbol}`}>
        {open ? "Hide" : "Show"} economic calendar events for {row.start_date} to {row.end_date}
      </button>
      {open ? (
        <div className="mt-2 space-y-2 text-xs">
          <p className="text-terminal-muted">
            Global calendar context, not events attributed to either asset or proof of what moved prices. Only configured live Finnhub or FMP data is used; historical coverage may be incomplete.
          </p>
          {query.isPending ? <p role="status" className="text-terminal-muted">Checking live economic calendar…</p> : null}
          {query.isError ? (
            <p role="alert" className="text-terminal-neg">
              {extractApiErrorMessage(query.error, "Could not check economic calendar.")}
              <button type="button" className="ml-2 underline" onClick={() => void query.refetch()}>Retry events</button>
            </p>
          ) : null}
          {query.data?.status === "unavailable" ? (
            <p className="text-terminal-warn">
              {query.data.reason === "missing_api_key"
                ? "Live calendar unavailable: configure FINNHUB_API_KEY or FMP_API_KEY. No sample events are shown here."
                : "The configured calendar providers failed. No sample events are shown here."}
            </p>
          ) : null}
          {query.data?.status === "available" ? (
            <>
              <p className="text-terminal-muted">
                {query.data.source === "finnhub" ? "Finnhub" : "FMP"} · checked {new Date(query.data.retrieved_at).toLocaleString()} · showing up to {query.data.display_limit} of {query.data.matched_count} returned events.
              </p>
              {query.data.events.length === 0 ? <p className="text-terminal-muted">No events returned for this window; this does not establish that none occurred.</p> : null}
              <ul className="space-y-1">
                {query.data.events.map((event, index) => (
                  <li key={`${event.date}-${event.event_name}-${index}`} className="rounded border border-terminal-border p-2 text-terminal-text">
                    {event.date} · {event.country || "Region unspecified"} · {event.event_name}
                    <span className="ml-2 text-terminal-muted">Impact: {event.impact}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const FUNDAMENTAL_LABELS: Record<string, string> = {
  revenue: "Revenue",
  net_income: "Net income",
  eps: "EPS",
  free_cash_flow: "Free cash flow",
};

function FundamentalCaptureReview({ symbol }: { symbol: string }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<{ fromId: string; toId: string } | null>(null);
  const listKey = ["market-fundamental-captures", symbol];
  const captures = useQuery({
    queryKey: listKey,
    queryFn: () => listMarketFundamentalCaptures(symbol),
    retry: false,
  });
  const detail = useQuery({
    queryKey: ["market-fundamental-capture", selectedId],
    queryFn: () => getMarketFundamentalCapture(selectedId!),
    enabled: selectedId !== null,
    retry: false,
  });
  const delta = useQuery({
    queryKey: ["market-fundamental-observed-delta", comparison?.fromId, comparison?.toId],
    queryFn: () => compareMarketFundamentalCaptures(comparison!.fromId, comparison!.toId),
    enabled: comparison !== null,
    retry: false,
  });
  const capture = useMutation({
    mutationFn: () => captureMarketFundamentals(symbol),
    onSuccess: (result) => {
      queryClient.setQueryData(["market-fundamental-capture", result.id], result);
      setSelectedId(result.id);
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });

  return (
    <div className="mt-3 border-t border-terminal-border pt-3">
      <p className="text-terminal-muted">
        Save a new observation for {symbol} only when you choose to. This fetches current provider data across all eligible dates, not just this pair’s window; it does not save the panel above. The saved UTC time says when this terminal saw the values, not when the market first knew them.
      </p>
      <button type="button" className="mt-2 rounded border border-terminal-accent px-2 py-1 text-terminal-accent disabled:opacity-50" disabled={capture.isPending} onClick={() => capture.mutate()}>
        {capture.isPending ? `Capturing ${symbol}…` : `Capture current fundamentals for ${symbol}`}
      </button>
      {capture.isError ? <p role="alert" className="mt-2 text-terminal-neg">{extractApiErrorMessage(capture.error, "Could not save the capture.")}</p> : null}
      {captures.isPending ? <p role="status" className="mt-2 text-terminal-muted">Loading saved observations for {symbol}…</p> : null}
      {captures.isError ? (
        <p role="alert" className="mt-2 text-terminal-neg">
          {extractApiErrorMessage(captures.error, "Could not load saved observations.")}
          <button type="button" className="ml-2 underline" onClick={() => void captures.refetch()}>Retry saved observations</button>
        </p>
      ) : null}
      {captures.data ? (
        <div className="mt-3">
          <h4 className="font-semibold text-terminal-text">Saved observations for {symbol}</h4>
          {captures.data.length === 0 ? <p className="mt-1 text-terminal-muted">None saved yet.</p> : (
            <>
              <p className="mt-1 text-terminal-muted">Showing the latest {captures.data.length} captures (up to 20).</p>
              <ul className="mt-2 max-h-32 space-y-1 overflow-auto">
                {captures.data.map((item, index) => (
                  <li key={item.id}>
                    <button type="button" className="text-left text-terminal-accent underline" aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)}>
                      Review {symbol} capture from {new Date(item.captured_at).toLocaleString()} · {item.record_count} records · {item.status.replace(/_/g, " ")}
                    </button>
                    {index + 1 < captures.data.length ? (
                      <button
                        type="button"
                        className="ml-2 text-terminal-accent underline"
                        onClick={() => setComparison({ fromId: captures.data[index + 1].id, toId: item.id })}
                      >
                        Compare {symbol} capture from {new Date(item.captured_at).toLocaleString()} with previous
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
      {selectedId && detail.isPending ? <p role="status" className="mt-2 text-terminal-muted">Loading saved capture…</p> : null}
      {selectedId && detail.isError ? <p role="alert" className="mt-2 text-terminal-neg">{extractApiErrorMessage(detail.error, "Could not load this capture.")}</p> : null}
      {detail.data ? (
        <div className="mt-3 rounded border border-terminal-border p-2">
          <h4 className="font-semibold text-terminal-text">Saved {detail.data.symbol} observation</h4>
          <p className="mt-1 text-terminal-muted">
            Captured {new Date(detail.data.captured_at).toLocaleString()} · {detail.data.record_count} distinct eligible values from {detail.data.examined_count} fetched candidates · {detail.data.status.replace(/_/g, " ")}.
          </p>
          {detail.data.status === "fetch_error" ? <p className="mt-1 text-terminal-warn">The fetch failed; this capture says nothing about available fundamentals.</p> : null}
          {detail.data.status === "no_eligible_records_observed" ? <p className="mt-1 text-terminal-muted">No eligible values were observed in this fetch; this does not prove none existed.</p> : null}
          <p className="mt-1 text-terminal-muted">Distinct conflicting values remain visible below. Units are provider-native; this is a terminal observation, not a verified historical revision or price-move explanation.</p>
          {detail.data.records.length > 0 ? (
            <ul className="mt-2 max-h-56 space-y-1 overflow-auto text-terminal-text">
              {detail.data.records.map((record) => (
                <li key={`${record.release_date}-${record.fiscal_period_end}-${record.metric}-${record.source}-${record.value}`}>
                  {record.release_date} · {FUNDAMENTAL_LABELS[record.metric]} {new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(record.value)} · fiscal period {record.fiscal_period_end} · {sourceLabel(record.source)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {comparison && delta.isPending ? <p role="status" className="mt-2 text-terminal-muted">Comparing saved observations…</p> : null}
      {comparison && delta.isError ? <p role="alert" className="mt-2 text-terminal-neg">{extractApiErrorMessage(delta.error, "Could not compare saved observations.")}</p> : null}
      {delta.data ? (
        <div className="mt-3 rounded border border-terminal-border p-2">
          <h4 className="font-semibold text-terminal-text">Observed changes between {symbol} captures</h4>
          <p className="mt-1 text-terminal-muted">
            {new Date(delta.data.earlier_capture.captured_at).toLocaleString()} → {new Date(delta.data.later_capture.captured_at).toLocaleString()}.
            Differences are in retained provider candidate sets, not verified revisions, retractions, or proof of market knowledge.
          </p>
          {delta.data.comparison_status === "unavailable" ? (
            <p className="mt-2 text-terminal-warn">Cannot compare values: {delta.data.reason === "earlier_capture_not_records_observed" ? "the earlier" : "the later"} capture had no eligible records observed or its fetch failed.</p>
          ) : (
            <>
              <p className="mt-2 text-terminal-muted">{delta.data.unchanged_identity_count} unchanged source-dated identities · {delta.data.deltas.length} differing identities.</p>
              {delta.data.deltas.length === 0 ? <p className="mt-1 text-terminal-muted">No candidate-set differences observed; coverage outside these fetches remains unknown.</p> : null}
              <ul className="mt-2 max-h-56 space-y-2 overflow-auto text-terminal-text">
                {delta.data.deltas.map((item) => (
                  <li key={`${item.release_date}-${item.fiscal_period_end}-${item.metric}-${item.source}`} className="rounded border border-terminal-border p-2">
                    {item.release_date} · {FUNDAMENTAL_LABELS[item.metric]} · fiscal period {item.fiscal_period_end} · {sourceLabel(item.source)}
                    <p className="text-terminal-muted">
                      {item.kind.replace(/_/g, " ")} · earlier: {item.earlier_values.length ? item.earlier_values.join(", ") : "none observed"} · later: {item.later_values.length ? item.later_values.join(", ") : "none observed"}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DatedFundamentalReleases({ anchor, row }: { anchor: string; row: MarketComparisonRow }) {
  const [open, setOpen] = useState(false);
  const startDate = row.start_date || "";
  const endDate = row.end_date || "";
  const query = useQuery({
    queryKey: ["market-context-fundamental-releases", anchor, row.symbol, startDate, endDate],
    queryFn: () => fetchMarketContextFundamentalReleases(anchor, row.symbol, startDate, endDate),
    enabled: open && !!startDate && !!endDate,
    staleTime: 5 * 60_000,
    retry: false,
  });

  return (
    <div className="mt-3 border-t border-terminal-border pt-3">
      <button type="button" className="text-xs text-terminal-accent underline" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? "Hide" : "Show"} dated fundamentals for {anchor} vs {row.symbol}
      </button>
      {open ? (
        <div className="mt-2 space-y-2 text-xs">
          <p className="text-terminal-muted">
            Source-reported filing/acceptance dates within this pair’s observed window. Estimated release dates are excluded. Conflicting values for the same provider record are withheld, not treated as verified revisions. This on-demand snapshot is incomplete, has no verified revision history, and cannot prove what a market knew on a past day. Values retain provider units; do not compare them across currencies or issuers as normalized performance.
          </p>
          {query.isPending ? <p role="status" className="text-terminal-muted">Checking dated fundamental releases…</p> : null}
          {query.isError ? (
            <p role="alert" className="text-terminal-neg">
              {extractApiErrorMessage(query.error, "Could not check fundamental releases.")}
              <button type="button" className="ml-2 underline" onClick={() => void query.refetch()}>Retry fundamentals</button>
            </p>
          ) : null}
          {query.data ? (
            <>
              <p className="text-terminal-muted">
                Checked {new Date(query.data.retrieved_at).toLocaleString()} · showing at most {query.data.display_limit_per_symbol} source-dated records per symbol.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {query.data.groups.map((group) => (
                  <div key={group.symbol} className="rounded border border-terminal-border p-2">
                    <h3 className="font-semibold text-terminal-text">{group.symbol}</h3>
                    {group.status === "feed_error" ? <p className="mt-1 text-terminal-warn">Provider check failed; coverage is unknown.</p> : null}
                    {group.status === "no_usable_records" ? (
                      <p className="mt-1 text-terminal-muted">No source-dated records returned for this window. Access or historical coverage may be limited; this does not mean no release occurred.</p>
                    ) : null}
                    {group.status === "ambiguous" ? (
                      <p className="mt-1 text-terminal-warn">Only conflicting source-dated values were found; no numeric release is shown.</p>
                    ) : null}
                    {group.status === "available" ? (
                      <>
                        <p className="mt-1 text-terminal-muted">{group.matched_count} eligible records among {group.examined_count} fetched candidates.</p>
                        <ul className="mt-2 space-y-2">
                          {group.releases.map((release) => (
                            <li key={`${release.release_date}-${release.fiscal_period_end}-${release.metric}-${release.source}`} className="rounded border border-terminal-border p-2 text-terminal-text">
                              <span className="font-medium">{release.release_date} · {FUNDAMENTAL_LABELS[release.metric]}</span>
                              <span className="ml-2">{new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(release.value)}</span>
                              <p className="text-terminal-muted">Fiscal period ended {release.fiscal_period_end} · {sourceLabel(release.source)}</p>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    {group.conflicting_count > 0 ? (
                      <div className="mt-2 text-terminal-warn">
                        <p>{group.conflicting_count} conflicting provider record{group.conflicting_count === 1 ? "" : "s"} withheld; showing up to {query.data.display_limit_per_symbol}.</p>
                        <ul className="mt-1 space-y-1">
                          {group.conflicts.map((conflict) => (
                            <li key={`${conflict.release_date}-${conflict.fiscal_period_end}-${conflict.metric}-${conflict.source}`}>
                              {conflict.release_date} · {FUNDAMENTAL_LABELS[conflict.metric]} · fiscal period {conflict.fiscal_period_end} · {sourceLabel(conflict.source)}: {conflict.distinct_value_count} different values
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            {[anchor, row.symbol].map((symbol) => (
              <div key={symbol} className="rounded border border-terminal-border p-2">
                <FundamentalCaptureReview symbol={symbol} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
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
          symbol’s native quote currency, not FX-normalized. The identified price-history source is shown per symbol;
          it may differ across the pair or be unavailable.
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
                    <p className="mt-1 text-xs text-terminal-muted">
                      Price-history paths: {selection.anchor} {historyPathLabel(row.anchor_history_source, row.anchor_history_feed)} · {row.symbol} {historyPathLabel(row.comparison_history_source, row.comparison_history_feed)}.
                    </p>
                    <AlignedPaths anchor={selection.anchor} row={row} />
                    <TechnicalObservations anchor={selection.anchor} row={row} />
                    <DatedHeadlines anchor={selection.anchor} row={row} />
                    <DatedMacroEvents anchor={selection.anchor} row={row} />
                    <DatedFundamentalReleases anchor={selection.anchor} row={row} />
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-terminal-muted">{unavailableReason(row)} Latest dates: {selection.anchor} {row.anchor_latest_date || "unknown"}, {row.symbol} {row.comparison_latest_date || "unknown"}.</p>
                    <p className="mt-1 text-xs text-terminal-muted">Price-history paths: {selection.anchor} {historyPathLabel(row.anchor_history_source, row.anchor_history_feed)} · {row.symbol} {historyPathLabel(row.comparison_history_source, row.comparison_history_feed)}.</p>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </TerminalPanel>
    </div>
  );
}
