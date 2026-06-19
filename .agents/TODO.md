# Fork TODO

## Done
- [x] **Postgres support** (branch `feat/postgres-support`): robust SQLite↔Postgres
      portability (see `postgres-notes.md`); Postgres default in docker-compose;
      `empyrical` → `empyrical-reloaded` (Python 3.12+ build fix).
- [x] **De-India providers + EU/crypto data & search** (PRs #5–#17):
      - Crypto via CoinGecko (search, charts, detail routing); India panel-gating.
      - `instrument_master` universe: US (Nasdaq Trader files) + EU (`pytickersymbols`)
        + crypto (CoinGecko), auto-seeded on boot + periodic refresh.
      - Search: accent-insensitive, relevance-ranked, live Yahoo fallback, and
        context-weighted by the active market selector (IN/US/EU/CRYPTO).
      - FE cut over to `/api/instruments/search`; legacy NSE `/search` retired.
      - EU/US quotes+charts work via Yahoo; foreign-suffix symbols skip the NSE path.
      - Default market is US/NASDAQ (already de-Indiad).

## Next — agreed order 3 → 4 → 1 → 2 (2026-06-19)
1. (do 3rd) **Local LLM: Ollama** — committed defaults still point at LM Studio
   (`:1234`, Gemma); we run Ollama (`host.docker.internal:11434`) via local `.env`.
   Make Ollama a first-class / committed option, not just a local override.
2. (do 4th) **EUR currency conversion** — `EUR` is selectable since PR #16 but
   price→EUR conversion isn't wired (no EUR FX rate in the converter).
3. (do 1st — IN PROGRESS) **Crypto realtime ticks** — EU+crypto have no
   `/ws/quotes` live feed (snapshot/polled only). A Binance WS client exists
   (`backend/realtime/binance_ws.py`, derivatives); wire live crypto spot prices.
4. (do 2nd) **Frontend audit** — half-made/weird UI parts flagged early on; APIs
   + search are solid now, so revisit usability.

## Deferred / nice-to-have
- [ ] Better key/config management (before any paid APIs). Long-deferred.
- [ ] Bump Docker base image from Python 3.11 → 3.12.
- [ ] F&O is still NSE-only (`backend/fno/...`); de-India later if needed.
- [ ] EU/crypto realtime depth/derivatives beyond spot ticks.
