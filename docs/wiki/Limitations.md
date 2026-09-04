# What works out of the box (and what needs keys)

A core principle of this fork is **integrity over feature count**: nothing
fabricated is ever presented as live. When a feature has no live source — because
a key is missing, a provider is rate-limited, or no free feed exists — the API
returns an empty result with a `degraded` marker and the UI shows a banner. This
page is the honest map of what you get keyless, what unlocks with a key, and where
the genuine gaps are.

## Out-of-the-box vs. needs-keys

"Keyless" means no paid/provider API key is required. Local AI still requires a
running compatible model service, and all network-backed features remain subject
to upstream availability and rate limits.

| Area | Keyless (out of the box) | Add a key for | Without the key |
|---|---|---|---|
| **Charts & quotes** (US / EU / crypto) | ✅ Yahoo; CoinGecko + Binance for crypto | — | n/a — works keyless |
| **Symbol search** | ✅ seeded `instrument_master` (US/EU/crypto) + Yahoo long-tail fallback | — | n/a |
| **Fundamentals / financials / earnings** | partial via Yahoo | `FMP_API_KEY` — full US fundamentals, estimates, profiles | reduced coverage, labelled where empty |
| **Real-time US ticks** | delayed / polled quotes | `FINNHUB_API_KEY` — live WebSocket ticks | delayed quotes (not fabricated) |
| **Macro indicators / yield curve / 2s10s** | — | `FRED_API_KEY` — live US/EU/China series | degraded banner (no fabricated curve) |
| **Economic calendar** | labelled **sample** fallback | _(no free live source today)_ | sample events, flagged `sample: true` |
| **Commodities** | — | `FMP_API_KEY` | degraded banner |
| **Dividends calendar / history** | ✅ Yahoo (`events=div`) + FMP when keyed | `FMP_API_KEY` enriches | works keyless via Yahoo |
| **Crypto fundamentals** (tokenomics, TVL, fees) | ✅ CoinGecko + DefiLlama (both keyless) | — | n/a |
| **AI briefings / Interrogate** | local **Ollama** (no hosted key; a running model is required) | `LLM_API_KEY` only for *hosted* providers (OpenAI/OpenRouter/…) | retrieval and deterministic fallbacks remain; synthesis is labelled unavailable when no model can answer |
| **News AI sentiment / emotion** | ✅ local **Ollama**, invoked on demand for News sentiment | `LLM_API_KEY` only for hosted providers | classical lexical/FinBERT fallback, clearly labelled |
| **Second brain (RAG)** | local embeddings through Ollama `nomic-embed-text`, with an installed `sentence-transformers` fallback | hosted embedding model (optional) | retrieval degrades explicitly if neither local embedding path is available |
| **India NSE/BSE F&O** (real-time + historical) | — | `KITE_API_KEY` / `KITE_API_SECRET` / `KITE_ACCESS_TOKEN` | degraded banner |
| **Scheduled report email delivery** | reports still generate + download on demand | `SMTP_*` config | email delivery skipped (not an error) |

See [Data Providers](Data-Providers) for per-provider rate limits, SLAs, and the
fallback waterfall, and the README's *Environment Variables* table for every
variable.

## Limitations & honest caveats

These are deliberate, documented boundaries after the **v1.4 surface audit**.
Primary navigation contains only supported or explicitly configuration-gated
destinations. Experimental and compatibility-only routes can still be reached
through contextual links or old bookmarks, but are not advertised as stable
products. Missing data is surfaced with a degraded banner or explicit label,
never silently faked.

- **No live economic-calendar source.** The calendar ships a labelled **sample**
  fallback. Finnhub's calendar is premium-only and FMP's free quota depletes fast;
  a free/cheap forward feed is a tracked backlog item.
- **Dividend forward dates are estimates.** For regular distributors with no free
  forward calendar, the next ex-date is *projected* from historical cadence and
  labelled `Estimated` — treat it as a projection, not a confirmed date.
- **Macro / yield curve / commodities need keys.** Without `FRED_API_KEY` (macro,
  curve) or `FMP_API_KEY` (commodities) these show a degraded banner rather than
  any value.
- **Empty data products are hidden from primary navigation.** Relative Strength,
  Bonds screening, Hotlists/movers, standalone Insider Activity, and standalone
  Tape/Time & Sales retain compatibility URLs and APIs, but remain empty and
  degraded until genuine computations or feeds exist. They are not stable v1
  product promises.
- **ETF Analytics is intentionally partial.** Keyless Yahoo holdings and overlap
  analysis are supported, while the flows panel remains degraded because no
  production fund-flow provider is connected. The useful product remains in
  primary navigation; the unavailable panel is labelled in place.
- **US / EU equity Level-2 depth has no free source.** The order book shows empty
  + `degraded` for US/EU equities (India has real depth via Kite). A future
  subscribed provider such as Interactive Brokers is a possible future adapter,
  not a committed or configured v1 source.
- **Crypto 24h liquidations read 0** until the Binance `forceOrder` WebSocket
  runner is wired (there's no REST endpoint); the response is flagged
  `no_live_source`. Crypto order-book depth, funding, and open interest *are* real.
- **Index detail is index-aware, not equity-shaped.** A market index (`^GSPC`,
  `^NSEI`, …) shows price / chart / performance + notes; issuer fundamentals
  (P/E, financials, peers, shareholding) are intentionally hidden because they
  don't apply to an index.
- **Several retained tools are compatibility-only.** OMS is a user-scoped,
  quote-backed simulator, not broker execution, and it does not update Paper
  portfolios. Ops shows measured system state only; global restricted-list and
  kill-switch mutations require an administrator. Plugins execute trusted host
  Python and are administrator-only, with no marketplace or remote installation.
  Cockpit remains an empty/degraded legacy aggregator. These pages are hidden
  from primary discovery.
- **Model Lab and Portfolio Lab are not owner-scoped.** Their definitions and
  runs are installation-wide, so the direct routes remain hidden compatibility
  surfaces with warnings. The supported Backtesting page is separate and stays
  in primary navigation.

## Where configuration lives

Market-data and hosted-model credentials are deployment secrets configured by
the host operator in `.env` or the service environment. The in-app Settings page
documents the principal gates, but intentionally does not accept or persist
provider secrets in the browser. In particular:

- `FRED_API_KEY` unlocks live macro indicators and yield-curve series.
- `FMP_API_KEY` unlocks commodities and broadens US fundamentals coverage.
- `FINNHUB_API_KEY` unlocks live US WebSocket ticks.
- `KITE_API_KEY`, `KITE_API_SECRET`, and `KITE_ACCESS_TOKEN` unlock supported
  India NSE/BSE F&O and depth workflows.

The **Automation API Keys** section creates application credentials for scoped
external clients, including deliberate note ingestion. Those keys do not
configure or proxy market-data providers.

## Upgrade notes

- **pgvector Postgres image (second-brain RAG).** Docker now uses
  `pgvector/pgvector:0.8.3-pg16-trixie` instead of a plain `postgres:16` image so
  the RAG store can `CREATE EXTENSION vector` on startup. It's the **same major
  version (pg16)** — swapping the image needs **no dump/restore**, and the data
  volume is compatible. On plain `postgres:16` the extension create fails and the
  brain falls back to in-process numpy cosine. SQLite users are unaffected (always
  numpy cosine).
