# Changelog

All notable changes to this fork are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
adopt [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from `1.0.0`.

## [Unreleased] — targeting 1.0.0 (Stable)

The first tagged release. A hardening milestone: a coherent, honest, installable
product. See `docs/wiki/Roadmap.md` → *Release plan* for the remaining 1.0
checklist (silent-mock audit, portfolio classification, de-India defaults, 429
backoff, version reconcile, docs).

### Added
- **Private second brain (RAG)** — flagship: ask-anything research grounded only
  in your own writing (journal, theses, position/transaction notes), with inline
  citations; provider-agnostic embeddings (Ollama `nomic-embed-text` default,
  `sentence-transformers` fallback) and a dialect-aware vector store (pgvector on
  Postgres, numpy cosine on SQLite). `POST /api/brain/ask|reindex`, `GET
  /api/brain/status` + a Second Brain page.
- **Generic notes capture** — one-step note capture anywhere (stock/crypto detail,
  watchlist rows, news, Portfolio Lab, Notes hub) feeding the second brain.
- **Crypto fundamentals** — tokenomics + on-chain TVL/fees (CoinGecko + keyless
  DefiLlama); `GET /api/v1/crypto/fundamentals/{symbol}`.
- **EUR display currency** — cross-rates-driven, instrument-currency-aware display
  engine (USD/EUR/INR) with correct per-currency symbol/locale/compaction.
- **Dividend calendar (real data)** — market-agnostic calendar/history/aristocrats/
  income via the corporate-actions service (Yahoo chart `events=div` + FMP), with
  labelled next-ex-date projections for regular distributors.
- **Scheduled reports + PDF generation backend**; **provider-agnostic LLM layer**
  (OpenAI-compatible, Ollama default); **economic data terminal** (calendar +
  macro dashboard).

### Changed
- **Postgres-first** persistence (SQLite opt-in); pgvector Postgres image
  (`pgvector/pgvector:0.8.3-pg16-trixie`, no migration).
- **De-India data layer** — unified `instrument_master` (US/EU/crypto sources),
  accent-insensitive search, EU Yahoo-suffix routing; market-overview/ticker-tape
  show US indices. NSE/BSE F&O stays supported.
- **FMP responses cached** in the shared multi-tier cache (incl. persistent SQLite
  L3) to stop free-tier quota burn; 429/5xx never cached.

### Fixed
- Full FE↔backend API audit (`/v1/...` path/shape mismatches; unmounted economics
  router; shadowed watchlist-items route).
- Ticker tape: real commodity values (GC=F/SI=F/CL=F were missing from the fetch
  list → permanent mock), clickable duplicate scroll segment, correct index/Nikkei
  link symbols.
- Economic calendar always-empty (FE read `data.items`; backend returns a bare
  array) + de-India macro config and labelled `sample` fallback.
- Portfolio: correlation 500 on duplicate-ticker lots; display-currency on the
  movement axis and holdings table; `BTC-EUR` resolved as EUR (not USD) by reading
  the crypto pair's quote leg.

---

_Pre-fork upstream history is not tracked here; this changelog begins with the
fork's road to 1.0._
