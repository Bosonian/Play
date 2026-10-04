/**
 * Parses the narrow slice of RFC 5545 RRULE syntax this app actually needs
 * — field report #10: a calendar event ("Fortbildung", every Friday) was
 * offered by the calendar section, but the app never understood it was
 * recurring. This file answers exactly one question — "is this a plain
 * weekly-on-these-days rule, and if so, which days" — and returns `null` for
 * everything else, including every RRULE shape this app has no business
 * projecting onto its own once-a-week TemplateSchedule model (monthly,
 * yearly, every-N-weeks, a rule with an end COUNT/UNTIL, etc.). This is
 * deliberately NOT a general RRULE library: Home's calendar cards and
 * DepartureSetup's prefill only ever need "does this look like a
 * Template.schedule", never the general case.
 */

/** ISO weekday numbers (1 Monday .. 7 Sunday, matching db/types.ts's
 * TemplateSchedule.days and CLAUDE.md's Monday-first week) keyed by RRULE's
 * two-letter BYDAY codes. */
const DAY_CODE_TO_ISO_WEEKDAY: Record<string, number> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 7,
};

export interface ParsedWeeklyRrule {
  /** ISO weekday numbers (1 Monday .. 7 Sunday), de-duplicated and sorted —
   * the exact shape TemplateSchedule.days expects. */
  days: number[];
}

/**
 * Recognizes `FREQ=WEEKLY` with an explicit `BYDAY` list and, at most, an
 * `INTERVAL=1` (every week — the only interval this app's own
 * TemplateSchedule model can represent; `INTERVAL=2` etc. would mean
 * "every OTHER Friday," which has no equivalent field to hold it). Returns
 * `null` for anything else: a different FREQ, INTERVAL>1, or a string this
 * parser can't make sense of.
 *
 * BYDAY absent is deliberately `null`, not a guess. RFC 5545 says an
 * RRULE with no BYDAY repeats on the weekday of DTSTART — but DTSTART isn't
 * part of CalendarBridgePlugin's projection (see native/calendar.ts), so
 * this parser genuinely doesn't have the one fact it would need to answer
 * that case. An honest `null` (read by the caller as "couldn't tell") beats
 * silently guessing today's weekday from whatever `now` happens to be when
 * the event is read.
 *
 * Case-insensitive and tolerant of parameter order — real calendar apps
 * (Google Calendar, Samsung Calendar, Outlook) don't all write RRULE parts
 * in the same order, and some lower-case the FREQ/BYDAY values.
 */
export function parseWeeklyRrule(rrule: string | null): ParsedWeeklyRrule | null {
  if (rrule == null) return null;
  const trimmed = rrule.trim();
  if (trimmed === '') return null;

  // RRULE is a semicolon-separated list of NAME=VALUE parts in no
  // guaranteed order (RFC 5545) — collecting them into a map up front means
  // the checks below don't care whether FREQ or BYDAY came first.
  const parts = new Map<string, string>();
  for (const segment of trimmed.split(';')) {
    const eqIndex = segment.indexOf('=');
    if (eqIndex === -1) continue; // a malformed segment with no '=' — ignored, not fatal
    const name = segment.slice(0, eqIndex).trim().toUpperCase();
    const value = segment.slice(eqIndex + 1).trim().toUpperCase();
    if (name !== '') parts.set(name, value);
  }

  if (parts.get('FREQ') !== 'WEEKLY') return null;

  const interval = parts.get('INTERVAL');
  if (interval != null && interval !== '1') return null;

  const byDay = parts.get('BYDAY');
  if (byDay == null || byDay === '') return null; // see the doc comment above — an honest null, not a guess

  const days: number[] = [];
  for (const rawCode of byDay.split(',')) {
    // BYDAY values can carry a leading ordinal for MONTHLY/YEARLY rules
    // (e.g. "1MO", "-1FR") — not meaningful for FREQ=WEEKLY, but stripped
    // defensively rather than trusted to never appear, since this string
    // comes from an external calendar provider, not this app's own writer.
    const code = rawCode.trim().replace(/^[+-]?\d+/, '');
    const isoWeekday = DAY_CODE_TO_ISO_WEEKDAY[code];
    if (isoWeekday === undefined) return null; // one unrecognized day code makes the whole rule unparseable
    if (!days.includes(isoWeekday)) days.push(isoWeekday);
  }

  if (days.length === 0) return null;
  days.sort((a, b) => a - b);
  return { days };
}
