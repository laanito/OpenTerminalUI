import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { addMonths, endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { fetchEconomicCalendar, fetchMacroIndicators } from "../../api/client";
import { TerminalPanel } from "../../components/terminal/TerminalPanel";
import { DegradedBanner } from "../../components/common/DegradedBanner";
import type { DegradedInfo } from "../../api/types";
import type { EconomicEvent, MacroIndicator } from "../../types";

export function EconomicTerminal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("tab") === "macro" ? "macro" : "calendar";
  const [month, setMonth] = useState(new Date());
  const [impacts, setImpacts] = useState(["high", "medium", "low", "unknown"]);
  const [selectedEvent, setSelectedEvent] = useState<EconomicEvent | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const start = format(startOfMonth(month), "yyyy-MM-dd"), end = format(endOfMonth(month), "yyyy-MM-dd");
  const calendar = useQuery({ queryKey: ["econ-calendar", start, end], queryFn: () => fetchEconomicCalendar(start, end), retry: false });
  const macro = useQuery({ queryKey: ["macro-indicators"], queryFn: () => fetchMacroIndicators(), refetchInterval: 600_000, retry: false });
  const events = useMemo(() => (calendar.data || []).filter(row => impacts.includes(row.impact)), [calendar.data, impacts]);
  const sample = calendar.data?.some(row => row.sample);
  useEffect(() => { setSelectedEvent(null); }, [start, impacts, calendar.data]);
  function changeView(tab: string) { const next = new URLSearchParams(searchParams); next.set("tab", tab); setSearchParams(next); }
  function select(event: EconomicEvent) { setSelectedEvent(event); requestAnimationFrame(() => detailRef.current?.focus()); }
  return <main aria-label="Economics" className="min-w-0 space-y-3 p-3 text-terminal-text [overflow-wrap:anywhere]">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-lg font-semibold">Economic terminal</h1><p className="text-sm text-terminal-muted">Calendar events and regional macro snapshots.</p></div><div role="group" aria-label="Economic view" className="flex flex-wrap gap-2">{["calendar", "macro"].map(tab => <button key={tab} aria-pressed={view === tab} onClick={() => changeView(tab)} className={`rounded border border-terminal-border px-3 py-2 text-sm ${view === tab ? "text-terminal-accent" : "text-terminal-muted"}`}>{tab === "calendar" ? "Calendar" : "Macro dashboard"}</button>)}</div></header>
    {view === "calendar" ? <>
      <section aria-label="Calendar scope" className="min-w-0 space-y-3 rounded border border-terminal-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-3"><button aria-label="Previous month" onClick={() => setMonth(value => subMonths(value, 1))} className="rounded border border-terminal-border p-2 text-sm">Previous</button><h2 className="text-sm font-semibold">{format(month, "MMMM yyyy")}</h2><button aria-label="Next month" onClick={() => setMonth(value => addMonths(value, 1))} className="rounded border border-terminal-border p-2 text-sm">Next</button></div><button onClick={() => void calendar.refetch()} disabled={calendar.isFetching} className="rounded border border-terminal-border p-2 text-sm">Refresh calendar</button></div>
        <fieldset className="flex min-w-0 flex-wrap gap-3"><legend className="mb-2 text-xs text-terminal-muted">Event impact</legend>{["high", "medium", "low", "unknown"].map(impact => <label key={impact} className="flex items-center gap-2 text-sm capitalize"><input type="checkbox" checked={impacts.includes(impact)} onChange={event => setImpacts(values => event.target.checked ? [...values, impact] : values.filter(value => value !== impact))}/>{impact}</label>)}</fieldset>
        <p className="text-xs text-terminal-muted">{start} to {end} · All supplied countries · {events.length} matching events. Dates and times are shown as supplied; no timezone conversion.</p>
      </section>
      {calendar.isFetching ? <p role="status" className="text-sm">Loading calendar…</p> : null}
      {calendar.isError ? <p role="alert" className="text-sm text-terminal-neg">Calendar could not be refreshed. Any displayed events are unrefreshed; retry manually.</p> : null}
      {sample ? <p role="status" className="rounded border border-terminal-warn p-3 text-sm text-terminal-warn">Sample calendar events — no live source is available for this response.</p> : null}
      <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-label="Calendar events" className="min-w-0 space-y-2"><h2 className="text-sm font-semibold">Events in {format(month, "MMMM yyyy")}</h2>
          {!events.length && !calendar.isFetching && !calendar.isError ? <p className="text-sm text-terminal-muted">{calendar.data?.length ? "No events match the selected impacts." : "No events returned for this month."}</p> : null}
          {events.map((event, index) => <button key={`${event.date}:${event.event_name}:${index}`} type="button" aria-pressed={selectedEvent === event} onClick={() => select(event)} className={`block w-full min-w-0 space-y-1 rounded border p-3 text-left ${selectedEvent === event ? "border-terminal-accent" : "border-terminal-border"}`}><span className="block text-sm font-semibold">{event.event_name}</span><span className="block text-xs text-terminal-muted">{event.date} {event.time || "Time unavailable"} · {event.country} · {event.impact} impact{event.sample ? " · Sample" : ""}</span></button>)}
        </section>
        <section ref={detailRef} tabIndex={-1} aria-label="Economic event details" className="min-w-0 rounded border border-terminal-border bg-terminal-panel p-3"><h2 className="text-sm font-semibold">Event details</h2>{selectedEvent ? <div className="mt-3 min-w-0 space-y-3"><h3 className="text-sm font-semibold text-terminal-accent">{selectedEvent.event_name}</h3><p className="text-xs text-terminal-muted">{selectedEvent.country} · {selectedEvent.date} {selectedEvent.time} · {selectedEvent.impact} impact{selectedEvent.sample ? " · Sample" : ""}</p><dl className="grid min-w-0 grid-cols-2 gap-3">{[["Actual", selectedEvent.actual], ["Forecast", selectedEvent.forecast], ["Previous", selectedEvent.previous], ["Unit", selectedEvent.unit || selectedEvent.currency]].map(([label, value]) => <div key={String(label)} className="min-w-0 rounded border border-terminal-border p-2"><dt className="text-xs text-terminal-muted">{label}</dt><dd className="mt-1 break-words font-mono text-sm">{value ?? "Unavailable"}</dd></div>)}</dl></div> : <p className="mt-3 text-sm text-terminal-muted">Select an event to inspect its actual, forecast and previous values.</p>}</section>
      </div>
    </> : <>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Regional macro snapshots</h2><button disabled={macro.isFetching} onClick={() => void macro.refetch()} className="rounded border border-terminal-border p-2 text-sm">Refresh macro</button></div>
      {macro.isFetching ? <p role="status" className="text-sm">Loading macro snapshots…</p> : null}{macro.isError ? <p role="alert" className="text-sm text-terminal-neg">Macro snapshots could not be refreshed. Any previous values are unrefreshed.</p> : null}
      <DegradedBanner info={(macro.data as Record<string, unknown> | undefined)?.degraded as DegradedInfo | undefined} className="!text-xs"/>
      {!macro.isFetching && !macro.isError && !Object.keys(macro.data || {}).filter(key => key !== "degraded").length ? <p className="text-sm">No regional macro snapshots returned.</p> : null}
      <div className="grid min-w-0 items-start gap-3 md:grid-cols-2 2xl:grid-cols-4">{Object.entries(macro.data || {}).filter(([region]) => region !== "degraded").map(([region, indicators]) => <TerminalPanel key={region} title={`${region.toUpperCase()} macro`}><div className="min-w-0 space-y-3">{Object.entries(indicators as Record<string, MacroIndicator>).map(([name, data]) => <article key={name} className="min-w-0 space-y-2 rounded border border-terminal-border p-3"><h3 className="text-sm font-semibold">{name.replace(/_/g, " ")}</h3><div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-lg">{data.value}%</p><p className="text-xs text-terminal-muted">Previous: {data.last_value}%</p></div><div aria-label={`${name.replace(/_/g, " ")} trend`} className="h-12 w-28 shrink-0"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.history || []}><Area type="monotone" dataKey="value" stroke="var(--ot-color-accent-primary)" fill="var(--ot-color-accent-primary)" fillOpacity={.12} isAnimationActive={false}/></AreaChart></ResponsiveContainer></div></div><p className="text-xs text-terminal-muted">As of {data.date}</p></article>)}</div></TerminalPanel>)}</div>
    </>}
  </main>;
}
