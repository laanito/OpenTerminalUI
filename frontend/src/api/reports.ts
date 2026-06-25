import { api } from "./base";
import type {
  ScheduledReport,
} from "../types";

export async function downloadExport(dataType: string, format: "csv" | "xlsx" | "pdf"): Promise<Blob> {
  const { data } = await api.get(`/export/${encodeURIComponent(dataType)}`, {
    params: { format },
    responseType: "blob",
  });
  return data as Blob;
}

export async function fetchScheduledReports(): Promise<ScheduledReport[]> {
  const { data } = await api.get<{ items: ScheduledReport[] }>("/reports/scheduled");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createScheduledReport(payload: { report_type: string; frequency: string; email: string; data_type: string }): Promise<ScheduledReport> {
  const { data } = await api.post<ScheduledReport>("/reports/scheduled", payload);
  return data;
}

export async function deleteScheduledReport(configId: string): Promise<void> {
  await api.delete(`/reports/scheduled/${encodeURIComponent(configId)}`);
}

export async function generateAdvancedReport(type: "stock" | "portfolio" | "backtest", params: Record<string, any> = {}): Promise<Blob> {
  const { data } = await api.post<Blob>("/reports/generate", { type, params }, { responseType: "blob" });
  return data;
}

export async function fetchBulkDeals(): Promise<{ data?: Array<Record<string, unknown>>; error?: string }> {
  const { data } = await api.get<{ data?: Array<Record<string, unknown>>; error?: string }>("/reports/bulk-deals");
  return data;
}

export async function fetchEvents(): Promise<Array<{ date: string; ticker: string; event: string }>> {
  const { data } = await api.get<Array<{ date: string; ticker: string; event: string }>>("/reports/events");
  return data;
}

export async function fetchMarketStatus(): Promise<Record<string, unknown>> {
  const { data } = await api.get<Record<string, unknown>>("/reports/market-status");
  return data;
}
