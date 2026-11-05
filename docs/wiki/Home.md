# OpenTerminalUI Wiki

OpenTerminalUI is a self-hosted research terminal for US/EU equities and crypto,
with intentional provider-gated NSE/BSE F&O support. **v2.6.0 — Technical context
across AI research** was published on 2026-11-05 from `fccb6b3` after release PR
#256 passed all three CI jobs and merged. The maintainer authorized publication.

The same three inspectable observations now reach Investment Briefing,
Interrogate, optional Brain symbol scope and selected portfolio holdings. Brain
Log retains captured evidence without automatically indexing it. The maintainer
confirmed the Brain fix and Portfolio workflow; structural/reference checks do
not certify model reasoning or source quality. See [v2.6.0](https://github.com/laanito/OpenTerminalUI/releases/tag/v2.6.0),
[Roadmap](Roadmap.md) and the [verification ledger](Releasing.md#v260-verification-ledger-released).

Upgrade includes nullable JSON migration `0018_brain_technical_context`; Docker
applies Alembic before startup, while existing local databases must upgrade.
Old memos are preserved without backfill. No new provider, indicator, dependency
or embedding change is required. Deployment belongs to the host agent.

The previous release, [v2.5.0](https://github.com/laanito/OpenTerminalUI/releases/tag/v2.5.0),
was published on 2026-11-02 from `fad1c95` and introduced comparison technical
context. [v2.4.0](https://github.com/laanito/OpenTerminalUI/releases/tag/v2.4.0)
introduced Fast/Deep model profiles, which remain unchanged. See the
[technical workflow](Technical-Context.md).

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
  visible evidence scope; no automatic saving/indexing
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
