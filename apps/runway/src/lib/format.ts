import { format } from 'date-fns';

// Single choke point for time/date display so "24-hour, ISO-for-storage"
// (CLAUDE.md's European-default rule) can't quietly drift into en-US
// formatting somewhere else in the app.

/** "14:32" — 24-hour, always. Never locale-dependent (no AM/PM anywhere). */
export function formatTime(date: Date): string {
  return format(date, 'HH:mm');
}

/** "Wed 9 Jul" — for display only. Storage always uses ISO 8601 strings. */
export function formatDateDisplay(date: Date): string {
  return format(date, 'EEE d MMM');
}

/** "2026-07-09" — for <input type="date"> value binding and ISO storage. */
export function formatDateInput(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/** "14:32" — for <input type="time"> value binding (same shape as formatTime,
 * kept as a separate export so the two call sites — display vs. form input
 * — can diverge later without one silently affecting the other). */
export function formatTimeInput(date: Date): string {
  return format(date, 'HH:mm');
}
