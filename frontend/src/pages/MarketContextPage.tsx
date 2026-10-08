import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { captureMarketFundamentals, compareMarketContext, compareMarketFundamentalCaptures, fetchMarketContextFundamentalReleases, fetchMarketContextHeadlines, fetchMarketContextMacroEvents, fetchMarketContextMacroObservations, fetchMarketSecFiledFacts, fetchSecSubmissionCrosscheck, getMarketFundamentalCapture, listMarketFundamentalCaptures, type MarketContextPeriod, type MarketComparisonRow, type MarketMacroObservationSeries, type MarketQuoteUnitDisclosure, type MarketReportingCurrency, type SecFiledFactsResponse, type SecSubmissionClaim } from "../api/marketContext";
import { extractApiErrorMessage } from "../api/base";
import { SymbolSuggestions } from "../components/market/SymbolSuggestions";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

const SYMBOL_PATTERN = /^[A-Z0-9^._=-]{1,40}$/;
const PERIODS: MarketContextPeriod[] = ["1M", "3M", "6M"];
const REPORTING_CURRENCIES: MarketReportingCurrency[] = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "INR"];
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
  const alpacaParts = feed.split(":");
  const feedLabel = feed === "yahoo_chart" ? "Yahoo chart"
    : feed === "fmp_historical_price_non_split_adjusted" ? "FMP EOD bars (non-split-adjusted)"
    : feed === "fmp_historical_price" ? "FMP historical prices"
    : alpacaParts.length === 3 && alpacaParts[0] === "alpaca_stocks_bars" && alpacaParts[2] === "raw"
      ? `stock bars (${alpacaParts[1].toUpperCase()} feed, raw)`
      : feed;
  return `${sourceLabel(source)} → ${feedLabel}`;
}

function adjustmentBasisLabel(basis: MarketComparisonRow["anchor_reported_adjustment_basis"]): string {
  if (basis === "raw") return "raw requested (provider-reported)";
  if (basis === "non_split_adjusted") return "non-split-adjusted requested (provider-reported)";
  if (basis === "unspecified") return "adjustment basis not verified";
  return "no usable history";
}

function pairBasisMessage(status: MarketComparisonRow["pair_reported_basis_status"]): string | null {
  if (status === "matching_reported") return "Both feeds report the same requested price basis; returned-price quality and cross-provider comparability are still unverified.";
  if (status === "mixed_reported") return "The feeds report different price bases. Treat the provider-close return difference as mixed-basis, not like-for-like.";
  if (status === "unverified") return "At least one feed has an unverified price basis; the provider-close return difference is not confirmed like-for-like.";
  return null;
}

function quoteUnitLabel(disclosure: MarketQuoteUnitDisclosure | undefined): string {
  return disclosure?.unit && disclosure.source === "yahoo_chart_meta"
    ? `${disclosure.unit} (selected Yahoo chart metadata)`
    : "unknown from selected history";
}

function CloseDateConflicts({ anchor, row }: { anchor: string; row: MarketComparisonRow }) {
  const entries = [
    { symbol: anchor, disclosure: row.anchor_close_date_conflicts },
    { symbol: row.symbol, disclosure: row.comparison_close_date_conflicts },
  ];
  if (!entries.some(({ disclosure }) => disclosure && (disclosure.provider_close_count || disclosure.adjusted_close_count))) return null;
  return (
    <div className="mt-2 text-xs text-terminal-warn">
      <p>Conflicting UTC-date closes were withheld from the selected chart payload; listed dates may fall outside this pair’s compared window. Upstream adapter filtering is not audited.</p>
      {entries.map(({ symbol, disclosure }) => disclosure && (disclosure.provider_close_count || disclosure.adjusted_close_count) ? (
        <p key={symbol} className="mt-1">
          {symbol}: provider closes {disclosure.provider_close_count} ({disclosure.provider_close_dates.join(", ") || "none"}); Yahoo adjusted closes {disclosure.adjusted_close_count} ({disclosure.adjusted_close_dates.join(", ") || "none"}). Up to {disclosure.display_limit} latest dates per series shown.
        </p>
      ) : null)}
    </div>
  );
}

function unavailableReason(row: MarketComparisonRow): string {
  if (row.reason === "provider_error") return "History provider failed; no comparison was calculated.";
  if (row.reason === "insufficient_overlap") return "Not enough shared daily closes for this window.";
  return "No usable daily history for this comparison.";
}

function FXEndpointComparison({ anchor, row }: { anchor: string; row: MarketComparisonRow }) {
  const fx = row.fx_endpoint_comparison;
  if (!fx) return null;
  const reasons = {
    price_unavailable: "The shared price endpoints are unavailable.",
    quote_unit_unknown: "At least one selected history has no reported quote unit.",
    quote_unit_unsupported: "At least one reported quote unit is not a supported currency code (for example GBp is not GBP).",
    fx_unavailable: "Dated FX evidence is unavailable; no dates were dropped or substituted.",
  };
  const evidence = [
    [anchor, "start", fx.anchor_start_fx], [anchor, "end", fx.anchor_end_fx],
    [row.symbol, "start", fx.comparison_start_fx], [row.symbol, "end", fx.comparison_end_fx],
  ] as const;
  return (
    <div className="mt-3 rounded border border-terminal-border p-2 text-xs">
      <h3 className="font-semibold text-terminal-text">Endpoint returns in {fx.reporting_currency}</h3>
      {fx.status === "available" ? <>
        <p className="mt-1 text-terminal-text">{anchor}: {formatPercent(fx.anchor_return_pct)} · {row.symbol}: {formatPercent(fx.comparison_return_pct)} · difference: {formatPoints(fx.relative_return_pp)}</p>
        <p className="mt-1 text-terminal-muted">Same shared price endpoints ({fx.start_date} to {fx.end_date}); provider-reported quote units {fx.anchor_quote_unit} and {fx.comparison_quote_unit}. Each endpoint close is multiplied by its dated FX rate. This endpoint result alone is not an FX-normalized daily path, adjusted return, or execution-grade valuation.</p>
        <ul className="mt-1 text-terminal-muted">{evidence.map(([symbol, endpoint, rate]) => rate ? <li key={`${symbol}-${endpoint}`}>{symbol} {endpoint} {rate.requested_date}: {rate.rate} ({rate.source}, {rate.source_symbol}; rate dated {rate.rate_at.slice(0, 10)}){rate.degraded ? ` — degraded: ${rate.degraded_reason || "stale source"}` : ""}</li> : null)}</ul>
        {fx.degraded ? <p className="mt-1 text-terminal-warn">At least one FX rate is degraded; interpret this comparison cautiously.</p> : null}
      </> : <p className="mt-1 text-terminal-warn">Unavailable: {fx.reason ? reasons[fx.reason] : "No endpoint comparison was calculated."}</p>}
    </div>
  );
}

function FXSharedPath({ anchor, row }: { anchor: string; row: MarketComparisonRow }) {
  const [open, setOpen] = useState(false);
  const path = row.fx_shared_path;
  if (!path || row.status !== "available") return null;
  if (path.status === "unavailable") return <p className="mt-2 text-xs text-terminal-warn">Full shared-date FX path unavailable: {path.reason === "fx_unavailable" ? "at least one dated rate is missing or invalid; the endpoint result may still be available." : "price or quote-unit evidence is unavailable."} No dates were dropped.</p>;
  return (
    <div className="mt-3 border-t border-terminal-border pt-3">
      <button type="button" className="text-xs text-terminal-accent underline" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? "Hide" : "Show"} shared-date FX path for {anchor} vs {row.symbol}
      </button>
      {open ? <div className="mt-2 space-y-2 text-xs">
        <p className="text-terminal-muted">Provider closes converted to {path.reporting_currency} at each of the {path.observations} original shared UTC dates and rebased to 100. Historical FX may use the latest prior rate within the valuation service’s accepted gap; each rate date is inspectable below. No missing dates are filled. This is a retrospective, provider-dependent path, not verified adjusted performance or a trading signal.</p>
        {path.degraded ? <p className="text-terminal-warn">At least one dated FX input used a degraded source.</p> : null}
        <div className="h-56 w-full" role="img" aria-label={`FX-converted shared-date paths for ${anchor} and ${row.symbol} in ${path.reporting_currency}`}>
          <ResponsiveContainer width="100%" height="100%"><LineChart data={path.points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
            <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={10} minTickGap={25} />
            <YAxis stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={10} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", fontSize: "11px" }} formatter={(value) => typeof value === "number" ? value.toFixed(2) : value} />
            <Line type="linear" dataKey="anchor_index" name={anchor} stroke="var(--ot-color-accent-primary)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
            <Line type="linear" dataKey="comparison_index" name={row.symbol} stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
          </LineChart></ResponsiveContainer>
        </div>
        <details className="text-terminal-muted"><summary className="cursor-pointer text-terminal-accent">View exact FX-converted observations and rates</summary>
          <div className="mt-2 max-h-56 overflow-auto"><table className="w-full text-left"><thead><tr><th>Date</th><th>{anchor} index</th><th>{anchor} FX rate / dated</th><th>{row.symbol} index</th><th>{row.symbol} FX rate / dated</th></tr></thead>
            <tbody>{path.points.map((point) => <tr key={point.date}>
              <td className="pr-2">{point.date}</td><td className="pr-2">{point.anchor_index.toFixed(2)}</td>
              <td className="pr-2">{point.anchor_fx.rate} · {point.anchor_fx.rate_at.slice(0, 10)} · {point.anchor_fx.source} ({point.anchor_fx.source_symbol}){point.anchor_fx.degraded ? ` — ${point.anchor_fx.degraded_reason || "degraded"}` : ""}</td>
              <td className="pr-2">{point.comparison_index.toFixed(2)}</td><td>{point.comparison_fx.rate} · {point.comparison_fx.rate_at.slice(0, 10)} · {point.comparison_fx.source} ({point.comparison_fx.source_symbol}){point.comparison_fx.degraded ? ` — ${point.comparison_fx.degraded_reason || "degraded"}` : ""}</td>
            </tr>)}</tbody></table></div>
        </details>
      </div> : null}
    </div>
  );
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
            As of {technical.as_of_date}. Calculated only from the pair’s shared provider daily closes—no missing dates filled in.
            Crypto weekend closes are omitted when the other asset has no close. Adjustment policy can differ across feeds; splits and other corporate actions can distort or change historical prices.
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
                Same observed pair window, but each asset uses all of its own available UTC close dates. Extra dates—such as crypto weekends—are included here, not in the paired comparison above. These provider-dated observations are not verified exchange-session indicators or trading signals.
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
                Provider-adjusted close coverage on these shared dates. This is a current, retrospective Yahoo series—not a historical vintage or verification of every corporate action. The primary chart, returns, and measures above use the selected providers’ quote closes, without substituting this adjusted series.
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
                            {observations.adjusted_minus_provider_return_pp != null ? <p className="text-terminal-muted">Same-date provider-close return: {formatPercent(observations.provider_return_pct ?? null)} · adjusted minus provider: {formatPoints(observations.adjusted_minus_provider_return_pp)}</p> : null}
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
              {row.adjusted_pair ? (
                <div className="mt-3 rounded border border-terminal-border p-2 text-terminal-text">
                  <h3 className="font-semibold">Separate adjusted pair comparison</h3>
                  <p className="mt-1 text-terminal-muted">
                    Yahoo adjusted closes on all {row.adjusted_pair.observations} primary shared dates, {row.adjusted_pair.start_date} to {row.adjusted_pair.end_date}. Returns remain in native quote currencies, not FX-normalized. This does not replace the provider-close comparison or verify adjustment quality or historical vintage.
                  </p>
                  <p className="mt-1">{anchor}: {formatPercent(row.adjusted_pair.anchor_return_pct)} · {row.symbol}: {formatPercent(row.adjusted_pair.comparison_return_pct)} · Adjusted return difference: {formatPoints(row.adjusted_pair.relative_return_pp)}</p>
                  {row.adjusted_pair.adjusted_minus_provider_relative_return_pp != null ? <p className="mt-1 text-terminal-muted">Same-date provider-close return difference: {formatPoints(row.adjusted_pair.provider_relative_return_pp ?? null)} · adjusted minus provider pair difference: {formatPoints(row.adjusted_pair.adjusted_minus_provider_relative_return_pp)}. This measures a field difference, not its cause or correctness.</p> : null}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-terminal-accent">View exact adjusted pair observations</summary>
                    <div className="mt-2 max-h-48 overflow-auto">
                      <table className="w-full text-left">
                        <thead><tr><th className="py-1 pr-3">UTC date</th><th className="py-1 pr-3">{anchor} adjusted index</th><th className="py-1">{row.symbol} adjusted index</th></tr></thead>
                        <tbody>{row.adjusted_pair.points.map((point) => (
                          <tr key={point.date}><td className="py-0.5 pr-3">{point.date}</td><td className="py-0.5 pr-3">{point.anchor_index.toFixed(2)}</td><td className="py-0.5">{point.comparison_index.toFixed(2)}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </details>
                </div>
              ) : <p className="mt-3 text-terminal-muted">Adjusted pair unavailable unless both symbols have Yahoo-adjusted closes on every primary shared date.</p>}
              {row.native_adjusted_close_coverage ? (
                <div className="mt-3 border-t border-terminal-border pt-2">
                  <h3 className="font-semibold text-terminal-text">Each asset’s own-date adjusted closes</h3>
                  <p className="mt-1 text-terminal-muted">
                    Coverage is checked on every accepted close date for that asset inside the observed pair window, including crypto weekends. Measures appear only with complete coverage; missing dates are never filled. Yahoo adjusted closes are retrospective provider values, not verified corporate-action history or trading signals.
                  </p>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    {([
                      { symbol: anchor, coverage: row.native_adjusted_close_coverage.anchor, observations: row.native_adjusted_observations?.anchor },
                      { symbol: row.symbol, coverage: row.native_adjusted_close_coverage.comparison, observations: row.native_adjusted_observations?.comparison },
                    ]).map(({ symbol, coverage, observations }) => (
                      <div key={symbol} className="rounded border border-terminal-border p-2 text-terminal-text">
                        <h4 className="font-semibold">{symbol} own-date adjusted</h4>
                        <p className="mt-1 text-terminal-muted">
                          {coverage.status} · {coverage.available_observations}/{coverage.native_observations} own-date closes from {coverage.source === "yahoo_adjclose" ? "Yahoo adjclose" : "an unavailable adjusted feed"}.
                        </p>
                        {observations ? (
                          <>
                            <p className="mt-1 text-terminal-muted">{observations.start_date} to {observations.end_date} · {observations.observations} closes · {observations.additional_dates_vs_pair} beyond pair overlap.</p>
                            <p className="mt-1">Adjusted return: {formatPercent(observations.return_pct)}</p>
                            {observations.adjusted_minus_provider_return_pp != null ? <p className="text-terminal-muted">Same-date provider-close return: {formatPercent(observations.provider_return_pct ?? null)} · adjusted minus provider: {formatPoints(observations.adjusted_minus_provider_return_pp)}</p> : null}
                            <p>Maximum observed drawdown: {observations.technical_measures.max_drawdown_pct.toFixed(2)}%</p>
                            <p>20-own-close average gap: {observations.technical_measures.sma20_gap_pct == null ? "Unavailable (fewer than 20 own closes)" : formatPercent(observations.technical_measures.sma20_gap_pct)}</p>
                          </>
                        ) : <p className="mt-1 text-terminal-muted">Own-date adjusted measures unavailable without complete coverage.</p>}
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
                Corporate-action markers reported by the selected Yahoo chart response within this window. These are not a complete action audit and do not establish the selected closes’ adjustment policy.
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

function MacroVintageDifference({ current, historical }: { current: MarketMacroObservationSeries | undefined; historical: MarketMacroObservationSeries }) {
  if (!current || current.status === "feed_error" || historical.status === "feed_error") {
    return <p className="text-terminal-warn">Cannot compare this series across both FRED requests.</p>;
  }
  if (current.units !== historical.units || current.frequency !== historical.frequency) {
    return <p className="text-terminal-warn">Units or frequency changed between FRED views; no numeric comparison is shown.</p>;
  }
  const currentByDate = new Map(current.observations.map((item) => [item.reference_date, item.value]));
  const historicalByDate = new Map(historical.observations.map((item) => [item.reference_date, item.value]));
  const dates = [...new Set([...currentByDate.keys(), ...historicalByDate.keys()])].sort();
  const differences = dates.filter((date) => currentByDate.get(date) !== historicalByDate.get(date));
  return (
    <>
      <p className="text-terminal-muted">{differences.length} differing or absent reference dates · {dates.length - differences.length} unchanged on returned dates.</p>
      {differences.length ? <ul className="mt-1 max-h-28 space-y-1 overflow-auto">{differences.map((date) => <li key={date}>{date}: as-of {historicalByDate.has(date) ? historicalByDate.get(date)?.toLocaleString() : "absent"} → current {currentByDate.has(date) ? currentByDate.get(date)?.toLocaleString() : "absent"}</li>)}</ul> : null}
    </>
  );
}

function HistoricalMacroObservations({ anchor, row }: { anchor: string; row: MarketComparisonRow }) {
  const [open, setOpen] = useState(false);
  const [showAsOf, setShowAsOf] = useState(false);
  const startDate = row.start_date || "";
  const endDate = row.end_date || "";
  const query = useQuery({
    queryKey: ["market-context-macro-observations", startDate, endDate],
    queryFn: () => fetchMarketContextMacroObservations(startDate, endDate),
    enabled: open && !!startDate && !!endDate,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const asOfQuery = useQuery({
    queryKey: ["market-context-macro-observations-asof", startDate, endDate],
    queryFn: () => fetchMarketContextMacroObservations(startDate, endDate, endDate),
    enabled: open && showAsOf && !!startDate && !!endDate,
    staleTime: 5 * 60_000,
    retry: false,
  });

  return (
    <div className="mt-3 border-t border-terminal-border pt-3">
      <button type="button" className="text-xs text-terminal-accent underline" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} historical macro observations for ${anchor} vs ${row.symbol}`}>
        {open ? "Hide" : "Show"} historical macro observations for {startDate} to {endDate}
      </button>
      {open ? (
        <div className="mt-2 space-y-2 text-xs">
          <p className="text-terminal-muted">
            US macro reference-period values from the current FRED vintage. A reference date is not a publication date; revised values were not necessarily known then. These are global context, not explanations for either price path.
          </p>
          {query.isPending ? <p role="status" className="text-terminal-muted">Checking FRED observations…</p> : null}
          {query.isError ? <p role="alert" className="text-terminal-neg">{extractApiErrorMessage(query.error, "Could not check macro observations.")} <button type="button" className="underline" onClick={() => void query.refetch()}>Retry observations</button></p> : null}
          {query.data?.status === "unavailable" ? <p className="text-terminal-warn">{query.data.reason === "missing_api_key" ? "FRED_API_KEY is not configured. No sample values are shown here." : "FRED did not return usable series. No sample values are shown here."}</p> : null}
          {query.data?.series.length ? (
            <>
              <p className="text-terminal-muted">FRED · checked {new Date(query.data.retrieved_at).toLocaleString()} · requested real-time date {query.data.realtime_date}. Neither a saved vintage nor a release-time audit.</p>
              <div className="grid gap-2 md:grid-cols-3">
                {query.data.series.map((series) => (
                  <div key={series.series_id} className="rounded border border-terminal-border p-2">
                    <p className="font-medium">{series.label} · <a className="text-terminal-accent underline" href={`https://fred.stlouisfed.org/series/${series.series_id}`} target="_blank" rel="noopener noreferrer">{series.series_id}</a></p>
                    {series.status === "feed_error" ? <p className="text-terminal-warn">Provider metadata or observations failed.</p> : (
                      <>
                        <p className="text-terminal-muted">{series.title} · {series.units} · {series.frequency}</p>
                        {series.observations.length ? <ul className="mt-1 max-h-28 space-y-1 overflow-auto">{series.observations.map((observation) => <li key={observation.reference_date}>{observation.reference_date}: {observation.value.toLocaleString()}</li>)}</ul> : <p className="text-terminal-muted">No usable reference-period values in this window.</p>}
                        {series.withheld_conflict_count > 0 ? <p className="text-terminal-warn">{series.withheld_conflict_count} conflicting reference dates withheld.</p> : null}
                      </>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" className="text-terminal-accent underline" onClick={() => setShowAsOf((value) => !value)} aria-expanded={showAsOf}>
                {showAsOf ? "Hide" : "Check"} FRED values as of {endDate}
              </button>
              {showAsOf ? (
                <div className="space-y-2 rounded border border-terminal-border p-2">
                  <p className="text-terminal-muted">FRED daily real-time view requested as of {endDate}. This can reveal later revisions or newly returned values, but is not an intraday release audit, a complete availability guarantee, or evidence that either asset reacted.</p>
                  {asOfQuery.isPending ? <p role="status" className="text-terminal-muted">Checking historical FRED view…</p> : null}
                  {asOfQuery.isError ? <p role="alert" className="text-terminal-neg">{extractApiErrorMessage(asOfQuery.error, "Could not check historical FRED view.")} <button type="button" className="underline" onClick={() => void asOfQuery.refetch()}>Retry historical view</button></p> : null}
                  {asOfQuery.data?.status === "unavailable" ? <p className="text-terminal-warn">Historical FRED view unavailable: {asOfQuery.data.reason === "missing_api_key" ? "FRED_API_KEY is not configured." : "provider request failed."}</p> : null}
                  {asOfQuery.data && asOfQuery.data.realtime_date !== endDate ? <p className="text-terminal-warn">FRED returned a different real-time date; no vintage comparison is shown.</p> : null}
                  {asOfQuery.data?.series.length && asOfQuery.data.realtime_date === endDate ? (
                    <div className="grid gap-2 md:grid-cols-3">
                      {asOfQuery.data.series.map((series) => (
                        <div key={series.series_id} className="rounded border border-terminal-border p-2">
                          <p className="font-medium">{series.label} · {series.series_id}</p>
                          {series.status === "feed_error" ? <p className="text-terminal-warn">Historical provider view failed.</p> : <p className="text-terminal-muted">{series.units} · {series.frequency} · {series.matched_count} returned values{series.withheld_conflict_count ? ` · ${series.withheld_conflict_count} conflicting dates withheld` : ""}.</p>}
                          <MacroVintageDifference current={query.data.series.find((item) => item.series_id === series.series_id)} historical={series} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
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

function displayedSecClaims(data: SecFiledFactsResponse): { claims: SecSubmissionClaim[]; distinctCount: number } {
  const seen = new Set<string>();
  const claims: SecSubmissionClaim[] = [];
  const displayed = [...data.facts, ...(data.difference_candidates ?? []).flatMap((candidate) => candidate.disclosures)];
  for (const fact of displayed) {
    const key = `${fact.accession}|${fact.form}|${fact.filed_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (claims.length < 100) claims.push({ accession: fact.accession, form: fact.form, filed_date: fact.filed_date });
  }
  return { claims, distinctCount: seen.size };
}

function SecSubmissionCrosscheckPanel({ symbol, data }: { symbol: string; data: SecFiledFactsResponse }) {
  const [open, setOpen] = useState(false);
  const { claims, distinctCount } = useMemo(() => displayedSecClaims(data), [data]);
  const query = useQuery({
    queryKey: ["market-sec-submission-crosscheck", data.cik, claims],
    queryFn: () => fetchSecSubmissionCrosscheck(data.cik!, claims),
    enabled: open && data.cik !== null && claims.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return (
    <div className="mt-3 border-t border-terminal-border pt-2">
      <button type="button" className="text-terminal-accent underline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? "Hide" : "Check"} recent SEC submission metadata for {symbol}
      </button>
      {open ? (
        <div className="mt-2 space-y-1">
          <p className="text-terminal-muted">
            Checking {claims.length} of {distinctCount} distinct claims from the displayed facts and disclosures against the current recent-submissions index. Older filings may be in continuation files not checked here. A miss does not disprove a filing; a match does not establish when a market participant saw it.
          </p>
          {query.isPending ? <p role="status" className="text-terminal-muted">Checking recent SEC submissions for {symbol}…</p> : null}
          {query.isError ? <p role="alert" className="text-terminal-neg">{extractApiErrorMessage(query.error, "Could not check recent SEC submissions.")} <button type="button" className="underline" onClick={() => void query.refetch()}>Retry submission check for {symbol}</button></p> : null}
          {query.data?.status === "configuration_required" ? <p className="text-terminal-muted">SEC user agent is not configured; no submission check was made.</p> : null}
          {query.data?.status === "provider_error" ? <p className="text-terminal-warn">SEC submissions check failed; the filed facts above remain available. <button type="button" className="underline" onClick={() => void query.refetch()}>Retry submission check for {symbol}</button></p> : null}
          {query.data?.status === "available" ? (
            <>
              <p className="text-terminal-muted">{query.data.matched_count}/{query.data.checked_count} claims matched accession, form, and filed date in the recent index.</p>
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {query.data.results.map((item) => (
                  <li key={`${item.accession}-${item.form}-${item.filed_date}`} className="rounded border border-terminal-border p-1 text-terminal-text">
                    {item.accession} · {item.form} · {item.filed_date}: {item.status === "matched" ? "Recent-index match" : item.status === "metadata_mismatch" ? "SEC metadata differs" : item.status === "ambiguous_in_recent_index" ? "Conflicting recent-index rows" : "Not found in recent index"}.
                    {item.status === "metadata_mismatch" ? ` SEC lists ${item.submission_form} on ${item.submission_filed_date}.` : null}
                    {item.accepted_at ? ` SEC-reported acceptance ${item.accepted_at}.` : null}
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

function SecFiledFactsForSymbol({ symbol, startDate, endDate }: { symbol: string; startDate: string; endDate: string }) {
  const query = useQuery({
    queryKey: ["market-sec-filed-facts", symbol, startDate, endDate],
    queryFn: () => fetchMarketSecFiledFacts(symbol, startDate, endDate),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const data = query.data;
  return (
    <div className="rounded border border-terminal-border p-2">
      <h3 className="font-semibold text-terminal-text">{symbol}</h3>
      {query.isPending ? <p role="status" className="mt-1 text-terminal-muted">Checking SEC filed facts for {symbol}…</p> : null}
      {query.isError ? (
        <p role="alert" className="mt-1 text-terminal-neg">
          {extractApiErrorMessage(query.error, `Could not check SEC filed facts for ${symbol}.`)}
          <button type="button" className="ml-2 underline" onClick={() => void query.refetch()}>Retry SEC facts for {symbol}</button>
        </p>
      ) : null}
      {data?.status === "configuration_required" ? <p className="mt-1 text-terminal-muted">SEC filed facts are off. The host must set SEC_USER_AGENT; no SEC request was made.</p> : null}
      {data?.status === "not_covered" ? <p className="mt-1 text-terminal-muted">No exact ticker match in the SEC ticker list. This does not prove the issuer has no filings.</p> : null}
      {data?.status === "ambiguous_ticker" ? <p className="mt-1 text-terminal-warn">Multiple SEC company identifiers match this ticker; no filing facts were selected.</p> : null}
      {data?.status === "provider_error" ? <p className="mt-1 text-terminal-warn">SEC provider check failed; coverage is unknown. <button type="button" className="underline" onClick={() => void query.refetch()}>Retry SEC facts for {symbol}</button></p> : null}
      {data?.status === "no_matching_facts" ? <p className="mt-1 text-terminal-muted">No eligible SEC facts returned for this filed-date window. This does not mean no filing occurred.</p> : null}
      {data?.status === "available" ? (
        <>
          <p className="mt-1 text-terminal-muted">
            SEC CIK {data.cik} · {data.matched_count} matching facts among {data.examined_count} examined · showing at most {data.display_limit}; checked {new Date(data.retrieved_at).toLocaleString()}.
          </p>
          <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto">
            {data.facts.map((fact) => (
              <li key={`${fact.accession}-${fact.concept}-${fact.period_start}-${fact.period_end}-${fact.value}`} className="rounded border border-terminal-border p-2 text-terminal-text">
                <span className="font-medium">{fact.filed_date} · {fact.concept}</span>
                <span className="ml-2">{new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(fact.value)} {fact.unit}</span>
                <p className="text-terminal-muted">{fact.form} · fiscal period {fact.period_start} to {fact.period_end} · accession {fact.accession} · {fact.taxonomy}</p>
              </li>
            ))}
          </ul>
          {data.difference_basis ? (
            <div className="mt-3 border-t border-terminal-border pt-2">
              <h4 className="font-semibold text-terminal-text">Same-period value differences</h4>
              <p className="mt-1 text-terminal-muted">
                {(data.candidate_group_count ?? 0) === 0
                  ? "No differing values detected among eligible facts for the same exact concept, unit, and period; this is not proof that no revision occurred."
                  : `${data.candidate_group_count} candidate group${data.candidate_group_count === 1 ? "" : "s"} across exact concept, unit, and period identities; showing at most ${data.candidate_display_limit}. Different filed values are not verified revisions, corrections, or evidence of what was available at a past trading instant.`}
              </p>
              {(data.difference_candidates ?? []).map((candidate) => (
                <div key={`${candidate.concept}-${candidate.unit}-${candidate.period_start}-${candidate.period_end}`} className="mt-2 rounded border border-terminal-border p-2">
                  <p className="font-medium text-terminal-text">{candidate.concept} · {candidate.period_start} to {candidate.period_end} · {candidate.unit}</p>
                  <p className="mt-1 text-terminal-muted">
                    {candidate.disclosure_count} distinct disclosures · {candidate.distinct_accession_count} accessions · {candidate.distinct_value_count} values; showing up to {data.disclosures_per_candidate_limit} most recently filed.
                  </p>
                  {candidate.within_accession_conflict ? <p className="mt-1 text-terminal-warn">One accession has conflicting values; no order can be inferred within that filing.</p> : null}
                  <ul className="mt-1 space-y-1">
                    {candidate.disclosures.map((fact) => (
                      <li key={`${fact.accession}-${fact.filed_date}-${fact.form}-${fact.value}`} className="text-terminal-text">
                        {fact.filed_date} · {fact.form} · accession {fact.accession} · {new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(fact.value)} {fact.unit}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
          {data.cik !== null ? <SecSubmissionCrosscheckPanel symbol={symbol} data={data} /> : null}
        </>
      ) : null}
    </div>
  );
}

function DatedSecFiledFacts({ anchor, row }: { anchor: string; row: MarketComparisonRow }) {
  const [open, setOpen] = useState(false);
  const startDate = row.start_date;
  const endDate = row.end_date;
  if (!startDate || !endDate) return null;
  return (
    <div className="mt-3 border-t border-terminal-border pt-3 text-xs">
      <button type="button" className="text-terminal-accent underline" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? "Hide" : "Show"} SEC filed facts for {anchor} vs {row.symbol}
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <p className="text-terminal-muted">
            Separate SEC Company Facts check for filings dated {startDate} to {endDate}. Standard US-GAAP concepts and units stay distinct. These are facts visible in the current SEC aggregation, not a complete historical archive, verified revision order, or evidence that a filing caused these price moves.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {[anchor, row.symbol].map((symbol) => <SecFiledFactsForSymbol key={symbol} symbol={symbol} startDate={startDate} endDate={endDate} />)}
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
  const rawCurrency = searchParams.get("currency");
  const appliedCurrency = REPORTING_CURRENCIES.includes(rawCurrency as MarketReportingCurrency) ? rawCurrency as MarketReportingCurrency : null;
  const [anchorInput, setAnchorInput] = useState(appliedAnchor);
  const [proxiesInput, setProxiesInput] = useState(appliedProxies);
  const [periodInput, setPeriodInput] = useState<MarketContextPeriod>(appliedPeriod);
  const [currencyInput, setCurrencyInput] = useState<MarketReportingCurrency | "">(appliedCurrency || "");
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
    setCurrencyInput(appliedCurrency || "");
    setFormError(null);
  }, [appliedAnchor, appliedProxies, appliedPeriod, appliedCurrency]);

  const selection = useMemo(
    () => parseSelection(appliedAnchor, appliedProxies),
    [appliedAnchor, appliedProxies],
  );
  const query = useQuery({
    queryKey: ["market-context", selection.anchor, selection.comparisons, appliedPeriod, appliedCurrency],
    queryFn: () => appliedCurrency
      ? compareMarketContext(selection.anchor, selection.comparisons, appliedPeriod, appliedCurrency)
      : compareMarketContext(selection.anchor, selection.comparisons, appliedPeriod),
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
    setSearchParams({ symbol: next.anchor, proxies: next.comparisons.join(","), period: periodInput, ...(currencyInput ? { currency: currencyInput } : {}) });
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
          <label className="text-xs text-terminal-muted">
            Reporting currency (optional)
            <select value={currencyInput} onChange={(event) => setCurrencyInput(event.target.value as MarketReportingCurrency | "")} className="mt-1 block rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-sm text-terminal-text" aria-label="Reporting currency">
              <option value="">Native only</option>
              {REPORTING_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
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
          it may differ across the pair or be unavailable. Adjustment policy is not verified for every feed.
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
                <CloseDateConflicts anchor={selection.anchor} row={row} />
                <p className="mt-1 text-xs text-terminal-muted">
                  Quote units: {selection.anchor} {quoteUnitLabel(row.anchor_quote_unit)} · {row.symbol} {quoteUnitLabel(row.comparison_quote_unit)}. These are provider-reported units, not FX conversions or verified price denominations.
                </p>
                {row.anchor_quote_unit?.unit && row.comparison_quote_unit?.unit && row.anchor_quote_unit.unit !== row.comparison_quote_unit.unit ? <p className="mt-1 text-xs text-terminal-warn">Different reported quote units; native returns are not base-currency performance.</p> : null}
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
                    <FXEndpointComparison anchor={selection.anchor} row={row} />
                    <FXSharedPath anchor={selection.anchor} row={row} />
                    <p className="mt-1 text-xs text-terminal-muted">
                      Price-history paths: {selection.anchor} {historyPathLabel(row.anchor_history_source, row.anchor_history_feed)} · {row.symbol} {historyPathLabel(row.comparison_history_source, row.comparison_history_feed)}.
                    </p>
                    <p className="mt-1 text-xs text-terminal-muted">
                      Reported price basis: {selection.anchor} {adjustmentBasisLabel(row.anchor_reported_adjustment_basis)} · {row.symbol} {adjustmentBasisLabel(row.comparison_reported_adjustment_basis)}. These labels describe feed requests, not an audit of returned values.
                    </p>
                    {pairBasisMessage(row.pair_reported_basis_status) ? <p className={`mt-1 text-xs ${row.pair_reported_basis_status === "matching_reported" ? "text-terminal-muted" : "text-terminal-warn"}`}>{pairBasisMessage(row.pair_reported_basis_status)}</p> : null}
                    <AlignedPaths anchor={selection.anchor} row={row} />
                    <TechnicalObservations anchor={selection.anchor} row={row} />
                    <DatedHeadlines anchor={selection.anchor} row={row} />
                    <DatedMacroEvents anchor={selection.anchor} row={row} />
                    <HistoricalMacroObservations anchor={selection.anchor} row={row} />
                    <DatedFundamentalReleases anchor={selection.anchor} row={row} />
                    <DatedSecFiledFacts anchor={selection.anchor} row={row} />
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-terminal-muted">{unavailableReason(row)} Latest dates: {selection.anchor} {row.anchor_latest_date || "unknown"}, {row.symbol} {row.comparison_latest_date || "unknown"}.</p>
                    <p className="mt-1 text-xs text-terminal-muted">Price-history paths: {selection.anchor} {historyPathLabel(row.anchor_history_source, row.anchor_history_feed)} · {row.symbol} {historyPathLabel(row.comparison_history_source, row.comparison_history_feed)}.</p>
                    <p className="mt-1 text-xs text-terminal-muted">Reported price basis: {selection.anchor} {adjustmentBasisLabel(row.anchor_reported_adjustment_basis)} · {row.symbol} {adjustmentBasisLabel(row.comparison_reported_adjustment_basis)}.</p>
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
