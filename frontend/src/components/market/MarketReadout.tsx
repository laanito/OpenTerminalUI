import type { ReactNode } from "react";
import type { DegradedInfo } from "../../api/types";
import { finite } from "../terminal/AnalyticsRead";

export function marketNumber(value: unknown, digits = 8) {
  return finite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: digits }) : "Unavailable";
}
export function observationTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toISOString().replace("T"," ").replace(".000Z"," UTC");
}
export function MarketMetrics({ items }: { items: [string,ReactNode][] }) {
  return <dl className="flex min-w-0 flex-wrap gap-3">{items.map(([name,value]) => <div key={name} className="min-w-0 flex-1 basis-36 rounded border border-terminal-border p-3"><dt className="text-xs text-terminal-muted">{name}</dt><dd className="mt-2 break-words text-base tabular-nums">{value}</dd></div>)}</dl>;
}
export function CoverageNotice({ name,info }: { name: string; info?: DegradedInfo | null }) {
  if (!info) return null;
  const reason = ({ no_provider_data: "Provider data is currently unavailable.",provider_error: "The data provider reported an error.",missing_api_key: "A required provider key is not configured.",rate_limited: "The provider rate-limited this request.",no_live_source: "No live source is available for this response." } as Record<string,string>)[info.reason] || String(info.reason || "Coverage unavailable").replace(/_/g," ");
  return <div role="status" className="min-w-0 space-y-2 rounded border border-orange-500/40 bg-orange-500/10 p-3 text-sm text-orange-300"><p>{name} coverage is degraded. {reason}</p>{info.detail && <p className="break-words text-xs">{info.detail}</p>}</div>;
}
