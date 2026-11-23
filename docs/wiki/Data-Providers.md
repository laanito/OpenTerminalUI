# Data providers

Provider selection is workflow- and instrument-specific; not every panel uses
the same fallback chain. Available history, entitlement, throttling and upstream
formats can all limit coverage. Keyless access is not an availability guarantee,
and knowing a provider does not establish price accuracy or historical vintage.

Generic equity workflows default to US/NASDAQ when no usable market is supplied.
Explicit India selections retain NSE/BSE, INR and their intended benchmarks.
EU/UK Yahoo suffixes such as `.L`, `.DE` and `.PA` bypass the India path.

The instrument catalogue already has a native `currency` field; the global
market selector is a request hint, not a currency conversion or an instruction
to turn a listed instrument into a coin. Catalogue/search metadata can be
incomplete, so supported listing suffixes remain a fallback (`MWRE.DE` → EUR).
Normalized chart requests use the shared authenticated transport and omit a
global market hint for explicit Yahoo listings/indices. Their provider resolver
preserves supported foreign symbols even if an API caller sends a conflicting
hint. Legacy charts skip incompatible adapters for these listings and prefer
provider-reported currency, then the listing fallback; their cache identity was
changed to avoid reusing old market-derived currency labels. REST and polled
quotes likewise keep the native Yahoo symbol. The crypto adapter rejects such
listed symbols instead of appending `-USD`; genuine `BTC-EUR` keeps EUR.
This fixes read-path routing/metadata. It does not migrate or rewrite stored
holdings, transactions or instrument rows, and does not guarantee upstream data.

Watchlists resolve quote identity independently of the global search selector.
Their authenticated responses include additive `quote_routes` metadata keyed by
stored symbol: `symbol`, `quote_symbol`, `market`, `currency` and `status`.
Resolution reads the local instrument catalogue in a batch, honors explicit
suffixes/prefixes and crypto quote pairs, and retains the existing US default for
unknown bare tickers. Conflicting catalogue listings are marked `ambiguous` and
receive no subscription; qualify the symbol rather than applying a global market
to every row. This metadata is derived on reads; stored lists are not rewritten.

The quote socket and REST quote route accept `EU`; those subscriptions use native
Yahoo listings such as `MWRE.DE` or `MIGA.MU` and their existing polling path.
The Watchlist subscribes to each resolved market on the shared socket, so US,
European, India and crypto symbols can coexist. Table, heatmap and export read
the same tokens. Provider-reported units take precedence over catalogue/suffix
fallbacks (for example `GBp` remains pence); prices are not converted into the
global display currency. Search still uses the selected market for suggestions.
Crypto pairs unsupported by the connected Binance USD stream (such as `BTC-EUR`)
remain on the existing polling path instead of being treated as streamed merely
because the socket is connected.

## Markets and search

| Provider/source | Retained role | Configuration |
|---|---|---|
| Nasdaq Trader listings, pytickersymbols, CoinGecko | US, EU/UK and crypto instrument universe, with Yahoo long-tail search | Keyless paths; optional CoinGecko demo key |
| Yahoo Finance | Quotes, chart/history fallbacks and corporate actions; EU symbols retain exchange suffixes | No provider key; unofficial access may fail or throttle |
| FMP | Selected equity history, fundamentals, earnings, commodities and calendar paths | `FMP_API_KEY`; coverage depends on endpoint/plan |
| Finnhub | US live ticks and selected REST/calendar/candle fallbacks | `FINNHUB_API_KEY`; subscriptions and access are provider-dependent |
| CoinGecko | Crypto search, market/valuation/supply data and candle paths | Optional `COINGECKO_API_KEY` |
| Binance | Available public crypto spot streams and selected derivatives/depth data | `OPENTERMINALUI_BINANCE_WS_ENABLED` controls spot ticks |
| DefiLlama | Crypto usage context such as TVL and fees | Keyless |
| Zerodha Kite | Intentional India real-time/history/F&O workflows | `KITE_API_KEY`, `KITE_API_SECRET`, `KITE_ACCESS_TOKEN` |
| Direct NSE website | Opt-in compatibility for selected India data | `OPENTERMINALUI_NSE_PUBLIC_ENABLED=1` |

Direct unauthenticated NSE requests are off by default. The first opted-in
HTTP 403 opens a process-level circuit; do not keep refreshing a blocked
session. Prefer configured Kite or applicable Yahoo `.NS`/`.BO` data.

The instrument universe auto-seeds and periodically refreshes according to
`OPENTERMINALUI_INSTRUMENT_AUTOSEED` and
`OPENTERMINALUI_INSTRUMENT_REFRESH_HOURS`. Sources refresh independently so a
failed source does not wipe existing listings. Search suggestions do not
guarantee a provider can supply usable chart history.

## Comparison fundamentals and macro evidence

| Source | Bounded comparison role | Configuration and limits |
|---|---|---|
| SEC EDGAR | Current Company Facts, submission metadata and v2.1 selected source-filing checks | `SEC_USER_AGENT` identifies app/operator and real contact email; exact ticker/CIK and selected concepts/forms only |
| FMP fundamentals | Source-dated current-feed candidates and explicit owner captures | `FMP_API_KEY`; not a complete revision archive |
| FRED | US reference-period observations and optional pair-end daily real-time checks | `FRED_API_KEY`; daily provider intervals are not intraday dissemination records |
| Eurostat | Selected current euro-area HICP/unemployment, first-published HICP and bounded unemployment archive checks | Keyless; archive gaps, flags and composition changes remain explicit |
| ECB | Selected euro-area deposit facility rate | Keyless; observation dates do not establish asset-specific causation |
| Finnhub/FMP calendar | Explicit requests for events in the pair window | Keys and usable provider coverage required; no sample substitution |

SEC requests are opt-in and process-locally paced, not a deployment-wide archive
crawler. A source-filing check reads the official filing index and listed XBRL
instance, with 2 MiB/12 MiB document limits, XML complexity limits and a 45-second
deadline. Corroboration requires exact company-wide concept, unit, fiscal
duration and value; an accession appearing in an index is insufficient.
[Research Workflows](Research-Workflows.md) explains the UI and API outcomes.

Macro context is global, not automatically selected for the ticker. A reference
month, filing date, acceptance timestamp and terminal retrieval time are
different evidence. None alone proves what an investor knew at a past time.
See [Limitations](Limitations.md) for precise panel coverage.

## FX valuation

Portfolio accounting resolves USD, EUR, GBP, JPY, CHF, AUD, CAD and INR pairs from
Yahoo daily FX charts, trying the inverse pair when necessary. Configured
Finnhub/OANDA candles are the fallback. Dated valuation chooses the last close
on or before the requested date, accepting gaps up to seven days; historical
analytics batch required dates per pair. Missing conversion makes dependent
totals partial rather than assuming parity.

Comparison reporting-currency views are separate: they require supported quote
units and dated rates on the relevant endpoints or every original shared date
for a full path. They are not a replacement for portfolio ledger accounting.

## Caches and resilience

Chart caches reduce repeated provider calls. Some are SQLite sidecars even on a
PostgreSQL application deployment; Redis provides shared cache/quote distribution.
TTL, backoff, circuit breakers and explicit degradation must be preserved when
changing adapters. Do not cache provider 429/5xx responses as successful data.

Set `OPENTERMINALUI_PREFETCH_ENABLED=1` only when deliberate cache warming is
wanted. Quotas, delays, commercial terms and entitlement change by provider:
check the operator's actual plan rather than treating a hard-coded free-tier
quota or an old QC report as an SLA.

## Model providers and privacy

The shared client uses an OpenAI-compatible endpoint, defaulting to local Ollama.
Chat and embeddings must both be local to keep that inference on the operator's
infrastructure. Hosted configuration sends selected prompts/evidence to the
configured provider. Embeddings and synthesis have distinct capability/fallback
requirements; model unavailability is not permission to invent a result.

## Operator notes

Configure market/model credentials in the host environment, not browser
automation-key settings. Copy the [environment template](../../.env.example),
replace example credentials, and recreate/restart the backend as appropriate.

Kite access tokens expire regularly; renewing credentials is a host/operator
workflow, not a supplied autonomous broker integration. Never commit tokens,
contact secrets or `.env` contents. General provider acquisition, live economic
calendar reliability and paid US/EU Level-2 adapters remain unscheduled gaps.

For a new adapter, inspect the actual consumer and tests first: fallback
contracts differ across charting, comparisons, accounting and optional evidence.
Update [surface classification](Surface-Inventory.md), configuration docs and
generated API contracts when public behavior changes.
