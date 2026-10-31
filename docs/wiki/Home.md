# OpenTerminalUI Wiki

OpenTerminalUI is a self-hosted research terminal for US/EU equities and crypto,
with intentional provider-gated NSE/BSE F&O support. **v2.4.0 — Task-appropriate
models** is in release preparation: explicit Fast/Deep routing, consistent
model identity/deadlines and conditional comparison interpretations. Existing
single-model configuration remains supported; Deep is optional, embeddings
are unchanged and no manual database migration is required. Host evaluation
and consolidated local checks passed; release-prep CI/merge and publication
remain pending. The latest published release is
[v2.3.0](https://github.com/laanito/OpenTerminalUI/releases/tag/v2.3.0), from
2026-10-28, adding opt-in dated news and US/euro-area macro briefing context.
Reference checks do not certify model reasoning. See [Roadmap](Roadmap.md)
and [Releasing](Releasing.md).

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
- [Roadmap](Roadmap) — released v2.2 scope and later, unscheduled generation work
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
