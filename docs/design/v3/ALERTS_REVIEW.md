# Alerts: readable rules, editor and delivery settings

This follows merged #309 (Saved Views). Settings, Launchpad and broader retained-
tool/maintainer acceptance remain separate; this is not release preparation.

## Findings and changes

The retained Alerts page squeezed condition fields into a twelve-column row,
used placeholder-only delivery fields and small raw condition names, and hid
retrieval/action failures. The editor's footer bypassed native form validation;
failed saves could expose raw delivery errors. Editing an unchanged expiry also
interpreted a sliced UTC value as local time.

- Rule cards show wrapping symbols, human-readable operators, status, conditions,
  delivery channels and visible actions. Longer notes are disclosed. History and
  browser delivery defaults retain their own tabs; a failed history request does
  not prevent reading rules. The unrelated global ticker loader is hidden.
- The bounded existing TerminalModal contains labelled field groups: conditions,
  delivery, and disclosed trigger limits/expiry. Inputs use 14px text; descriptive
  labels and metadata use at least 12px. Narrow layouts stack, with scrolling
  confined to the dialog body and persistent footer actions. Keyboard trap,
  Escape, opener return and confirmed-write feedback focus remain available.
- Save is associated with the actual form. Fractional thresholds and volume
  multipliers remain valid. Pending writes/tests lock the editor; failed writes
  retain drafts with generic errors and manual retry. A new alert initializes
  before paint, avoiding a brief display of the previous alert's fields.
- Rule/history reads distinguish loading, empty, failed and retained-but-not-
  refreshed data. Confirmed writes update the local list before follow-up reads;
  cancellation prevents an older pending read from erasing that confirmation.
  Read failures cannot reopen/retry a confirmed write. Row-action failures are
  visible and focused; no write or delivery test is automatically replayed.
- Delivery fields have visible labels and token inputs are masked. Defaults keep
  the existing `ot.alert.delivery.defaults` browser storage key and JSON format;
  masking is visual, not a storage-encryption change. The existing delivery-test
  endpoint tests configured channels on the saved rule; the editor explains that
  delivery changes must be saved before testing them. Editing defaults clears an
  earlier saved notice. A
  successful request is not presented as proof that a notification arrived.
- Existing `ticker` links and the `symbol` alias both filter/preseed the editor;
  clearing a filter retains unrelated query parameters. Rule payloads preserve
  conditions, AND/OR, parameters, channels and limits. Expiry displays local time;
  leaving it unchanged preserves the exact original instant, including seconds.

There are no backend/API/schema, dependency, engine, provider or stored-data
changes. This does not add indicators, channels, execution logic or provider
reliability work to v3. Broader legacy functionality auditing remains deferred.

## Review evidence

All 876 frontend tests / 145 files and production build pass. Seven focused unit
cases cover fractional payloads/precise expiry, retained drafts and redacted raw
errors, manual delivery testing, independent read failures, confirmed creation
with failed refresh, earlier-refresh isolation and existing defaults storage.
Five Alerts browser cases pass at 1440/1024/390px and measured native 200% Chrome
zoom. They exercise long content, keyboard/modal focus, precise edit payloads,
pause/test actions, history pagination, defaults/new-rule seeding, failed drafts,
filtered empty states, independent read failures and confirmed-write feedback.
All 129 installed-Chrome smoke cases pass. Final affected checks repeat the five
Alerts browser cases and seven unit cases after the delivery-test clarification.
API-reference, surface-inventory, production-mock and whitespace guards pass.

All browser API responses and delivery calls are intercepted fixtures. No real
notifications, provider calls, production database or deployment is accessed.
These checks establish local frontend behavior, not live rule/delivery reliability,
blanket accessibility or whole-release acceptance. The unchanged backend suite
was not rerun.

- [Desktop rules](evidence/alerts-rules-1440.png)
- [Mobile rules](evidence/alerts-rules-390.png)
- [Mobile editor and retained failed draft](evidence/alerts-editor-390.png)
- [Desktop history](evidence/alerts-history-1440.png)
- [Mobile delivery defaults](evidence/alerts-delivery-390.png)
- [Native 200% zoom](evidence/alerts-native-zoom.png)

Continue with Settings and Launchpad, then broader retained-tool and maintainer
acceptance. A merged layout PR is not a live delivery/provider certification.
