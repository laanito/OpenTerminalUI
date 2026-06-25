import { api } from "./base";
import type {
  EconomicEvent,
  MacroIndicatorsResponse,
} from "../types";

export async function fetchEconomicCalendar(from: string, to: string): Promise<EconomicEvent[]> {
  // Backend returns a bare array; tolerate a legacy { items: [] } shape too.
  const { data } = await api.get<EconomicEvent[] | { items: EconomicEvent[] }>(
    "/economics/calendar",
    { params: { from, to } },
  );
  if (Array.isArray(data)) return data;
  return Array.isArray((data as { items?: EconomicEvent[] })?.items)
    ? (data as { items: EconomicEvent[] }).items
    : [];
}

export async function fetchMacroIndicators(country?: string): Promise<MacroIndicatorsResponse> {
  const { data } = await api.get<MacroIndicatorsResponse>("/economics/indicators", {
    params: country ? { country } : undefined,
  });
  return data;
}
