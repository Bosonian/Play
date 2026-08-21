// Backdating increment: the field problem behind this file is a forgotten
// tap, not a wrong one. A step checked 25 minutes late teaches the learner a
// false 40-minute shower; a forgotten "I'm out the door" tap corrupts the
// slip record for that whole morning. The fix is never an automatic
// correction (the app never invents a timestamp on its own — see
// BackdateDialog.tsx and every screen that wires it up) but an explicit,
// BOUNDED one: a correction is only honest if it couldn't describe an
// impossible timeline — after whatever happened right before it, and no
// later than the instant the correction is actually being made.

/**
 * Whether `chosen` is a valid backdated timestamp, and the clamped instant
 * to use if so. Bounds are inclusive on both ends:
 *   - `chosen == lowerBound` is legitimate — e.g. an arrival step and the
 *     journey ending at literally the same instant is a real (if unusual)
 *     timeline, not an error.
 *   - `chosen == now` is legitimate — "it just finished, this second" is
 *     the ordinary, non-backdated case, and this function is also what a
 *     dialog's default (prefilled to now) validates against on first
 *     render, before the user has touched anything.
 * Anything outside `[lowerBound, now]` describes a timeline that can't have
 * happened: before `lowerBound` means before the previous event even
 * started, after `now` means a prediction, not a correction.
 */
export function clampBackdate(
  chosen: Date,
  lowerBound: Date,
  now: Date,
): { ok: true; at: Date } | { ok: false; reason: 'before-previous' | 'in-future' } {
  if (chosen.getTime() < lowerBound.getTime()) return { ok: false, reason: 'before-previous' };
  if (chosen.getTime() > now.getTime()) return { ok: false, reason: 'in-future' };
  return { ok: true, at: chosen };
}

/**
 * Combines today's date with an `<input type="time">` value ("HH:mm") into
 * the NEAREST PAST occurrence of that time relative to `reference` (=now) —
 * the mirror image of `nextOccurrenceOf` (src/lib/nextOccurrence.ts): that
 * function rolls FORWARD to tomorrow when today's instance has already
 * passed, because a re-anchor target or a task deadline is always something
 * still ahead. A correction is the opposite kind of question — "when did
 * this already happen" — so it rolls BACKWARD to yesterday when today's
 * instance of that clock time hasn't happened yet. This is what makes
 * picking 23:50 while it's 00:10 mean "last night, 20 minutes ago," not
 * "23 hours and 40 minutes from now."
 *
 * Same parsing shape as nextOccurrenceOf on purpose (identical regex, same
 * Invalid-Date-on-bad-input contract) — the two are meant to be read
 * side by side as mirrors of each other, not as two independently-evolved
 * parsers that could quietly drift apart.
 */
export function hhmmToDateNear(hhmm: string, reference: Date): Date {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return new Date(NaN);
  const candidate = new Date(reference);
  candidate.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (candidate.getTime() > reference.getTime()) candidate.setDate(candidate.getDate() - 1);
  return candidate;
}
