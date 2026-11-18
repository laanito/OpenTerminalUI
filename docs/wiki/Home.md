# OpenTerminalUI Wiki

OpenTerminalUI is a self-hosted research terminal for US/EU equities and crypto,
with intentional provider-gated NSE/BSE F&O support. **v2.8.0 — Durable news and
sentiment evidence** was published on 2026-11-18 from `61599bc` after release-prep
PR #284 passed all three CI jobs and merged. See the
[v2.8.0 release](https://github.com/laanito/OpenTerminalUI/releases/tag/v2.8.0).
The previous v2.7 release added filing-grounded comparison briefings.

v2.8 adds explicit saved comparison review, frozen-input reruns and current-data
refreshes as linked runs. Selected saved headlines retain independent text-tone
and asset-implication judgments; selected observations can inform a new checked
Deep interpretation. Standalone evidence defaults to 90 days, with saved-reference
protection and confirmed owner deletion. Home reconstructs approximate 30-day
ledger history. See [research workflows](Research-Workflows.md),
[Roadmap](Roadmap.md) and [release verification](Releasing.md#v280-verification-ledger-released).

Upgrade adds `0019_news_evidence` and `0020_comparison_captures`. Docker applies
Alembic before startup; existing local databases must upgrade. Legacy research
is preserved without news-score backfill. No new provider, dependency or embedding
change is required. Deployment belongs to the host agent. v3 targets a
Portfolio-first frontend overhaul after v2 close-out.

> **North star.** An open, private terminal that helps an individual invest *without being fooled* — by markets, by hype, or by themselves — through AI-native research you can grow privately. Bloomberg parity is pursued only "just enough to be credible"; the differentiation is being AI-native, private, open, and multi-asset. See the [Roadmap](Roadmap) for the full direction.

## Current Product Focus

- Terminal Noir shell (dark-first, dense UI, keyboard-first)
- GO Command Bar + ticker tape + market status bar
- Launchpad multi-panel workspace
- Security Hub (DES-style) for ticker-centric research
- DenseTable component for high-throughput market tables
- Chart workstation with crosshair sync, overlays, and volume profile
- Portfolio manager + multi-market screener + alerts/news sentiment
- Crypto fundamentals: tokenomics, on-chain TVL & fees, valuation ratios (CoinGecko + DefiLlama)
- Provider-agnostic Fast/Deep model profiles (Ollama default) for research synthesis,
  news sentiment, emotion and query classification
- User-selected cross-market comparisons with dated source, currency and coverage disclosures
- On-demand SEC source-filing checks for exact selected US facts
- Explicit comparison briefings with snapshot inspection, cancellation and
  visible evidence scope, explicit saved review and linked rerun/refresh; no automatic indexing
- Time-aware private Notes/Second Brain and saved Brain Log research memos
- Base-currency portfolio accounting with explicit partial results when FX is missing

## Quick Links

- [Getting Started](Getting-Started)
- [Features](Features)
- [Research Workflows](Research-Workflows) — comparisons/SEC checks, dated notes, saved answers and external ingestion
- [Architecture](Architecture)
- [Data Providers](Data-Providers)
- [Limitations](Limitations) — what works keyless vs. needs keys, and honest caveats
- [Contributing](Contributing)
- [Roadmap](Roadmap) — current release scope and later, unscheduled generation work
- [Releasing](Releasing) — how we cut a tagged release

## Smoke Routes

- `/equity/stocks`
- `/equity/security/:ticker`
- `/equity/launchpad`
- `/equity/chart-workstation`
- `/equity/compare`
- `/equity/market-context` (contextual comparison, distinct from chart Compare)
- `/equity/notes`
- `/equity/brain` (Second Brain and Brain Log)
- `/equity/journal`
- `/equity/screener`
- `/equity/portfolio?view=manager`
