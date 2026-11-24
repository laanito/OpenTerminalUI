# Settings: labelled tasks and readable automation access

This follows maintainer-confirmed merged/tested #310 (Alerts). Launchpad and
broader retained-tool/maintainer acceptance remain; this is not release preparation.

## Findings and changes

Settings was one long page of six-column controls and dense tables. Preferences,
quick alerts and schedules lacked visible labels. Long provider-variable names
shared a line with descriptions, API-key controls could overflow, and their custom
key overlay lacked the shared keyboard/focus handling. Key failures were logged
only to the console; failed reads discarded previous keys. A combined alert/report
read could also hide independent results. Settings offered only India/US and
INR/USD options although the existing store already supports Europe/EUR/Crypto.

- Preferences, Automation, Data and Host setup now have keyboard-operable tabs.
  Browser preferences have labelled fields, readable values and the existing
  market/currency choices. Their existing setters, defaults and `ui-settings`
  persistence remain unchanged. Preferences still save automatically in-browser;
  this is not new portfolio accounting or FX behavior. The unrelated global
  ticker loader is hidden on Settings.
- Automation puts API access first. Key-name and permission fields are labelled;
  long names, prefixes, permissions and dates wrap in cards. Scheduled reports and
  quick alerts retain their existing payloads and actions, with creation disclosed
  behind labelled forms. The Alerts-console link gives access to existing richer
  rules. Report/alert lists have independent loading, empty and failed-read states.
  Previous data survives failed refreshes. Confirmed mutations update their list
  before follow-up reads, and older reads cannot erase that confirmation.
- Key generation uses TerminalModal: bounded scrolling, Escape, trapped keyboard
  navigation and focus return to the creation notice. The full credential remains
  available if the following list refresh or clipboard write fails. Copy failure
  offers manual selection/save. Closing clears the full credential; only metadata
  is retained in the list, and no full key is written to query/browser storage.
  Existing revoke confirmation remains. Key writes are never automatically replayed;
  failed drafts survive, and stale reads cannot erase confirmed key metadata.
- Tab contents stay mounted so drafts survive section changes. Section changes
  are disabled while key creation/revocation is pending or a one-time key is open,
  preventing an internal tab change from losing that key's presentation.
- Data exports show full dataset names with format buttons. Failed downloads are
  visible; a confirmed request prepares the existing file download. Backtest files
  are still requested manually and now distinguish unrequested/loading/empty/error
  states. Long filenames wrap in a named keyboard-scrollable region; previous files
  remain visible after a failed refresh. Host variables each have their own readable
  name/description card and retain the server-versus-account credential distinction.

There are no backend/API/schema, dependency, preference-storage or stored-data
changes. This does not add scheduler delivery, providers, permissions or export
formats. The broader deferred legacy functionality audit remains separate.

## Review evidence

All 885 frontend tests / 146 files pass. Ten focused unit cases cover existing
key permission payloads, independent read failures, retained drafts, precise quick-
alert thresholds, report confirmation versus failed refresh, earlier-key-read
isolation, one-time-key cleanup/copy failure, existing preference values, export
failure and retained datasets. Production build passes.

The five Settings Chrome cases cover 1440/1024/390px, long names/emails/filenames,
label sizing, tab keyboard navigation, key creation/revocation and permission
payloads, modal focus/return/cleanup, clipboard failure, report and quick-alert
payloads, a CSV download, independent failures and measured native 200% Chrome
zoom. All 134 installed-Chrome smoke cases pass. The five Settings cases pass
again after making screenshots wait for colour transitions and scrolling the
longest host variable into view. API-reference, surface-inventory, production-mock
and whitespace guards pass.

Browser APIs, credentials and downloads are synthetic intercepted fixtures. No
real API keys, notifications, provider calls, production data or deployments are
accessed. This is local frontend validation, not scheduler/provider functional
certification, blanket accessibility or whole-release acceptance. Backend tests
were not rerun for unchanged server code.

- [Desktop preferences](evidence/settings-preferences-1440.png)
- [Mobile preferences](evidence/settings-preferences-390.png)
- [Desktop automation](evidence/settings-automation-1440.png)
- [Mobile one-time-key dialog](evidence/settings-key-dialog-390.png)
- [Mobile data tools](evidence/settings-data-390.png)
- [Mobile host setup](evidence/settings-host-390.png)
- [Native 200% zoom](evidence/settings-native-zoom.png)

Continue with Launchpad, then broader retained-tool and maintainer acceptance.
