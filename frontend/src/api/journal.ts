import { api } from "./base";
import type {
  JournalEntry,
  JournalStats,
  JournalEquityPoint,
  JournalCalendarDay,
  JournalGapReview,
} from "../types";
import type {
  JournalEntryPayload,
  JournalEntryUpdatePayload,
  JournalListFilters,
} from "./types";

export async function fetchJournalEntries(params?: JournalListFilters & { limit?: number; offset?: number }): Promise<JournalEntry[]> {
  const { tags, ...rest } = params ?? {};
  const { data } = await api.get<{ entries: JournalEntry[] }>("/journal", {
    params: { ...rest, tags: Array.isArray(tags) ? tags.join(",") : tags },
  });
  return Array.isArray(data?.entries) ? data.entries : [];
}

export async function createJournalEntry(payload: JournalEntryPayload | Partial<JournalEntry>): Promise<JournalEntry> {
  const { data } = await api.post<{ entry: JournalEntry }>("/journal", payload);
  return data.entry;
}

export async function updateJournalEntry(id: string | number, payload: JournalEntryUpdatePayload | Partial<JournalEntry>): Promise<JournalEntry> {
  const { data } = await api.put<{ entry: JournalEntry }>(`/journal/${encodeURIComponent(id)}`, payload);
  return data.entry;
}

export async function deleteJournalEntry(id: string | number): Promise<void> {
  await api.delete(`/journal/${encodeURIComponent(id)}`);
}

export async function fetchJournalStats(): Promise<JournalStats> {
  const { data } = await api.get<JournalStats>("/journal/stats");
  return data;
}

export async function fetchJournalEquityCurve(): Promise<JournalEquityPoint[]> {
  const { data } = await api.get<{ points: JournalEquityPoint[] }>("/journal/equity-curve");
  return Array.isArray(data?.points) ? data.points : [];
}

export async function fetchJournalCalendar(month?: number, year?: number): Promise<JournalCalendarDay[]> {
  const { data } = await api.get<{ days: JournalCalendarDay[] }>("/journal/calendar", { params: { month, year } });
  return Array.isArray(data?.days) ? data.days : [];
}

export async function fetchJournalGapReview(staleAfterDays = 30): Promise<JournalGapReview> {
  const { data } = await api.get<JournalGapReview>("/journal/gaps", {
    params: { stale_after_days: staleAfterDays },
  });
  return data;
}
