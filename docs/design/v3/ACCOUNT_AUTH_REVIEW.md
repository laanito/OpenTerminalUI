# Account, About and auth: readable identity and honest local state

Continues merged #331. This slice covers `/account`, `/equity/stocks/about`,
`/fno/about`, `/login`, `/register` and `/forgot-access`. Both About variants are
reviewed; their shared component does not imply review of other F&O tools.

Dedicated work covers 47 render entries, all 32 primary tool destinations and
four shell-menu extras. Ordinary menu coverage is complete. Other direct/
secondary/hidden presentation, optional Mosaic and wider acceptance remain;
this slice's host acceptance is open. No release preparation. The separate urgent
recovery-verification hardening follow-up takes priority over routine remaining
route work; this frontend slice does not certify server auth security.

## Account

A compact signed-in identity and editable profile lead. The current draft name,
full authenticated email and role wrap naturally. Persistent labels and 44px
controls replace small fields; the profile grid reflows without fixed side columns.
Market/broker labels, legacy integration fields, completion/session activity,
export/reset/sign-out and route shortcuts have separate disclosures.

The page clearly identifies browser-local metadata. Filled-in API/webhook fields
are counted as filled, not online; broker names do not imply linked accounts,
and local risk/security/notification preferences do not enforce server policy.
No vault, armed webhook or verified security posture is invented. Account saving
still writes its existing three records and updates country/market/currency
settings. EU/Crypto/EUR selectors now display those already supported values
rather than hiding a hydrated preference.

Profile fields/defaults, completion formula, avatar upload/remove, shortcut
routes and export/reset semantics remain. Exports include the current unsaved
profile, routing and integration values, with the same bundle keys and filename
pattern. Reset still clears only the three Account records and restores defaults.
Failed local saves retain the draft and do not claim success. Writes remain
sequential; this is not an atomic storage/migration change. Logout still delegates
to the existing auth provider and navigates to login.

## About

About leads with a compact product description, actual build version/commit/date,
license and retained navigation links. Repository/documentation/release links
replace the stale hand-curated release feed, hardcoded repository counts,
language percentages, indexed date and market/route certification badges.
No GitHub metadata is fetched or invented. Module inventory and stack/keyboard
reference remain disclosed, with PostgreSQL/SQLite identified correctly.

Both Market and Derivatives variants retain their return destinations, Back and
Escape behavior. Escape respects an already-handled event or open dialog.
Copy URL has explicit success/failure feedback and timer cleanup. The existing
square application icon is used without distorting the wide wordmark image.

## Auth presentation and lifecycle

Login, registration and recovery share a narrow-screen/zoom-friendly layout with
persistent labels, native autocomplete, 44px controls and visible request/error
states. Fake uptime/latency/session statistics, online certification and the
large decorative/ticker column are removed. Version and canonical repository
identity remain. The forms scroll vertically and keep footer navigation reachable
at native 200% zoom.

Login keeps its email/password contract, remembered-email key, demo credential
fill, redirect handling, transition event/flag and timing. Remember terminal is
explained as remembering the email. Password visibility is a labelled pressed
control. Failed credentials remain in the form. Duplicate submissions are guarded
and abandoned requests do not trigger late navigation. Existing minimum login
presentation/transition delays are retained, not new provider timeouts.

Registration matches the server's existing Viewer-only provisioning; misleading
Trader/Admin choices are removed. Password-length/confirmation checks, registration
and automatic login remain. If account creation succeeds but automatic login
fails, the form reports that partial success and directs the user to sign in;
it does not invite a duplicate registration. Pending/created fields are disabled,
with unmount guards across the registration/login sequence.

Recovery keeps its existing endpoint/payload and 30-second transport timeout.
Inputs have persistent labels and new-password autocomplete. Failed drafts remain;
pending requests cannot duplicate-submit, and the success-navigation timer is
cancelled on unmount. Generic completion text does not assert that an unknown
account was changed. A separate server hardening review is urgent: these UI and
mocked transport checks are not evidence of recovery verification or security.
No reset-token, identity-provider, email-delivery, session-storage or permission
redesign is included here. Backend/API/auth-provider source remains unchanged.

## Follow-up boundaries

Prioritize the separately reported recovery verification/security follow-up before
routine remaining-route work; do not bury it in the general v5 queue. The
maintainer has the source-review details. No production auth requests or accounts
were used to investigate it.

Later Account functionality work should audit browser-wide versus per-user local
records, schema validation, credential retention/export, sequential-save failure,
legacy routing/integration fields and the meaning of profile preferences. This
slice makes those boundaries visible without wiring new providers or brokers.
Other retained functionality/provider/model audits remain in v5.

## Verification

All 992 frontend tests / 160 files, production build and all 239 installed-Chrome
smoke journeys pass. After final icon/pending-control/field-label refinements,
19 affected unit cases and 14 browser journeys pass again; preview startup
rebuilds production assets. The unrelated backend suite was not rerun.

Eleven added unit cases supplement retained Account/About/auth coverage: local
save failure with retained draft, hydrated EU/EUR selections, clipboard failure,
password visibility/validation, remembered email, failed and abandoned login,
registration validation/Viewer payload/partial success, recovery payload/failure
and cancelled success navigation. Account defaults and export-bundle helper
blocks match merged main. Backend/API/auth-provider and country/currency type
source are unchanged; no production data or storage migration was used.

Thirteen new Chrome journeys plus retained login smoke cover both About variants,
Account local save/export/reset, login/recovery failure and partial registration,
1440/1024/390px, 4× CPU throttling for Account at 1024px and actual 200% browser
zoom with reachable footer links. The native zoom check measures
outerWidth/innerWidth ≈ 2 and visualViewport.scale = 1. CDP captures avoid CSS-sized
full-page clipping. Native select controls are located by accessible combobox name.

API-reference, surface-inventory, production-mock, source-inventory and whitespace
guards pass, along with review-link/JSON checks. There are still 80 leaf render
routes / 78 entry files, four shells and 27 redirects. The original 39 audit
probes/screenshots are unchanged. Source hints alone do not certify UI acceptance.

Eighteen synthetic viewport captures show actual internal scroll positions;
they are not stitched claims that all content fits on one screen. Passwords,
local key values and accounts in fixtures are synthetic. No live providers,
private corpus, production DB, deployment or real auth/account mutation was used.
These results are presentation/transport acceptance, not a security review.

| Workflow | Desktop | Narrow / state | Native 200% |
|---|---|---|---|
| Account | [1440px](evidence/identity-account-profile-1440.png), [1024px](evidence/identity-account-profile-1024.png) | [390px](evidence/identity-account-profile-390.png), [local settings 1440px](evidence/identity-account-local-settings-1440.png), [local settings 390px](evidence/identity-account-local-settings-390.png) | [View](evidence/identity-account-zoom.png) |
| About | [Market](evidence/identity-about-market-1440.png) | [Market 390px](evidence/identity-about-market-390.png), [F&O 390px](evidence/identity-about-fno-390.png) | [View](evidence/identity-about-zoom.png) |
| Login | [Retained error](evidence/identity-login-error-1440.png) | [390px](evidence/identity-login-error-390.png) | [View](evidence/identity-login-zoom.png) |
| Registration | [Partial success](evidence/identity-register-partial-1440.png) | [390px](evidence/identity-register-partial-390.png) | [View](evidence/identity-register-zoom.png) |
| Recovery | — | [Retained error 390px](evidence/identity-recovery-error-390.png) | [View](evidence/identity-recovery-zoom.png) |
