import { db } from './db';
import type { WeeklyReflection } from './types';
import { weekStartISO } from '../lib/time';

// Save the user's reflection for the current ISO week. Resets the
// consecutive-skipped counter (which drives the §5.4 / step 8 observation
// banner).
//
// Idempotent: if a record already exists for this week (e.g. the user
// previously hit Skip), it gets replaced with the saved content. Saving
// always wins over a prior skip in the same week.
export async function saveReflection(
  didYouPlay: string,
  nextWeekScene: string,
): Promise<void> {
  await db.transaction('rw', [db.weeklyReflections, db.userProfile], async () => {
    const weekStart = weekStartISO();
    const existing = await db.weeklyReflections
      .where('weekStartDate')
      .equals(weekStart)
      .first();

    const record: WeeklyReflection = {
      id: existing?.id ?? crypto.randomUUID(),
      weekStartDate: weekStart,
      didYouPlay,
      nextWeekScene,
      submittedAt: new Date().toISOString(),
    };
    // put = upsert by primary key; reuses existing.id when replacing a skip.
    await db.weeklyReflections.put(record);

    const profile = await db.userProfile.toCollection().first();
    if (profile && profile.consecutiveSkippedReflections > 0) {
      await db.userProfile.update(profile.id, { consecutiveSkippedReflections: 0 });
    }
  });
}

// Mark this week's reflection as skipped. Stores an empty WeeklyReflection
// row (so the dialog won't reappear this week) and increments the counter.
//
// No-op if a reflection for this week already exists — once saved, "skip"
// shouldn't be able to undo it.
export async function skipReflection(): Promise<void> {
  await db.transaction('rw', [db.weeklyReflections, db.userProfile], async () => {
    const weekStart = weekStartISO();
    const existing = await db.weeklyReflections
      .where('weekStartDate')
      .equals(weekStart)
      .first();
    if (existing) return;

    const record: WeeklyReflection = {
      id: crypto.randomUUID(),
      weekStartDate: weekStart,
      didYouPlay: '',
      nextWeekScene: '',
      submittedAt: new Date().toISOString(),
    };
    await db.weeklyReflections.add(record);

    const profile = await db.userProfile.toCollection().first();
    if (profile) {
      await db.userProfile.update(profile.id, {
        consecutiveSkippedReflections: profile.consecutiveSkippedReflections + 1,
      });
    }
  });
}

// Past reflections in reverse-chronological order. Hides skipped weeks
// (empty content) — the brief frames "see past reflections" as a record of
// what was noticed, not an audit of dismissals.
export async function listReflections(): Promise<WeeklyReflection[]> {
  const all = await db.weeklyReflections.orderBy('weekStartDate').reverse().toArray();
  return all.filter(
    (r) => r.didYouPlay.trim() !== '' || r.nextWeekScene.trim() !== '',
  );
}
