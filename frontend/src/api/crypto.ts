import { api } from "./base";
import type {
  ChartResponse,
} from "../types";
import type {
  CryptoMarketRow,
  CryptoMarketsQuery,
  CryptoMoverRow,
  CryptoDominanceResponse,
  CryptoIndexResponse,
  CryptoSectorRow,
  CryptoCoinDetail,
} from "./types";

export type CryptoFundamentals = {
  symbol: string;
  name: string;
  tokenomics: {
    circulating_supply: number | null;
    total_supply: number | null;
    max_supply: number | null;
    circulating_pct: number | null;
  };
  valuation: {
    market_cap: number | null;
    fully_diluted_valuation: number | null;
    fdv_mcap_ratio: number | null;
    ath: number | null;
    ath_change_pct: number | null;
    mcap_tvl_ratio: number | null;
    price_to_fees_ratio: number | null;
  };
  onchain: {
    tvl: number | null;
    fees_24h: number | null;
    fees_30d: number | null;
    fees_annualized: number | null;
    category: string | null;
    chains: string[] | null;
    tracked: boolean;
  };
  sources: string[];
  ts: string;
};

export async function fetchCryptoFundamentals(symbol: string): Promise<CryptoFundamentals> {
  const { data } = await api.get<CryptoFundamentals>(`/v1/crypto/fundamentals/${encodeURIComponent(symbol)}`);
  return data;
}

export async function fetchCryptoSearch(q: string): Promise<Array<{ ticker: string; name: string }>> {
  const { data } = await api.get<{ items: Array<{ symbol: string; name: string }> }>("/v1/crypto/search", { params: { q } });
  return (data?.items ?? []).map(item => ({ ticker: item.symbol, name: item.name }));
}

export async function fetchCryptoCandles(symbol: string, interval = "1d", range = "1y"): Promise<ChartResponse> {
  // Backend expects symbol as a query param (GET /v1/crypto/candles?symbol=). A
  // path segment (/candles/BTC-USD) misses the route, hits the SPA catch-all and
  // returns HTML, so every crypto chart came back empty. See fetchCryptoIndex.
  const { data } = await api.get<ChartResponse>("/v1/crypto/candles", {
    params: { symbol, interval, range },
  });
  return data;
}

export async function fetchCryptoMarkets(query: number | CryptoMarketsQuery = 50): Promise<CryptoMarketRow[]> {
  const params = typeof query === "number" ? { limit: query } : query;
  const { data } = await api.get<{ items: CryptoMarketRow[] }>("/v1/crypto/markets", { params });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchCryptoMovers(metric: string, limit = 20): Promise<CryptoMoverRow[]> {
  // Backend expects metric as a path segment (GET /v1/crypto/movers/{metric}?limit=),
  // not a query param — a bare /v1/crypto/movers misses the route. See fetchCryptoIndex.
  const { data } = await api.get<{ items: CryptoMoverRow[] }>(`/v1/crypto/movers/${encodeURIComponent(metric)}`, { params: { limit } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchCryptoDominance(): Promise<CryptoDominanceResponse> {
  const { data } = await api.get<CryptoDominanceResponse>("/v1/crypto/dominance");
  return data;
}

export async function fetchCryptoIndex(topN = 10): Promise<CryptoIndexResponse> {
  // Backend expects top_n as a query param (GET /v1/crypto/index?top_n=). Using a path
  // segment (/index/10) misses the route, hits the SPA catch-all, and returns HTML — which
  // then crashes the page on indexQuery.data.index_value.toFixed (undefined).
  const { data } = await api.get<CryptoIndexResponse>(`/v1/crypto/index?top_n=${topN}`);
  return data;
}

export async function fetchCryptoSectors(): Promise<CryptoSectorRow[]> {
  const { data } = await api.get<{ items: CryptoSectorRow[] }>("/v1/crypto/sectors");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchCryptoCoinDetail(symbol: string): Promise<CryptoCoinDetail> {
  const { data } = await api.get<CryptoCoinDetail>(`/v1/crypto/coins/${encodeURIComponent(symbol)}`);
  return data;
}
