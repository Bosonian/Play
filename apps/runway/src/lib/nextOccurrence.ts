// Lifted out of Runway.tsx (re-anchor spec) so the tasks increment's
// TaskSetup screen can compute a deadline's "next occurrence of this clock
// time" the exact same way Runway's re-anchor panel already does, rather
// than a second, possibly-drifting copy of the same rolling logic.

/**
 * Combines today's date with an `<input type="time">` value ("HH:mm") into
 * the NEXT occurrence of that time from `now` — if today's instance has
 * already gone by, it rolls to tomorrow instead of landing in the past.
 * This is what makes "pick 00:30 while it's 23:50" mean "in 40 minutes",
 * not "in almost 24 hours" — the natural reading of a clock-time picker
 * that doesn't also ask for a date. Returns an Invalid Date (getTime() is
 * NaN) for anything that isn't a well-formed "HH:mm" string, which callers
 * (Runway.tsx's re-anchor panel, TaskSetup's deadline field) treat the same
 * as "nothing valid chosen yet" rather than crashing on it.
 */
export function nextOccurrenceOf(now: Date, hhmm: string): Date {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return new Date(NaN);
  const candidate = new Date(now);
  candidate.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
  return candidate;
}
