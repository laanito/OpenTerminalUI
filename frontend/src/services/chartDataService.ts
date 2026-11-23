import { fetchApi } from "../api/base";

export interface UnifiedOHLCVBar {
  t: number; // ms epoch
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  s?: string;   // session: "pre", "rth", "post", etc.
  ext?: boolean; // isExtended
}

export interface UnifiedChartResponse {
  symbol: string;
  interval: string;
  count: number;
  market_hint?: string;
  data: UnifiedOHLCVBar[];
}

export async function fetchChartData(
  symbol: string,
  opts?: {
    market?: string;
    interval?: string;
    period?: string;
    start?: string;
    end?: string;
    extended?: boolean;
  },
): Promise<UnifiedChartResponse> {
  const params = new URLSearchParams();
  params.set("normalized", "true");
  params.set("interval", opts?.interval ?? "1d");
  params.set("period", opts?.period ?? "6mo");
  // An explicit Yahoo listing/index identifies itself; the global selector is
  // only a disambiguating hint for bare symbols, never an asset-class override.
  const explicitListing = /\.[A-Z]{1,4}$/i.test(symbol) || symbol.startsWith("^") || /=([FX])$/i.test(symbol);
  if (opts?.market && !explicitListing) params.set("market", opts.market);
  if (opts?.start) params.set("start", opts.start);
  if (opts?.end) params.set("end", opts.end);
  if (opts?.extended) params.set("extended", "true");
  const res = await fetchApi(`/chart/${encodeURIComponent(symbol)}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Unified chart fetch failed (${res.status})`);
  }
  return (await res.json()) as UnifiedChartResponse;
}
