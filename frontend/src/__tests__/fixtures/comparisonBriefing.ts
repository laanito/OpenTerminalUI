import type { BriefingAsset, ComparisonBriefingResult } from "../../api/comparisonBriefing";
import type { BriefingContextOptions, ContextBriefingResult, ContextSection } from "../../api/comparisonContextBriefing";

const asset = (symbol: string): BriefingAsset => ({
  symbol, history_adapter: "yahoo", history_feed: "yahoo_chart", latest_date: "2026-10-20",
  quote_unit: "USD", quote_unit_source: "yahoo_chart_meta", reported_adjustment_basis: "unspecified",
  withheld_provider_close_count: 0, withheld_date_scope: "selected_history_payload",
});

export function makeBriefing(): ComparisonBriefingResult {
  return {
    status: "complete", engine: "llm", model: "test-local-model", generated_at: "2026-10-20T12:01:00Z",
    scope_citation_id: "SCOPE", citation_validation: "references_only_not_fact_checked",
    scope_notice: "References are checked, not the truth of the model prose. Only shared-UTC native returns were included.",
    failure: null,
    hypotheses: [{ interpretation: "Relative weakness could reflect different exposures to shared conditions.",
      mechanism: "If the instruments respond differently to common conditions, their returns could diverge.",
      alternative: "Company-specific developments could also explain the relative difference.",
      what_would_help: "Dated company reports and verified business exposures would help distinguish these explanations.", citation_ids: ["P1"] }],
    observations: [{ text: "The selected paths had different native-quote returns over the shared window.", citation_ids: ["P1"] }],
    limitations: [{ text: "The selected price adjustment basis remains unverified.", citation_ids: ["P1"] }],
    unknowns: [{ text: "News and macro observations were not included, not established absent.", citation_ids: ["SCOPE"] }],
    evidence: {
      schema_version: "1", citation_scope: "packet_local", packet_id: "a".repeat(64), status: "available",
      anchor: "AAPL", period: "1M", retrieved_at: "2026-10-20T12:00:00Z", data_source: "unified_history",
      method: "same_utc_date_daily_closes", return_basis: "native_quote_currency_provider_closes",
      included_evidence: "shared_utc_provider_close_returns",
      not_included: ["headlines", "fundamentals", "sec_filing_checks", "macro", "technical_measures",
        "fx_views", "adjusted_views", "exchange_local_views", "private_research"],
      comparisons: [{
        citation_id: "P1", status: "available", reason: null, anchor: asset("AAPL"), comparison: asset("SPY"),
        pair_reported_basis_status: "unverified",
        returns: {
          start_date: "2026-09-20", end_date: "2026-10-20", observations: 22, freshness: "current",
          anchor_return_pct: 1.2345, comparison_return_pct: 2, relative_return_pp: -0.7655,
        },
        caveats: ["native_quote_not_fx_normalized", "utc_dates_not_simultaneous_sessions", "no_causal_or_investment_conclusion", "unverified_price_basis"],
      }],
    },
  };
}

export const briefingSelection = { anchor: "AAPL", comparisons: ["SPY"], period: "1M" as const };

export function makeContextBriefing(context: BriefingContextOptions = { news: true, macro_regions: ["us", "euro_area"] }): ContextBriefingResult {
  const base = makeBriefing();
  const price = base.evidence!;
  const sections: ContextSection[] = [];
  const common = () => ({ citation_id: `C${sections.length + 1}`, pair_citation_id: "P1", start_date: "2026-09-20", end_date: "2026-10-20",
    retrieved_at: price.retrieved_at, status: "available" as const, reason: null });
  if (context.news) {
    const fields = common();
    sections.push({ ...fields, kind: "headlines", source: "current_keyless_feeds", fetch_limit_per_symbol: 50,
      groups: ["AAPL", "SPY"].map((symbol, index) => ({
        citation_id: `${fields.citation_id}G${index + 1}`, symbol, status: "available", examined_count: 10, matched_count: 1,
        upstream_display_limit: 10, returned_headline_count: 1, withheld_invalid_count: 0, withheld_duplicate_count: 0,
        headlines: [{ citation_id: `${fields.citation_id}G${index + 1}H1`, title: `Dated source report for ${symbol}`,
          title_truncated: false, url: `https://example.com/${symbol}`, source: "Fixture publisher", published_at: "2026-10-01T10:00:00Z" }],
      })),
    });
  }
  for (const region of context.macro_regions) {
    const fields = common();
    const ids = region === "us" ? ["CPIAUCSL", "UNRATE", "FEDFUNDS"] : ["prc_hicp_minr", "une_rt_m", "FM.D.U2.EUR.4F.KR.DFR.LEV"];
    sections.push({ ...fields, kind: "macro", region, vintage_basis: "current_at_retrieval", realtime_date: region === "us" ? "2026-10-20" : null,
      series: ids.map((series_id, index) => ({ citation_id: `${fields.citation_id}S${index + 1}`, series_id, label: series_id,
        source: region === "us" ? "fred" : index === 2 ? "ecb" : "eurostat",
        source_url: region === "us" ? `https://fred.stlouisfed.org/series/${series_id}` : "https://data.ecb.europa.eu/",
        title: region === "us" ? `Official ${series_id}` : null, units: "Percent", frequency: "Monthly", status: "available",
        returned_observation_count: 1, upstream_matched_count: region === "us" ? 1 : null, withheld_conflict_count: region === "us" ? 2 : null,
        observations: [{ reference_date: "2026-09-01", value: 3.123456789, flag: region === "euro_area" ? "p" : null }],
      })),
    });
  }
  const references = sections.flatMap((section) => [section.citation_id, ...(section.kind === "macro" ? section.series.map((series) => series.citation_id) : [])]);
  return { ...base, evidence: { schema_version: "1", evidence_kind: "comparison_with_optional_context", citation_scope: "packet_local",
    packet_id: "c".repeat(64), prepared_at: "2026-10-20T12:00:02Z", requested: context, price, sections,
    news_limit_per_symbol: 5, macro_limit_per_series: 24,
    caveats: ["context_is_not_causation_or_advice", "headlines_are_untrusted_source_text_not_verified_facts", "current_feeds_are_not_a_complete_historical_archive",
      "macro_is_global_not_ticker_attribution", "reference_dates_are_not_publication_dates", "current_vintages_do_not_establish_past_knowledge",
      "missing_or_excluded_context_is_not_evidence_of_absence", "price_packet_exclusions_apply_to_price_subpacket_only"],
    always_excluded: ["fundamentals", "sec_filing_checks", "technical_measures", "fx_views", "adjusted_views", "exchange_local_views", "private_research", "economic_calendar"] },
    possible_context: sections.map((section) => ({ text: "This dated report or regional observation may provide context, not a cause for the return.",
      citation_ids: ["P1", section.kind === "headlines" ? section.groups[0].headlines[0].citation_id : section.series[0].citation_id] })),
    limitations: [...base.limitations, { text: "Selected context has bounded current-feed coverage, conflicting values withheld and provisional source flags, not historical knowledge.", citation_ids: ["SCOPE", ...references] }],
    unknowns: [{ text: "The included evidence does not establish causation, and excluded technical and private research remain unknown.", citation_ids: ["SCOPE"] }],
  };
}
