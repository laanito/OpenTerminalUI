# News headline and sentiment-context review

This follows maintainer-accepted Notes/Journal #300 and applies the v3 standard:
readable names and useful space, with the reading task ahead of secondary setup.

## Findings and changes

- Headlines now lead the reading area. At wide desktop sizes, sentiment and
  research context sits in an independent 340px rail; narrower layouts put it
  after the feed, with named jump links in both directions. Search and scope
  remain visible. A native Feed filters disclosure contains sort, period and
  market controls and exposes the active period/order in its summary.
- Feed sentiment buttons remain beside headlines, with selected state and counts
  from the original feed. They do not imply that an AI overlay changed the
  original distribution. Aggregate context identifies ticker versus feed scope;
  sector/source summaries explicitly remain separate from the selected feed.
- Headlines, publisher summaries and assessment rationales use 14px prose.
  Source names, dates, controls and other metadata use at least 12px and wrap.
  The linked headline comes before potentially long publisher names. It opens
  externally with the existing URL/new-tab protections; metadata and prose are
  selectable without making the whole card a link. Publication dates are visible
  alongside relative age, and missing dates stay unavailable.
- Content-keyed AI overlays, batch limits, manual retry, Fast/model identity,
  lexical fallback labels, context resets, sorting, pagination and summary
  enrichment retain their contracts. Per-row engine labels distinguish AI
  assessments and lexical fallback from original feed labels. Filters still use
  original scores. No new automatic headline-scoring operation is introduced.
- Keyword matches, source coverage, ticker notes and daily numerical scores use
  disclosures. Keyword matches remain browser-local matches within the retrieved
  feed. Private dated notes remain distinct from headline assessments. Ticker
  selection still uses the existing global loader; ticker emotion retains its
  existing automatic request behavior and visible Fast/fallback identity.
- Sector/source names and per-article emotion evidence wrap. Emotion metrics
  reflow without splitting the Confidence label. Gauge labels are readable and
  the graphic is named; its arc stays within the 180-degree scale above the
  midpoint instead of drawing a large looping arc. Input/index values are unchanged.
- Failed feed retrieval has an explicit alert/retry, including loaders that
  return a failed source mode. It does not masquerade as an empty view or a
  zero-evidence neutral summary. Existing cached headlines can remain with the
  failure warning. Empty successful views, missing sentiment context and failed
  sector/source summaries have distinct messages. Ticker-card failures also
  remain distinct from an empty feed. A feed-check time is a retrieval timestamp.

## Validation and evidence

All 854 frontend tests / 141 files, production build and all 98 deterministic
installed-Chrome smoke journeys pass. Five new cases cover populated
1440/1024/390px layouts, failure/empty distinction and measured native 200% zoom.
They check first-headline placement, long source names and unclipped prose,
visible publication dates, labelled filters, original-count versus AI-overlay
separation, successive 20/5 headline batches, failed scoring/manual retry,
keyboard filtering, scope/search/sector/crypto navigation, daily values, browser-
local keywords, source coverage, ticker emotion and private notes. Existing Fast
profile, retained-headline/comparison evidence, Portfolio, Brain and Notes/Journal
journeys continue to pass. Production-mock, API surface and whitespace guards pass.

Native zoom uses full Chromium with a disposable profile, asserting browser/CSS
width ratio approximately 2 and visual viewport scale 1. Local verification uses
installed Chrome; Linux CI remains separate.

Synthetic screenshot evidence:

- [Desktop headlines and context](evidence/news-headlines-1440.png)
- [Tablet headlines](evidence/news-headlines-1024.png)
- [Mobile headlines](evidence/news-headlines-390.png)
- [Mobile source and keyword context](evidence/news-context-390.png)
- [Mobile ticker emotion evidence](evidence/news-ticker-context-390.png)
- [Native 200% zoom](evidence/news-native-zoom.png)

The browser cases intercept API responses and use synthetic headlines; they do
not call real publishers/models or access a private corpus, production database
or deployment. No backend/API/schema/dependency, provider/model selection,
sentiment computation, retention or saved-evidence contract changes. These live
News overlays remain separate from retained comparison/headline evidence.
Workstation/Screener and broader populated/maintainer acceptance remain before v3
release preparation.
