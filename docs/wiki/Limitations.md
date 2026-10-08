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
| **Economic calendar** | legacy page has a labelled **sample** fallback; comparison context is unavailable without live data | `FINNHUB_API_KEY` or `FMP_API_KEY` enables live-provider attempts, subject to access and availability | legacy samples stay labelled; comparison never uses them |
| **Commodities** | — | `FMP_API_KEY` | degraded banner |
| **Dividends calendar / history** | ✅ Yahoo (`events=div`) + FMP when keyed | `FMP_API_KEY` enriches | works keyless via Yahoo |
| **Portfolio FX accounting** | ✅ Yahoo daily FX, with Finnhub fallback when configured | `FINNHUB_API_KEY` improves fallback availability | unavailable conversions become partial; parity is never assumed |
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

- **No dependable live economic-calendar source yet.** The legacy calendar can
  show a labelled **sample** fallback. The comparison panel instead attempts
  configured Finnhub/FMP feeds and reports failure without showing samples.
  Host testing encountered a provider failure with configured keys; validating
  provider access and finding a reliable source are tracked, unscheduled work.
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
- **Cross-market comparison is experimental and price-only.** The read-only
  comparison API aligns each selected proxy with an anchor on common UTC daily
  close dates and exposes stale, missing, and insufficient-overlap states. It
  returns native-quote percentage moves, without FX normalization or a claim
  that one market caused another to move. The response identifies the selected
  history path for each symbol, including adapter failover. Crypto and Yahoo
  adapters and the direct FMP fallback report their per-request feed. The Alpaca
  comparison path requests raw bars and reports its selected bar feed and raw
  adjustment even if other Alpaca workflows use configured adjustments; other
  adapter internals remain unknown unless reported. A known feed is not a quality
  guarantee. Crypto/Yahoo adapters retain reported actions and adjusted closes
  from the selected chart, aligned to rows they accepted; missing metadata is
  still unavailable and adjustment quality is not audited. The direct FMP
  comparison fallback uses its non-split-adjusted EOD feed only when it returns
  usable rows; credentials, plan, symbol coverage, and raw-price quality are
  not guaranteed. The primary API now labels returns as native-quote provider
  closes, not universally unadjusted prices: Alpaca raw and FMP non-split-
  adjusted are reported request bases, while other paths remain unspecified.
  Mixed-basis pairs are still descriptive, not decision-grade. A contextual browser page opens
  from equity and crypto research and offers dated comparison, symbol
  suggestions, and an inspectable pairwise path rebased to 100 on the first
  shared close. The path plots only actual shared dates, with no interpolation.
  An optional reporting-currency result uses only the shared start/end closes
  and historical FX rates when both selected Yahoo chart quote units are
  supported currencies. It discloses four dated rates and withholds results for
  unknown/subunit units or missing rates. This is not a converted daily path,
  verified currency denomination, or adjusted/portfolio performance.
  A separate inspectable FX-converted indexed path is available only with
  rates on every original shared date. Missing interior rates withhold the
  full path without dropping dates, even if endpoint returns remain available;
  provider-close adjustment and exchange-session accuracy remain unverified.
  The optional endpoint breakdown separates native price, FX-rate, and their
  multiplicative interaction using the same four observed rates. It does not
  identify economic causes or make mixed provider price bases comparable.
  Conflicting closes for the same UTC date within the selected chart payload
  are withheld from the relevant provider or Yahoo-adjusted series, with counts
  and up to 20 latest dates disclosed per asset. Identical duplicates remain
  usable. Upstream adapters may already have filtered rows; these checks cannot
  detect cross-fetch conflicts or establish provider accuracy.
  Suggested identifiers do not guarantee usable daily history, and this is not
  a multi-source market explanation. An optional on-demand panel checks
  current keyless news feeds for source-dated headlines within each pair's actual
  shared-close window. It examines at most 50 recent candidates and displays at
  most eight matches per symbol; empty results do not imply no news occurred.
  Headlines are possible context, not causal attribution.
- **Dated fundamentals are current-feed candidates, not a revision archive.**
  Only source-reported filing/acceptance dates in the observed pair window are
  shown. Estimated dates and invalid records are excluded. Conflicting values
  for the same metric, fiscal period, release date, and provider are withheld
  and disclosed, not assigned an invented order or treated as verified
  revisions. Empty results do not establish that no release occurred, and a
  current provider snapshot cannot prove what was known at a past date.
  An explicit owner-scoped capture API can now preserve the eligible values
  this terminal saw at a UTC retrieval time, including conflicting values and
  an empty/error status. The comparison panel offers explicit capture and
  review, but saving makes a new fetch across eligible dates; it does not
  archive the panel's bounded response or happen automatically. A versioned
  as-of lookup selects only the latest retained owner capture at or before a
  requested instant; a failed/empty capture is not replaced by an older success.
  Explicit deletion can erase a past observation, so no retained capture does
  not mean none ever existed. Captures cannot establish market knowledge before
  they were made, and a fetcher returning an empty list may still hide upstream
  provider failure. Comparing two retained captures shows changes in provider
  candidate sets, not verified provider revisions or retractions. Failed/empty
  captures have no comparable value set; records missing from a later fetch may
  reflect provider coverage rather than a real-world event.
- **SEC filed facts are a separate, partial US-equity source.** The authenticated
  `POST /api/market-context/sec-filed-facts` endpoint requires a host-configured
  `SEC_USER_AGENT` and exact SEC ticker/CIK match. It returns at most 50 current
  Company Facts rows for selected standard US-GAAP revenue, net-income, and
  diluted-EPS concepts over a filed-date window of up to 730 days, with total
  match/examined counts. Concept and unit are not merged; a missing ticker or
  fact is not proof of absence. The SEC ticker list is not guaranteed complete.
  Company Facts is fetched now, not reconstructed as a past provider vintage;
  differing accessions are not automatically amendments or verified revisions.
  The comparison UI can inspect these facts on demand for each symbol in the
  observed pair window, separately from FMP candidates and captures; it does
  not prove what was known on any historical trading date. Request pacing is
  process-local, not a shared deployment-wide SEC rate limiter.
  A separate same-period difference view uses all eligible SEC facts before
  display caps, then shows at most 20 candidate groups and eight most-recent
  disclosures per group. It compares only exact concept, unit, fiscal start,
  and fiscal end; it flags multiple values within one accession. Differing
  values or amended form labels alone do not verify a correction or establish
  that one disclosure superseded another. Truncated groups cannot be read as
  complete filing histories. [SEC Company Facts documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).
  A separate opt-in `POST /api/market-context/sec-submission-crosscheck` and
  browser action compare up to 100 displayed accession/form/filed-date claims
  with the current SEC *recent* submissions index. They do not fetch older
  continuation files. An absent accession is therefore **not** an invalid
  filing verdict; a metadata mismatch is a prompt for inspection, not a proven
  correction. If this check fails, the Company Facts result remains visible.
  Any SEC-reported acceptance timestamp is metadata, not proof of when a
  particular investor could have received the filing. [SEC submissions API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).
- **Technical observations use shared provider closes.** Maximum observed
  drawdown and the gap from a 20-shared-close average are calculated only on
  the pair's actual common UTC dates; with fewer than 20 closes the average
  gap is unavailable. Crypto weekends may be omitted when the proxy has no
  close. Feed adjustment policies can differ, and splits or other corporate
  actions can distort or retrospectively change values.
  A Yahoo chart response with event metadata now discloses split/dividend
  markers reported in the observed pair window. No markers reported does not
  prove there were none; paths without event metadata remain unavailable.
  The markers do not adjust the plotted prices or derived measures.
  Separate Yahoo-adjusted own-date measures now require adjusted closes on
  every accepted close date for that asset inside the observed pair window,
  including crypto weekends. Partial coverage suppresses those measures; the
  primary comparison remains provider-close and pair-shared. Adjusted values are
  retrospective provider data, not verified correction quality, vintage, or
  exchange-session calendars.
  The same panel reports whether Yahoo supplied adjusted closes on all, some,
  or none of the pair's shared dates. This is coverage of a retrospective
  provider series, not verified adjustment quality or a historical vintage;
  the primary plotted path and calculations remain provider-close. A separate
  adjusted return, drawdown, and 20-shared-close gap are available per asset
  only with complete Yahoo adjusted coverage on the exact shared dates.
  When both assets have complete Yahoo adjusted coverage, a separate adjusted
  pair path and return difference use those same dates. Partial or one-sided
  coverage never changes the window or produces an adjusted pair. The result
  remains in native quote currencies, not FX-normalized.
  A reported-basis assessment flags matching, mixed, or unknown close-feed
  requests but does not audit returned prices. With complete adjusted coverage,
  adjusted-minus-provider return differences use identical dates for each
  asset and the pair; they quantify a numerical discrepancy, not its cause,
  adjustment correctness, or a decision-grade signal.
  The selected Yahoo chart's reported quote unit is displayed when present,
  including non-ISO units. Other feeds or missing metadata remain unknown.
  The label does not verify the price denomination or supply an FX rate; the
  comparison still does not calculate base-currency performance.
  A separate provider-close own-date view uses each asset's available UTC closes
  within that same pair window and reports dates beyond pair overlap, including
  crypto weekends. It does not alter the paired comparison or certify that
  provider UTC dates are standard exchange sessions.
  These are descriptive measures, not standard per-asset daily indicators,
  trading signals, or evidence of causation.
- **Economic calendar context is configuration-gated and non-causal.** An
  optional comparison panel checks the actual pair window against configured
  Finnhub/FMP calendar feeds. It never uses the sample fallback of the legacy
  calendar surface, explicitly reports missing keys or provider failure, and
  shows at most 30 returned events with the match count. Historical provider
  coverage may be incomplete; these global events are not automatically tied
  to either asset, and event dates do not establish price causation.
- **Macro observations are reference-period candidates, not historical news.**
  A separate FRED-keyed comparison panel checks current-vintage CPI,
  unemployment, and effective federal funds observations in the pair window.
  It shows source metadata and partial failures, never legacy sample data.
  The requested real-time date and retrieval time do not prove when an
  observation was published or which value was available to a trader then;
  values may have been revised. They are not attributed to either asset.
  An optional FRED real-time request for the pair-end date shows differences
  from the current view only where source units and frequency match. FRED's
  daily historical view is not a saved terminal snapshot, intraday release
  record, comprehensive availability audit, or proof of a market reaction.
- **Fundamental release context is a candidate snapshot, not a historical
  vintage.** The comparison panel checks current provider records on demand
  and displays only source-reported filing/acceptance dates in the observed
  pair window for four metrics. It excludes estimated release dates and reports
  unavailable/partial checks; missing records do not prove no release occurred.
  Provider values are not normalized across currencies or issuers, and later
  revisions may differ from what was known on the displayed date.
- **News dates are source dates only for newly parsed items.** Live news parsing
  and background ingestion now skip articles with missing or invalid publication
  dates rather than assigning the fetch time. Older stored articles are not
  retroactively verified and may contain dates assigned by the previous parser.
  Keyless live feeds provide recent, incomplete coverage, not a historical news
  archive or evidence that a headline caused a market move.
- **Portfolio FX depends on external daily market history.** Accounting supports
  USD, EUR, GBP, JPY, CHF, AUD, CAD, and INR conversions through Yahoo daily FX
  charts with a Finnhub candle fallback when configured. Dated conversion uses
  the last market close on or before the requested date and rejects gaps beyond
  seven days. Provider failure, an unsupported denomination, or a legacy row
  whose currency cannot be established makes dependent output partial; the
  backend never assumes a `1.0` rate. Migration `0014` deliberately leaves old
  transaction/holding currency fields nullable for this reason. Portfolio
  Manager exposes an explicit row action and focused currency dialog for each
  unknown legacy holding cost, transaction amount, or nonzero fee so the owner
  can repair the evidence record by record without crowding monetary columns.
- **Historical portfolio analytics describe current open holdings, not a full
  transaction-ledger performance record.** Portfolio list, detail, Manager,
  primary dashboard, and current allocation APIs normalize current marks and
  dated ledger/cost/P&L inputs through the
  traceable FX resolver. Their accounting block reports
  `complete`/`degraded`/`partial`, retains native/base evidence, and nulls totals
  whose inputs cannot be converted. Legacy rows with no reliable denomination
  remain `null`. Portfolio Manager, Home, Cockpit, and Launchpad consume these
  results directly, while position exports retain native lot currency rather
  than pretending a provider-free report can value FX. Risk and benchmark views
  follow today's open holdings at constant quantity from the first date when the
  entire current basket was open, converting each retained close with dated FX.
  They therefore
  exclude closed positions and do not represent ledger-reconstructed,
  cash-flow-adjusted performance. Attribution uses the same explicit boundary
  and separates security, currency, and interaction return. Missing price,
  denomination, or FX history produces a partial result instead of a guessed
  curve; frontend display conversion is not part of the accounting contract.
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
- `SEC_USER_AGENT` enables on-demand SEC filed facts; identify the application
  and a contact email. Without it, no SEC request is made.
- `FINNHUB_API_KEY` unlocks live US WebSocket ticks.
- `KITE_API_KEY`, `KITE_API_SECRET`, and `KITE_ACCESS_TOKEN` unlock supported
  India NSE/BSE F&O and depth workflows.

Direct unauthenticated access to `nseindia.com` is a brittle compatibility path,
not the default India provider. It is disabled unless the host explicitly sets
`OPENTERMINALUI_NSE_PUBLIC_ENABLED=1`; when enabled, the first HTTP 403 opens a
process-wide circuit so background or batch work cannot hammer a blocked source.
Restarting the backend resets the circuit. Yahoo `.NS` market data and configured
Kite access remain independent alternatives.

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
