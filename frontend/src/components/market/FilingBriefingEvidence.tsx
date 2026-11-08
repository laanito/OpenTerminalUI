import type { HTMLAttributes } from "react";
import { FILING_CONCEPTS, FILING_REASONS, type ContextFilingSection } from "../../api/filingContext";

const number = (value: number) => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 21 }).format(Object.is(value, -0) ? 0 : value);
const statuses = { available: "Available filing facts", partial: "Partial filing coverage", empty: "No usable filing values", unavailable: "SEC evidence unavailable" };
export function FilingBriefingEvidence({ section, target }: {
  section: ContextFilingSection; target: (ref: string) => HTMLAttributes<HTMLElement>;
}) {
  return <>
    <p>Current SEC Company Facts, not independently checked filing-instance values. Filed dates are not verified publication instants. Historical investor knowledge and revision order are not established.</p>
    {!section.assets.length ? <p>No filing evidence was fetched without a shared price window.</p> : null}
    {section.assets.map((asset) => <section key={asset.citation_id} {...target(asset.citation_id)}>
      <h4 className="font-semibold">{asset.citation_id}: {asset.symbol} · {statuses[asset.status]}</h4>
      {asset.reason ? <p className="text-terminal-warn">{FILING_REASONS[asset.reason] ?? "SEC evidence unavailable"}. This is not a zero value or proof that no filings exist.</p> : null}
      {asset.snapshot ? <>
        <p>SEC CIK {asset.snapshot.cik ?? "unresolved"} · filed-date window {asset.snapshot.filed_start} to {asset.snapshot.filed_end}.</p>
        <p>Terminal retrieval: {new Date(asset.snapshot.retrieved_at).toLocaleString()}. The provider client may use a cached aggregate; this is not a filing publication time.</p>
        <p>Matched facts {asset.snapshot.matched_fact_count}; groups {asset.snapshot.matched_group_count}; shown {asset.snapshot.groups.length}; omitted groups {asset.snapshot.omitted_group_count}; conflicting groups {asset.snapshot.conflicting_group_count}. Output caps: {asset.snapshot.group_limit} groups, {asset.snapshot.disclosure_limit} disclosures per group.</p>
        <p className="text-terminal-warn">Fiscal periods measure business activity. Concepts and durations remain separate; later accessions do not automatically replace earlier ones.</p>
        {!asset.snapshot.groups.length && asset.status !== "unavailable" ? <p>No matching facts in the supported concepts and filed-date window. This does not establish absence of financial data.</p> : null}
        {asset.snapshot.groups.map((group) => {
          const ref = asset.group_citations[group.citation_id];
          return <section key={ref} {...target(ref)}>
            <h5 className="font-semibold">{ref}: {FILING_CONCEPTS[group.concept].label}</h5>
            {group.status === "available" && group.value !== null ? <p className="text-sm font-semibold">{number(group.value)} {group.unit}</p>
              : <p className="text-terminal-warn">Value withheld · {group.status === "conflicting_values" ? "Conflicting reported values" : "Conflicting filing metadata"}. No winner was selected and no zero value is implied.</p>}
            <p>Concept: {group.taxonomy}:{group.concept} · unit {group.unit}.</p>
            <p>Fiscal period: {group.period_start} to {group.period_end}. These dates describe the reported activity, not its publication.</p>
            <p>Distinct values {group.distinct_value_count}; disclosure identities {group.disclosure_count}; shown {group.disclosures.length}; omitted disclosures {group.omitted_disclosure_count}.</p>
            <ul className="list-disc space-y-2 pl-5" aria-label={`${ref} filing disclosures`}>
              {group.disclosures.map((disclosure) => <li key={`${disclosure.accession}-${disclosure.form}-${disclosure.filed_date}`}>
                <p>{disclosure.form} · filed {disclosure.filed_date} · accession <span className="break-all">{disclosure.accession}</span>.</p>
                <a className="text-terminal-accent underline" href={disclosure.filing_url} target="_blank" rel="noopener noreferrer">Open SEC filing index</a>
              </li>)}
            </ul>
          </section>;
        })}
        <p className="break-all text-terminal-muted">Filing snapshot ID: {asset.snapshot.packet_id}</p>
        {asset.snapshot.source_records_id ? <p className="break-all text-terminal-muted">Eligible-records ID: {asset.snapshot.source_records_id}</p> : null}
        <p>The snapshot hash is an identity, not a signature or independent source verification.</p>
      </> : <p>No SEC snapshot was retained for this asset. Inspect its coverage reason; missing evidence is not zero.</p>}
    </section>)}
  </>;
}
