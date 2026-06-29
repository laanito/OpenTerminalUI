# What works out of the box (and what needs keys)

A core principle of this fork is **integrity over feature count**: nothing
fabricated is ever presented as live. When a feature has no live source — because
a key is missing, a provider is rate-limited, or no free feed exists — the API
returns an empty result with a `degraded` marker and the UI shows a banner. This
page is the honest map of what you get keyless, what unlocks with a key, and where
the genuine gaps are.

## Out-of-the-box vs. needs-keys

"Keyless" features work on a fresh clone with no API keys configured.

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
| **AI insights / news emotion / briefings** | ✅ local **Ollama** (keyless, on-device) | `LLM_API_KEY` only for *hosted* providers (OpenAI/OpenRouter/…) | lexical/FinBERT fallback when LLM off/unreachable |
| **Second brain (RAG)** | ✅ local embeddings (Ollama `nomic-embed-text`, or `sentence-transformers` fallback) | hosted embedding model (optional) | n/a — runs fully local |
| **India NSE/BSE F&O** (real-time + historical) | — | `KITE_API_KEY` / `KITE_API_SECRET` / `KITE_ACCESS_TOKEN` | degraded banner |
| **Scheduled report email delivery** | reports still generate + download on demand | `SMTP_*` config | email delivery skipped (not an error) |

See [Data Providers](Data-Providers) for per-provider rate limits, SLAs, and the
fallback waterfall, and the README's *Environment Variables* table for every
variable.

## Limitations & honest caveats

These are deliberate, documented gaps as of **v1.0.0** — not bugs. Each is
surfaced in-UI (degraded banner or explicit label), never silently faked.

- **No live economic-calendar source.** The calendar ships a labelled **sample**
  fallback. Finnhub's calendar is premium-only and FMP's free quota depletes fast;
  a free/cheap forward feed is a tracked backlog item.
- **Dividend forward dates are estimates.** For regular distributors with no free
  forward calendar, the next ex-date is *projected* from historical cadence and
  labelled `Estimated` — treat it as a projection, not a confirmed date.
- **Macro / yield curve / commodities need keys.** Without `FRED_API_KEY` (macro,
  curve) or `FMP_API_KEY` (commodities) these show a degraded banner rather than
  any value.
- **Relative Strength is a degraded stub.** Every `/rs/*` endpoint returns
  empty + `degraded`; the real IBD-style RS computation is a post-1.0 follow-up.
  (It previously served fabricated Indian data — that's been removed.)
- **Degraded stubs awaiting a real source.** These surfaces have no live feed wired
  yet and return empty + `degraded`: **Bonds / fixed income**, **Hotlists /
  movers**, **Insider trades** (pipeline ready, feed missing), **ETF screener &
  fund flows** (ETF *holdings/overlap* do work via Yahoo), **Tape / Time & Sales**.
- **US / EU equity Level-2 depth has no free source.** The order book shows empty
  + `degraded` for US/EU equities (India has real depth via Kite). A future
  Interactive Brokers adapter is the planned L2 source (v1.1).
- **Crypto 24h liquidations read 0** until the Binance `forceOrder` WebSocket
  runner is wired (there's no REST endpoint); the response is flagged
  `no_live_source`. Crypto order-book depth, funding, and open interest *are* real.
- **Index detail is index-aware, not equity-shaped.** A market index (`^GSPC`,
  `^NSEI`, …) shows price / chart / performance + notes; issuer fundamentals
  (P/E, financials, peers, shareholding) are intentionally hidden because they
  don't apply to an index.

## Upgrade notes

- **pgvector Postgres image (second-brain RAG).** Docker now uses
  `pgvector/pgvector:0.8.3-pg16-trixie` instead of a plain `postgres:16` image so
  the RAG store can `CREATE EXTENSION vector` on startup. It's the **same major
  version (pg16)** — swapping the image needs **no dump/restore**, and the data
  volume is compatible. On plain `postgres:16` the extension create fails and the
  brain falls back to in-process numpy cosine. SQLite users are unaffected (always
  numpy cosine).
