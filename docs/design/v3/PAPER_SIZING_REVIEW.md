# Paper trading and Position Sizer: readable account and calculation workflows

This follows merged #313 and the remaining-page audit. The baseline screenshots
and 39 initial probes remain historical evidence. This implements the first two
remaining menu destinations; host acceptance is open and eighteen other ordinary
menu destinations still need review. No release preparation.

## Paper account flow

The page previously placed account creation, seven unlabelled order controls and
a second hotkey account selector before position review. Detail reads were coupled,
old-account responses could replace current data, and write confirmation depended
on the following reads. Failed reads could leave zeros or empty lists without
useful context.

- The header provides New paper portfolio and Place paper order. A labelled scope
  selector and wrapping account name lead to overview values and readable position
  cards. Orders and Trades have their own activity tabs; the existing eight-order
  and twenty-trade limits are explicit. Extra performance metrics are disclosed.
- Creation/order entry uses the existing bounded TerminalModal: visible field
  labels, quote/account/asset unit distinctions, native validation, keyboard trap,
  Escape, persistent footer and draft retention. Limit and stop fields appear for
  their existing order types. Fractional values at/above the existing minimum are
  retained in payloads. Closing/reopening keeps the draft; uncertain failures tell
  the user to inspect/refresh the relevant list before manual retry.
- Reads are independent and keyed by account. Loading, empty and failed reads
  differ; previous values remain explicitly unrefreshed after failure. Unknown
  metrics and absent realized P&L are unavailable rather than zero. Position
  quantities retain fractional precision. Balances use the account's raw units;
  instrument prices/P&L use quote units, without implying an FX conversion.
- Writes capture the opening account and guard immediate duplicate submission.
  Scope/controls are locked while pending. Confirmed responses populate the list
  before refresh; old in-flight reads are cancelled so they cannot erase the
  confirmation or overwrite post-order analytics. A failed refresh cannot reopen
  or automatically resubmit a confirmed create/order. A received pending limit
  order is not described as a completed fill.

## Shared hotkeys

Hotkey trading is disclosed and lazily mounted on Paper; once opened its draft
survives collapse. Its account is controlled by the page's single scope. Existing
standalone/floating/Launchpad widgets retain their own selector and the existing
`ot:paper:selected-portfolio:v1` storage key. The embedded widget's symbol still
follows global ticker context, which is explicitly stated; its market/symbol
payload convention is preserved.

The shared widget retains quantity/limit controls, Buy/Sell, Flatten, long-only
Reverse-as-flatten and Clear draft. It uses readable wrapping labels/rows and
persistent success/failure feedback. Trading letters no longer submit orders
while an input/select is being edited; focus is not stolen from controls.
Repeated held trade keys and concurrent submissions do not replay writes. Request
scope/symbol and subsequent invalidations use the captured account. Confirmation
is independent of refresh. Missing prices are labelled unavailable; synthetic
bid/ask fallbacks are labelled estimated. Their underlying formulas/routing are
unchanged.

The floating wrapper clamps its rendered position to the current viewport and
scrolls its body within the available height. Resize does not rewrite stored
coordinates. Dragging starts at the rendered position. Minimize preserves the
widget draft; its existing visibility/position/minimize keys and shortcut remain.
The shared widget still participates in the existing Launchpad implementation.

## Position Sizer

The calculator's defaults, parsing, validation and all calculation functions were
compared with the merged source and remain byte-for-byte unchanged. All six
existing calculation tests remain. The compact, labelled method selector exposes
fixed fractional, Kelly, ATR and volatility targeting with the existing method-
specific inputs. Primary labels are at least 12px and inputs 14px; extreme tracking
is removed and flexible children wrap.

A live compact result beside method selection shows calculated units, position
value and account exposure before the long form. A keyboard-operable result link
focuses the full output region. Inputs/results sit alongside each other when
space permits and stack on narrow screens. The summary table has a named local
scroll region; errors/warnings are announced without clearing typed values.
The selected display currency is explicit and the page states its single-currency
assumption. No FX conversion, new formula or execution is introduced. The unrelated
global ticker loader is hidden on this calculator, but remains on Paper where the
existing hotkey symbol uses it.

## Validation and evidence

All 901 frontend tests / 150 files pass, including eighteen affected cases:
six unchanged formula tests, six account/draft/late-read/confirmation cases,
three hotkey input/concurrency/quote-label cases and three calculator UI cases.
The full 145-case Chrome smoke suite passes. After the final quote-label change,
all six affected browser journeys and eighteen focused tests pass again; their
production build passes too. API-reference, surface-inventory, production-mock,
source-artifact and whitespace checks pass.

Six Chrome journeys cover 1440/1024/390px, 4× CPU-throttled desktop rendering,
long account names, fractional limit payloads, independent/failed/late reads,
confirmed writes with failed refreshes, account-bound hotkeys, labelled method
selection and invalid input recovery. They include native 200% Chrome zoom and
the standalone floating widget's old offscreen position, shortcut, input focus,
account selection and minimize/expand retention.

- [Desktop paper overview](evidence/paper-overview-1440.png)
- [Mobile paper overview](evidence/paper-overview-390.png)
- [Mobile retained order draft](evidence/paper-order-390.png)
- [Desktop sizing controls](evidence/sizing-inputs-1440.png)
- [Mobile sizing controls](evidence/sizing-inputs-390.png)
- [Mobile sizing results](evidence/sizing-results-390.png)
- [Native 200% zoom](evidence/paper-sizing-native-zoom.png)

APIs, accounts, orders, quotes and reads in browser tests are intercepted fixtures;
no real orders, providers, corpus, production data or deployment are accessed.
There are no backend/API/schema, dependency or stored-format changes. Backend tests
were not rerun. Existing paper order types, quantity minimum, quote selection,
execution/fee/currency behavior and analytics formulas are retained. Native-symbol
matching, FX/account semantics and real engine/provider correctness remain in the
deferred functionality audit; these UI fixtures do not certify them. This is not
blanket accessibility or whole-release acceptance.

The current source route ledger is regenerated for the changed entry files. The
original browser audit/screen captures are retained, not regenerated as new proof
of the baseline's old state. Continue with macro/FX: Forex, Commodities, Economics
and Yield Curve, followed by the remaining batches in the audit.
