# OpenTerminalUI Wiki

OpenTerminalUI is a terminal-first market analysis platform for US, EU, and crypto markets, with NSE/BSE F&O support.

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
- Local, provider-agnostic LLM (Ollama default) for AI insights, news sentiment & emotion

## Quick Links

- [Getting Started](Getting-Started)
- [Features](Features)
- [Architecture](Architecture)
- [Data Providers](Data-Providers)
- [Contributing](Contributing)
- [Roadmap](Roadmap)

## Smoke Routes

- `/equity/stocks`
- `/equity/security/:ticker`
- `/equity/launchpad`
- `/equity/chart-workstation`
- `/equity/compare`
- `/equity/screener`
- `/equity/portfolio?view=manager`
