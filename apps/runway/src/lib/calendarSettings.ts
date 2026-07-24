// Settings-table key for the calendar-read increment (E1), same
// one-key-one-constant shape as liveTravelSettings.ts's
// LIVE_TRAVEL_ENABLED_SETTING. Lives in the existing key-value `settings`
// table (db/db.ts v2) — a single on/off flag doesn't earn a schema change.
//
// Three states this key can be in, all read the same way (`=== 'true'`):
//   - unset (row never written): Home's "From your calendar" section shows
//     just the lazy-enable TextAction, nothing has been requested yet.
//   - 'true': permission was granted; the section loads and shows events.
//   - 'false': either permission was denied, or the user turned the
//     Settings toggle off after previously enabling it. Same rendering
//     either way — the section shows nothing further. Distinguishing "never
//     asked" from "asked and said no" only matters for which UI shows (the
//     enable prompt vs. nothing), which is exactly what unset-vs-'false'
//     already captures without a third value.
export const CALENDAR_ENABLED_SETTING = 'calendarEnabled';
