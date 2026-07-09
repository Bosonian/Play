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

/** "23 min of slack" / "2h 5m of slack" / "2h 5m past your appointment" —
 * the Runway screen's slack/overdue line. Switches from plain minutes to an
 * hours+minutes form once the magnitude reaches two hours: "134 min of
 * slack" doesn't read at a glance the way a clock duration does, and this
 * app's whole premise is numbers that are legible at a glance. */
export function formatSlackLine(slackMinutes: number): string {
  const magnitude = Math.abs(slackMinutes);
  const suffix = slackMinutes >= 0 ? 'of slack' : 'past your appointment';
  if (magnitude >= 120) {
    const hours = Math.floor(magnitude / 60);
    const minutes = magnitude % 60;
    return `${hours}h ${minutes}m ${suffix}`;
  }
  return `${magnitude} min ${suffix}`;
}

/** "Appointment 14:30" when `appointmentAt` falls on the same calendar day
 * as `now`; "Appointment Thu 10 Jul 14:30" otherwise — the date-anchored
 * form only earns its keep once "today" stops being obvious from context.
 * `now` is an explicit argument (not read internally) for the same reason
 * projection.ts takes one: testable without mocking the system clock, and
 * a caller that already has a `now` from useNow() can pass it straight
 * through instead of this reaching for a second, possibly-different clock
 * read. */
export function formatAppointmentLine(appointmentAt: Date, now: Date): string {
  const sameDay =
    appointmentAt.getFullYear() === now.getFullYear() &&
    appointmentAt.getMonth() === now.getMonth() &&
    appointmentAt.getDate() === now.getDate();
  return sameDay
    ? `Appointment ${formatTime(appointmentAt)}`
    : `Appointment ${formatDateDisplay(appointmentAt)} ${formatTime(appointmentAt)}`;
}
