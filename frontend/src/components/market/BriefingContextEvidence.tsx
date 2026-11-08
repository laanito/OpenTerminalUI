import {
  CONTEXT_REASONS, CONTEXT_STATUS, safeContextUrl,
  type ContextEvidence, type ContextSection,
} from "../../api/comparisonContextBriefing";
import { TechnicalBriefingEvidence } from "./TechnicalBriefingEvidence";
import { FilingBriefingEvidence } from "./FilingBriefingEvidence";

const dateTime = (value: string) => new Date(value).toLocaleString();
const number = (value: number) => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 21 }).format(value);
export const contextName = (section: ContextSection) => section.kind === "headlines" ? "Dated headlines" : section.kind === "technical" ? "Technical observations" : section.kind === "fundamentals" ? "SEC filing facts" : section.region === "us" ? "US macro (FRED)" : "Euro-area macro (Eurostat/ECB)";
function SourceLink({ url, children }: { url: string; children: React.ReactNode }) {
  const safe = safeContextUrl(url);
  return safe ? <a className="break-words text-terminal-accent underline" href={safe} target="_blank" rel="noopener noreferrer">{children}</a> : <span>Source link unavailable</span>;
}
function SectionStatus({ section }: { section: ContextSection }) {
  return <>
    {section.kind === "fundamentals" && section.status === "empty" ? "No usable filing values" : CONTEXT_STATUS[section.status]}{section.reason ? ` · ${CONTEXT_REASONS[section.reason] ?? "Source unavailable"}` : ""}.
    {section.start_date ? ` Window ${section.start_date} to ${section.end_date}.` : " No context window was invented."}
    {section.retrieved_at ? ` Retrieved ${dateTime(section.retrieved_at)}.` : ""}
  </>;
}
export function ContextCoverage({ evidence, inspect }: { evidence: ContextEvidence; inspect: (ref: string) => void }) {
  return <section aria-label="Selected context coverage" className="space-y-2 rounded border border-terminal-border p-2 text-xs">
    <h3 className="font-semibold">Selected context coverage</h3>
    <p>{evidence.requested.technical || evidence.requested.fundamentals ? "Unavailable sources provide no values; they do not imply zero observations or absence of relevant events."
      : "Missing, empty or failed feeds do not establish that no news or relevant macro activity occurred."}</p>
    {evidence.sections.map((section) => <p key={section.citation_id} className={section.status === "available" ? "text-terminal-muted" : "text-terminal-warn"}>
      <button type="button" className="text-terminal-accent underline" onClick={() => inspect(section.citation_id)}
        aria-label={`Inspect ${section.citation_id} coverage`}>[{section.citation_id}] {section.pair_citation_id} · {contextName(section)}</button>
      {" "}<SectionStatus section={section} />
    </p>)}
  </section>;
}
export function ContextEvidenceSections({ evidence, id }: { evidence: ContextEvidence; id: string }) {
  const target = (ref: string) => ({ id: `${id}-${ref}`, tabIndex: -1, "aria-label": `${ref} evidence`,
    className: "space-y-1 break-words rounded border-t border-terminal-border p-2 focus:outline focus:outline-terminal-accent" });
  return <>{evidence.sections.map((section) => <section key={section.citation_id} {...target(section.citation_id)}>
    <h3 className="font-semibold">{section.citation_id}: {contextName(section)} · {section.pair_citation_id}</h3>
    <p><SectionStatus section={section} /></p>
    {section.kind === "headlines" ? <>
      <p>Current keyless feeds, not a complete historical archive or verified article bodies. Fetch cap {section.fetch_limit_per_symbol ?? "unavailable"} per symbol; at most {evidence.news_limit_per_symbol} projected headlines per symbol.</p>
      {section.groups.map((group) => <section key={group.citation_id} {...target(group.citation_id)}>
        <h4 className="font-semibold">{group.citation_id}: {group.symbol} · {group.status === "feed_error" ? "Feed failed" : group.status === "no_matches" ? "No valid dated matches returned" : "Available headlines"}</h4>
        <p>Examined {group.examined_count}; matched {group.matched_count}; upstream returned {group.returned_headline_count} (display cap {group.upstream_display_limit}); included {group.headlines.length}. Withheld invalid {group.withheld_invalid_count}, duplicate {group.withheld_duplicate_count}.</p>
        {group.headlines.map((headline) => <section key={headline.citation_id} {...target(headline.citation_id)}>
          <h5 className="font-semibold">{headline.citation_id}: {headline.title}</h5>
          <p>{headline.source} · published {dateTime(headline.published_at)}{headline.title_truncated ? " · Title truncated to 600 characters" : ""}.</p>
          <SourceLink url={headline.url}>Open source headline</SourceLink>
        </section>)}
      </section>)}
    </> : section.kind === "technical" ? <TechnicalBriefingEvidence section={section} target={target} />
      : section.kind === "fundamentals" ? <FilingBriefingEvidence section={section} target={target} /> : <>
      <p>Explicitly selected {section.region === "us" ? "US" : "euro-area"} global context, not ticker attribution. Current-at-retrieval vintage{section.realtime_date ? ` · FRED real-time view ${section.realtime_date}` : ""}. Reference periods are not publication dates and do not establish past knowledge.</p>
      {section.series.map((series) => <section key={series.citation_id} {...target(series.citation_id)}>
        <h4 className="font-semibold">{series.citation_id}: {series.label} · {series.status.replace(/_/g, " ")}</h4>
        <p>{series.title ?? series.series_id} · {series.source.toUpperCase()} · {series.units ?? "Unknown units"} · {series.frequency ?? "Unknown frequency"}.</p>
        <p>Returned {series.returned_observation_count}; included {series.observations.length} (cap {evidence.macro_limit_per_series}).
          {series.upstream_matched_count !== null ? ` Upstream matched ${series.upstream_matched_count}.` : ""}
          {series.withheld_conflict_count !== null ? ` Conflicting observations withheld ${series.withheld_conflict_count}.` : ""}</p>
        <SourceLink url={series.source_url}>Open official series</SourceLink>
        {series.observations.length ? <ul className="list-disc space-y-1 pl-5" aria-label={`${series.citation_id} reference-period observations`}>
          {series.observations.map((item) => <li key={item.reference_date}>{item.reference_date}: {number(item.value)} {series.units}{item.flag ? ` · source flag ${item.flag}` : ""}</li>)}
        </ul> : <p>No values included; this is not a zero observation.</p>}
      </section>)}
    </>}
  </section>)}</>;
}
