import { getISODay } from 'date-fns';
import type { TemplateSchedule } from '../db/types';

/**
 * How many calendar days ahead the materializer plans real departures for a
 * recurring template (recurring-departures increment). Short enough that
 * re-materializing weekly keeps alarms armed without the app ever needing a
 * background scheduler; see materialize.ts's own doc comment for the v1.5
 * follow-up (WorkManager) that would let this stop depending on the app
 * being opened at all.
 */
export const HORIZON_DAYS = 7;

export interface Occurrence {
  /** ISO date ("YYYY-MM-DD") this occurrence falls on — the join key
   * materialize.ts uses to tell "already planned" from "still missing". */
  date: string;
  /** The occurrence's actual instant: `date` at `schedule.time`, in local
   * wall-clock time. */
  at: Date;
}

function isoDateString(year: number, month: number, day: number): string {
  // Zero-padded YYYY-MM-DD, built from local Y/M/D parts rather than
  // `date.toISOString().slice(0, 10)` — toISOString first converts to UTC,
  // which would silently shift the date near midnight in any timezone
  // ahead of UTC (Central European Time, Deepak's own). Building the
  // string directly from the same y/m/d used to construct `at` below keeps
  // the two in agreement by construction.
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Every future occurrence of `schedule` in the next `horizonDays` calendar
 * days, starting today.
 *
 * For each of those days: included when the day's ISO weekday (1 Monday ..
 * 7 Sunday, `date-fns`'s `getISODay` — matches CLAUDE.md's Monday-first
 * week and `TemplateSchedule.days`'s own numbering) is in `schedule.days`,
 * AND the occurrence's instant (that day, at `schedule.time`) is still in
 * the future relative to `now`. That second condition is what makes "today
 * at 08:00, checked at 09:15" correctly skip today's occurrence while still
 * planning tomorrow's — a schedule day that's already happened today isn't
 * re-offered just because today is still nominally "day 0" of the horizon.
 *
 * Every occurrence instant is built with `new Date(y, m, d, hh, mm)` — local
 * wall-clock parts, not epoch-arithmetic date math (e.g. never
 * `startOfToday + offsetDays * 86_400_000`, which silently produces the
 * wrong wall-clock hour across a DST transition, since a calendar day isn't
 * always 24 real hours). Constructing each occurrence independently from
 * its own local Y/M/D + the schedule's HH:mm is DST-safe by construction:
 * every occurrence reads 08:00 local exactly when the schedule says 08:00,
 * whether or not a DST boundary falls somewhere in the horizon between
 * `now` and that occurrence. See recurrence.test.ts's DST-week case for a
 * pinned example spanning the (German) October clock change.
 */
/**
 * Every calendar date (YYYY-MM-DD, local Y/M/D — `isoDateString` above)
 * from today through `days - 1` days ahead. No weekday filter, no
 * past-time exclusion — unlike `occurrenceDates`, which answers "which
 * future instants does THIS schedule actually produce", this answers a
 * blunter question notifications.ts's `cancelStudyBlockAlarms` needs:
 * "every date a study-block alarm id could possibly have been minted for."
 * That has to include a day a schedule USED to cover before an edit
 * shrank it — by cancel time there's no schedule object left for
 * `occurrenceDates` to read that day back out of, so cancellation walks
 * plain calendar days instead of re-deriving them from a schedule.
 */
export function calendarDates(now: Date, days: number): string[] {
  const dates: string[] = [];
  for (let offset = 0; offset < days; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    dates.push(isoDateString(day.getFullYear(), day.getMonth(), day.getDate()));
  }
  return dates;
}

/**
 * Whether `next` is a materially different schedule than `existing` — same
 * time string and the same SET of weekdays (order-independent: `days` has
 * never been guaranteed sorted for every writer of this field historically,
 * only `toggleRepeatDay`'s own re-sort keeps it tidy going forward) counts
 * as "no change". `existing === null` (the template has no schedule yet)
 * always differs from any real `next`.
 *
 * Extracted as its own pure function (field report #12) so DepartureSetup's
 * save-with-repeat path can decide "does the reused template's schedule
 * need writing back" without Dexie in the loop — see recurrence.test.ts for
 * the pinned cases. Deliberately does not compare anything else about a
 * Template (steps, travelMinutes, ...); those are out of scope by design —
 * see DepartureSetup's handleSave comment on why a one-day tweak never
 * writes back to the template.
 */
export function scheduleDiffers(existing: TemplateSchedule | null, next: TemplateSchedule): boolean {
  if (existing == null) return true;
  if (existing.time !== next.time) return true;
  if (existing.days.length !== next.days.length) return true;
  const existingDays = new Set(existing.days);
  return next.days.some((day) => !existingDays.has(day));
}

export function occurrenceDates(now: Date, schedule: TemplateSchedule, horizonDays: number): Occurrence[] {
  const [hours, minutes] = schedule.time.split(':').map(Number);
  const occurrences: Occurrence[] = [];

  for (let offset = 0; offset < horizonDays; offset++) {
    // A plain calendar day, offset from today's local date — NOT from
    // `now`'s exact instant, so "today" always means the current wall-clock
    // day regardless of what time `now` is.
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate() + offset;

    // JS's Date constructor normalizes an out-of-range day (e.g. day 32 in
    // a 31-day month) into the correct following month/year, so this loop
    // never needs its own month-rollover arithmetic.
    const candidateDay = new Date(year, month, day);
    const isoWeekday = getISODay(candidateDay);
    if (!schedule.days.includes(isoWeekday)) continue;

    const at = new Date(candidateDay.getFullYear(), candidateDay.getMonth(), candidateDay.getDate(), hours, minutes);
    if (at.getTime() <= now.getTime()) continue;

    occurrences.push({
      date: isoDateString(candidateDay.getFullYear(), candidateDay.getMonth(), candidateDay.getDate()),
      at,
    });
  }

  return occurrences;
}
