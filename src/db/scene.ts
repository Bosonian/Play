import { db } from './db';
import type { DailyScene, SceneOutcome } from './types';
import { isThisWeek, todayISO } from '../lib/time';

interface PoolItem {
  id: string;
  title: string;
  active: boolean;
  lastShownAt: string | null;
}

// "Stupid is correct here" (brief §5.1). Pick a random active item that
// hasn't been shown this week. If everything has been shown, fall back to
// least-recently-shown (null counts as oldest, so brand-new items win).
function pickFromPool<T extends PoolItem>(pool: readonly T[]): T | null {
  const active = pool.filter((p) => p.active);
  if (active.length === 0) return null;

  const fresh = active.filter((p) => !isThisWeek(p.lastShownAt));
  const candidates = fresh.length > 0
    ? fresh
    : [...active].sort((a, b) => {
        const at = a.lastShownAt ? new Date(a.lastShownAt).getTime() : 0;
        const bt = b.lastShownAt ? new Date(b.lastShownAt).getTime() : 0;
        return at - bt;
      });

  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

// Returns today's DailyScene row. Creates it (with a freshly picked prop +
// scene, and lastShownAt updates on those seeds) if missing. Atomic — uses
// a transaction so a partial failure doesn't leave seeds marked-as-shown
// without a corresponding DailyScene row.
export async function getOrCreateTodayScene(): Promise<DailyScene> {
  const today = todayISO();

  const existing = await db.dailyScenes.where('date').equals(today).first();
  if (existing) return existing;

  return db.transaction(
    'rw',
    [db.dailyScenes, db.propSeeds, db.sceneSeeds],
    async () => {
      // Re-check inside the txn — guards against the race where two tabs
      // both miss the fast-path read above and try to insert simultaneously.
      const racedExisting = await db.dailyScenes.where('date').equals(today).first();
      if (racedExisting) return racedExisting;

      const props = await db.propSeeds.toArray();
      const scenes = await db.sceneSeeds.toArray();
      const prop = pickFromPool(props);
      const scene = pickFromPool(scenes);

      if (!prop || !scene) {
        // Should be impossible after ensureSeeded(). Fail loud rather than
        // insert a row with empty strings that the UI would silently render.
        throw new Error('No active props or scenes — seed pool is empty.');
      }

      const now = new Date().toISOString();
      await db.propSeeds.update(prop.id, { lastShownAt: now });
      await db.sceneSeeds.update(scene.id, { lastShownAt: now });

      const row: DailyScene = {
        id: crypto.randomUUID(),
        date: today,
        propTitle: prop.title,
        sceneTitle: scene.title,
        outcome: 'no_response',
        rotatedToProp: null,
        rotatedToScene: null,
      };
      await db.dailyScenes.add(row);
      return row;
    },
  );
}

// What's actually on screen right now — accounts for ↻ rotation.
// Original propTitle/sceneTitle are preserved on the row for history.
export function currentDisplay(scene: DailyScene): { prop: string; sceneTitle: string } {
  return {
    prop: scene.rotatedToProp ?? scene.propTitle,
    sceneTitle: scene.rotatedToScene ?? scene.sceneTitle,
  };
}

export async function recordOutcome(outcome: SceneOutcome): Promise<void> {
  const today = todayISO();
  await db.dailyScenes.where('date').equals(today).modify({ outcome });
}

// Swap to a different prop+scene, excluding what's currently displayed.
// outcome → 'rotated' (transient — flips back to 'done'/'skipped' if user
// resolves the rotated version with ✓/✗).
export async function rotate(): Promise<void> {
  const today = todayISO();
  await db.transaction(
    'rw',
    [db.dailyScenes, db.propSeeds, db.sceneSeeds],
    async () => {
      const row = await db.dailyScenes.where('date').equals(today).first();
      if (!row) return;

      const { prop: currentProp, sceneTitle: currentScene } = currentDisplay(row);

      const props = await db.propSeeds.toArray();
      const scenes = await db.sceneSeeds.toArray();

      // Exclude by title — we only have title in the DailyScene row, and
      // titles are effectively unique in the seed pool.
      const newProp = pickFromPool(props.filter((p) => p.title !== currentProp));
      const newScene = pickFromPool(scenes.filter((s) => s.title !== currentScene));

      // If the pool only has one active item (or one fresh item and a stale
      // pool), there's nothing different to swap to. Quietly do nothing —
      // the user can hit ✗ if they don't like what they see.
      if (!newProp || !newScene) return;

      const now = new Date().toISOString();
      await db.propSeeds.update(newProp.id, { lastShownAt: now });
      await db.sceneSeeds.update(newScene.id, { lastShownAt: now });

      await db.dailyScenes.update(row.id, {
        rotatedToProp: newProp.title,
        rotatedToScene: newScene.title,
        outcome: 'rotated',
      });
    },
  );
}
