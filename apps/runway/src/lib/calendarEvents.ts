import type { CalendarEvent } from '../native/calendar';
import type { Departure } from '../db/types';

/** Any departure whose appointmentAt falls within this many minutes of a
 * calendar event's begin time counts as "already planned for" that event —
 * see eventsWithoutDepartures below for why ±5 (not exact-match) is the
 * right window. */
const DEDUPE_WINDOW_MINUTES = 5;
const MS_PER_MINUTE = 60_000;

/**
 * Filters `events` down to the ones that have NO departure (any status —
 * planned, running, left, done, even abandoned) already anchored near them.
 * This is the guard that keeps "From your calendar" from becoming a nag:
 * once Deepak has planned a departure for an appointment, that appointment
 * must never show up again in this section asking to be planned a second
 * time, regardless of what happened to the departure afterwards (still
 * planned, already left for, or even abandoned — abandoning was a decision
 * already made, not an invitation to re-surface the same prompt).
 *
 * ±5 minutes, not an exact millisecond match: a departure planned FROM this
 * event (via "Plan departure" prefill) carries appointmentAt as whatever the
 * user's date/time picker round-trips through — DepartureSetup's <input
 * type="time"> is minute-granularity, so a calendar event's exact begin
 * second is never guaranteed to survive that round trip unchanged. A tight
 * window absorbs that without also absorbing a genuinely different
 * appointment that just happens to be close in time (two real appointments
 * five-plus minutes apart are common; two real appointments one minute
 * apart are not, in this app's actual use).
 *
 * Also drops all-day events itself — belt-and-suspenders alongside Home's
 * own upstream filter (an all-day event has no real clock time to plan a
 * departure against, so "From your calendar" never offers one regardless of
 * where the filtering happens), and it's what keeps this function fully
 * testable on its own, without needing Home.tsx's rendering pipeline in the
 * loop to exercise that rule.
 */
export function eventsWithoutDepartures(events: CalendarEvent[], departures: Departure[]): CalendarEvent[] {
  const windowMs = DEDUPE_WINDOW_MINUTES * MS_PER_MINUTE;
  const appointmentTimes = departures.map((departure) => new Date(departure.appointmentAt).getTime());

  return events
    .filter((event) => !event.allDay)
    .filter((event) => {
      const hasNearbyDeparture = appointmentTimes.some(
        (appointmentMs) => Math.abs(appointmentMs - event.beginEpochMs) <= windowMs,
      );
      return !hasNearbyDeparture;
    });
}
