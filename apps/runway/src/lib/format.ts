import { format } from 'date-fns';
import type { Exam } from '../db/types';

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

/** "1 Nov 2026" — long-form date display for anchors that sit months away
 * (an exam window, an exact exam date once known), where the year is part
 * of being exact rather than decoration. Distinct from formatDateDisplay's
 * near-term "Wed 9 Jul", which drops both the weekday's relevance and the
 * year because at departure-mode's day-or-two range they're always obvious
 * from context — an exam anchor has no such context to lean on. */
export function formatDateLong(date: Date): string {
  return format(date, 'd MMM yyyy');
}

/** "14 Dec" — day + short month, no weekday, no year. Used only for the
 * exam overview's "Ready by" centerpiece: unlike formatDateLong's anchor
 * dates (which sit far enough out — a whole exam season away — that the
 * year is part of being exact), a readyDate is always within a few months
 * of `now` by construction, so the year would be redundant noise on the
 * biggest number on the screen. Distinct from formatDateDisplay's "Wed 9
 * Jul" too: no weekday, because "Ready by" isn't read as "which day of the
 * week do I have to act by" the way an appointment is. */
export function formatDateMedium(date: Date): string {
  return format(date, 'd MMM');
}

/** "Exam window opens 1 Nov 2026" before the exact date is known; "Exam 1
 * Nov 2026" once it is — RUNWAY_PRUFUNG_PLAN.md §3: `examDate` "overrides
 * windowStart as the anchor" the moment it's set, and that's exactly the
 * swap this line makes. `windowStart`/`examDate` are ISO date-only strings
 * (YYYY-MM-DD); they're parsed with an explicit local midnight
 * (`${date}T00:00:00`, no `Z`) rather than handed straight to `new Date()`
 * — same reasoning as DepartureSetup's date+time construction: a bare
 * `new Date('2026-11-01')` parses as UTC midnight, which lands on the
 * previous calendar day once JS shifts it to a timezone behind UTC. */
export function formatExamAnchorLine(exam: Pick<Exam, 'windowStart' | 'examDate'>): string {
  const anchor = exam.examDate ?? exam.windowStart;
  const label = formatDateLong(new Date(`${anchor}T00:00:00`));
  return exam.examDate ? `Exam ${label}` : `Exam window opens ${label}`;
}

/** "{n} days of margin" / "{n} days past the exam" — the exam overview's
 * slack line for every state except 'done' (which has its own fixed
 * sentence, handled by the caller rather than here, since it doesn't
 * depend on slackDays at all). Only ever called with a non-null
 * slackDays — the 'late'-via-zero-pace ("Never") state has no margin
 * figure to report and the screen omits this line entirely in that case. */
export function formatExamMarginLine(slackDays: number): string {
  return slackDays >= 0 ? `${slackDays} days of margin` : `${Math.abs(slackDays)} days past the exam`;
}

/** "Ready by 1 Nov needs 6.5 h/week. This week: 2.0 of 6.5." — the exam
 * overview's actionable line (RUNWAY_PRUFUNG_PLAN.md §2). `anchor` here is
 * the exam's own anchor date (window start or exact date), not the
 * projected readyDate — the sentence reads as "here's the rate that gets
 * you ready in time for the exam", not a restatement of the centerpiece.
 * `requiredPaceHoursPerWeek` of `null` means the anchor is today or
 * already past, at which point "hours/week needed" isn't a meaningful
 * number — the line says so instead of dividing by zero. */
export function formatRequiredPaceLine(
  anchor: Date,
  requiredPaceHoursPerWeek: number | null,
  hoursThisWeek: number,
): string {
  if (requiredPaceHoursPerWeek === null) return 'The exam window is open.';
  const required = requiredPaceHoursPerWeek.toFixed(1);
  return `Ready by ${formatDateMedium(anchor)} needs ${required} h/week. This week: ${hoursThisWeek.toFixed(1)} of ${required}.`;
}

/** "24:59" while a sprint still has time left in its planned box; "+3:12"
 * once it's run past that (a negative `remainingSeconds` — the Sprint
 * screen deliberately does not clamp the countdown at 0:00, because
 * stopping the clock there would falsify the log: the sprint isn't over
 * until the user ends it, so time keeps counting, just upward and in the
 * overrun tone). mm:ss always, no hours component the way formatSlackLine
 * gains one past two hours — a sprint's plannedMinutes tops out at 90, so
 * that branch would never actually fire here. */
export function formatCountdown(remainingSeconds: number): string {
  const overrun = remainingSeconds < 0;
  const magnitude = Math.abs(remainingSeconds);
  const minutes = Math.floor(magnitude / 60);
  const seconds = magnitude % 60;
  const clock = `${minutes}:${String(seconds).padStart(2, '0')}`;
  return overrun ? `+${clock}` : clock;
}
