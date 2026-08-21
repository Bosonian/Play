// Settings-table key for the day-gauge increment (0.31.0), same
// one-key-one-constant shape as calendarSettings.ts's
// CALENDAR_ENABLED_SETTING. Lives in the existing key-value `settings`
// table (db/db.ts v2) — a single on/off flag doesn't earn a schema change.
//
// Deliberately opt-IN: absent (row never written) and 'false' both mean
// "off" — CLAUDE.md's "defaults that lean toward less, not more" rule. A
// silent, ongoing, permanent notification is a bigger footprint on the
// notification shade than any alert this app already posts (those fire once
// and clear); a first-time install shouldn't plant one without Deepak
// choosing it.
export const DAY_GAUGE_ENABLED_SETTING = 'dayGaugeEnabled';
