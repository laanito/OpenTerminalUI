import { api } from "./base";
import type { DegradedInfo } from "./types";
import type {
  InsiderTrade,
  InsiderStockResponse,
  InsiderTopActivityRow,
  InsiderClusterRow,
} from "../types";

export async function fetchRecentInsiderTrades(params?: {
  days?: number;
  min_value?: number;
  type?: "buy" | "sell" | "";
  limit?: number;
}): Promise<{ trades: InsiderTrade[]; degraded?: DegradedInfo }> {
  const { data } = await api.get<{ trades: InsiderTrade[]; degraded?: DegradedInfo }>("/insider/recent", {
    params: {
      days: params?.days,
      min_value: params?.min_value,
      type: params?.type || undefined,
      limit: params?.limit,
    },
  });
  return data;
}

export async function fetchInsiderStock(symbol: string, days = 365): Promise<InsiderStockResponse> {
  const { data } = await api.get<InsiderStockResponse>(`/insider/stock/${encodeURIComponent(symbol)}`, {
    params: { days },
  });
  return data;
}

export async function fetchTopInsiderBuyers(days = 90, limit = 20): Promise<{ buyers: InsiderTopActivityRow[]; degraded?: DegradedInfo }> {
  const { data } = await api.get<{ buyers: InsiderTopActivityRow[]; degraded?: DegradedInfo }>("/insider/top-buyers", {
    params: { days, limit },
  });
  return data;
}

export async function fetchTopInsiderSellers(days = 90, limit = 20): Promise<{ sellers: InsiderTopActivityRow[]; degraded?: DegradedInfo }> {
  const { data } = await api.get<{ sellers: InsiderTopActivityRow[]; degraded?: DegradedInfo }>("/insider/top-sellers", {
    params: { days, limit },
  });
  return data;
}

export async function fetchInsiderClusterBuys(days = 30, min_insiders = 3): Promise<{ clusters: InsiderClusterRow[]; degraded?: DegradedInfo }> {
  const { data } = await api.get<{ clusters: InsiderClusterRow[]; degraded?: DegradedInfo }>("/insider/cluster-buys", {
    params: { days, min_insiders },
  });
  return data;
}
