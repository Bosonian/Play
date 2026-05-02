import { db } from './db';
import { ensureSeeded } from './seeds';

// Per the user's two-scoped-options decision: keep reflections + reflection
// preferences out of this reset. Wipes tasks (captured + completion history),
// daily scenes (today/yesterday/etc.), and the prop/scene pools — then
// re-seeds the pools to defaults via ensureSeeded().
export async function resetTasksAndSeeds(): Promise<void> {
  await db.transaction(
    'rw',
    [db.tasks, db.dailyScenes, db.propSeeds, db.sceneSeeds],
    async () => {
      await db.tasks.clear();
      await db.dailyScenes.clear();
      await db.propSeeds.clear();
      await db.sceneSeeds.clear();
    },
  );
  // ensureSeeded() opens its own transaction and only inserts when each
  // table is empty, so it's safe to call after the clears above.
  await ensureSeeded();
}

// Wipes everything in the database. Reflection preferences (day + time) are
// preserved on the UserProfile row because they're settings, not data — but
// consecutiveSkippedReflections is reset to 0 since the reflection history
// it counted against is gone.
export async function resetEverything(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.tasks,
      db.dailyScenes,
      db.propSeeds,
      db.sceneSeeds,
      db.weeklyReflections,
      db.userProfile,
    ],
    async () => {
      await db.tasks.clear();
      await db.dailyScenes.clear();
      await db.propSeeds.clear();
      await db.sceneSeeds.clear();
      await db.weeklyReflections.clear();

      const profile = await db.userProfile.toCollection().first();
      if (profile) {
        await db.userProfile.update(profile.id, {
          consecutiveSkippedReflections: 0,
        });
      }
    },
  );
  await ensureSeeded();
}
