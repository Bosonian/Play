import { db } from '../db/db';
import type { Setting } from '../db/types';

// The first-open walkthrough (increment: guided layer) chains three
// existing screens — ExamSetup, TopicEdit, ExamOverview — with a few extra
// guidance lines shown only until Deepak finishes (or skips) his first
// sprint. All three screens read/write the same one flag, so its key and
// the "is the walkthrough still active" check live here once rather than
// being redeclared per screen and risking the three copies drifting apart.

/** settings-table key (db/db.ts's Setting table, same pattern as Home's
 * firstRunDismissed and SprintSetup's sprintRitual) for "has the guided
 * walkthrough finished". Set the moment Deepak either starts his first
 * sprint from the walkthrough's one-time card or taps "Later." on it — from
 * then on every guided-only line disappears for good. */
export const PRUEFUNG_GUIDED_DONE_KEY = 'pruefungGuidedDone';

/**
 * Whether guided-pass-only copy should still show. Treats a settings row
 * that hasn't resolved YET the same as one that's genuinely never been
 * written — both read as "still active" here.
 *
 * That's the opposite call from Home.tsx's showFirstRunCard, which only
 * treats `undefined` as "still loading" and otherwise requires the row to
 * exist and be `'true'`. This flag is never pre-seeded (same as
 * firstRunDismissed — see db.ts's on('populate') comment), so Home's
 * stricter check can't actually distinguish "loading" from "row never
 * written" — both produce plain JS `undefined` from useLiveQuery — which
 * means its card can never show at all on a fresh install. Not fixed here
 * (out of this increment's scope, and departure mode's own card isn't
 * touched), but worth flagging: the same bug would silently disable this
 * walkthrough too if it copied that pattern. Instead, treating `undefined`
 * as "active" costs at most one render's flicker of guidance text before
 * the real value loads — a plain-text line, not a modal — and is correct
 * once the query settles either way.
 */
export function isGuidedPassActive(setting: Pick<Setting, 'value'> | undefined): boolean {
  return setting?.value !== 'true';
}

/** Ends the walkthrough for good — called both when Deepak starts his
 * first sprint from the one-time card and when he dismisses it with
 * "Later.": either action is "done deciding for now", so both count. */
export async function markGuidedPassDone(): Promise<void> {
  await db.settings.put({ key: PRUEFUNG_GUIDED_DONE_KEY, value: 'true' });
}
