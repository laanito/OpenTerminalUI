# Dividends: readable income views and explicit history scope

Continues merged, frontend-accepted #318. Dividends is a separate slice from the
larger Risk/Correlation/Stat Lab/Pair Trading workflows so its four retained views
have a focused review. Nine ordinary menu destinations remain after this work;
Dividends host acceptance and broader v3 acceptance are open. No release preparation.

## Reading and interaction

- A compact, wrapping four-view navigation leads directly to the active result.
  Labels and table names are readable; the unrelated global ticker loader is
  hidden on this route. The shared market/display preferences stay available.
- Calendar scope states the existing holdings/watchlist universe and fallback US
  basket. Estimates remain labelled. Long dividend types wrap in a useful column.
- Income puts the reported annual total beside the monthly chart, with exact
  values spanning the full width below; narrow widths stack the panels. Scheduled
  monthly values and yield-based annual estimates are distinguished. No portfolio selector or new accounting is invented.
- History has one labelled draft symbol and explicit Load history form, including
  Enter submission. Results name the applied symbol, not the unsubmitted draft.
  Native listing suffixes are kept. Editing alone does not fetch or relabel data.
- Aristocrats identifies the curated reference/streaks as dated 2025 rather than
  claiming freshly verified membership. Missing yields differ from numeric zero.
- Numerical tables have names, header associations and keyboard-focusable local
  horizontal scrolling; text and controls remain inside the viewport. Charts have
  12px axis labels and exact values in HTML tables, rather than hover-only data.
  Secondary coverage/projection detail is disclosed below the active task.

## Read states and data limits

View/symbol changes cancel old reads and ignore late completions. A new view or
failed refresh shows no previous curve/table. Loading, failure, empty results,
empty monthly breakdown and real zero have separate outcomes. Refresh view retries
only the applied scope; a failed read retains the draft symbol and never displays
raw provider errors. Reapplying a symbol also starts a fresh read.

All four endpoint paths and response contracts remain unchanged. They supply no
currency metadata. The UI shows reported amounts with currency unspecified,
removing the prior unsupported display-currency formatting of the income total.
No FX conversion is performed. Mixed-currency aggregation, resolved holdings and
duplicate-ticker scope, source availability/freshness, backend missing-amount zero
coercion, ex-date/payment-date semantics, scheduled/yield-estimate coverage and the
dated aristocrat list require v5 audit. Exact rows remain available for review;
a clean layout is not live provider or financial correctness certification.

## Validation and synthetic evidence

Four focused unit tests cover missing versus zero, explicit draft application,
late completion/cancellation, failed refresh clearing, retained drafts, manual
retry and malformed response shape. Five installed-Chrome journeys cover all
four views at 1440/1024/390px, 4× desktop CPU throttling, keyboard submission and
local scrolling, retained failed drafts, late reads and actual 200% browser zoom.
Geometry checks batch one DOM snapshot to avoid CI protocol overhead; normal
60-second test budgets are unchanged.

All 911 frontend tests / 151 files, production build and all 171 installed-Chrome
smoke journeys pass. After the final column-width/full-width-value-table styling,
all five affected browser journeys, four focused unit tests and build pass again.
API-reference, surface-inventory, production-mock, source-artifact and whitespace
guards pass. Current source artifacts are regenerated; original baseline browser
probes and screenshots remain unchanged.
The unchanged backend suite is not rerun. No live provider/model/private corpus,
production database or deployment access. No backend/API/schema/dependency or
saved-format changes.

| View | Desktop | Mobile |
|---|---|---|
| Upcoming calendar | [1440px](evidence/dividends-calendar-1440.png) | [390px](evidence/dividends-calendar-390.png) |
| Income | [1440px](evidence/dividends-income-1440.png) | [390px](evidence/dividends-income-390.png) |
| History | — | [390px](evidence/dividends-history-390.png) |
| Dated reference | [1440px](evidence/dividends-aristocrats-1440.png) | — |

[Actual 200% Chrome zoom](evidence/dividends-native-zoom.png).
Captures show the scrolling workspace viewport; lower rows and local overflow
are verified through interaction rather than claimed to fit on a single screen.
