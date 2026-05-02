import { differenceInDays } from 'date-fns';
import { db } from './db';
import type { ReframeMode, Task } from './types';

// Tunables — exported for the UI (e.g. to hide the snooze button at cap).
export const SURFACE_THRESHOLD_DAYS = 3;
export const MAX_SURFACED = 3;
export const SNOOZE_CAP = 2;

// Save a captured task. Trims surrounding whitespace; refuses empty / pure-
// whitespace titles (returns null without inserting). The body of the title
// is preserved as-is — voice dictation often produces extra inner spaces or
// punctuation drift, and rewriting the user's own phrasing would feel worse
// than the noise itself.
export async function createTask(rawTitle: string): Promise<Task | null> {
  const title = rawTitle.trim();
  if (!title) return null;

  const task: Task = {
    id: crypto.randomUUID(),
    title,
    originalTitle: null,
    reframedAs: null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    completedAt: null,
    abandonedAt: null,
    snoozeCount: 0,
    lastSurfacedAt: null,
  };
  await db.tasks.add(task);
  return task;
}

// "What's been sitting" surface (brief §5.3) — up to 3 oldest pending tasks
// where the effective age is > 3 days. Effective age uses the more recent of
// createdAt and lastSurfacedAt, so a snooze hides the task for another 3
// days without losing the original capture timestamp.
export async function listSurfaced(): Promise<Task[]> {
  const pending = await db.tasks
    .where('status')
    .equals('pending')
    .sortBy('createdAt');

  const now = new Date();
  const surfaceable = pending.filter((t) => {
    const effective = new Date(t.lastSurfacedAt ?? t.createdAt);
    return differenceInDays(now, effective) > SURFACE_THRESHOLD_DAYS;
  });

  return surfaceable.slice(0, MAX_SURFACED);
}

export async function markTaskDone(id: string): Promise<void> {
  await db.tasks.update(id, {
    status: 'complete',
    completedAt: new Date().toISOString(),
  });
}

export async function dropTask(id: string): Promise<void> {
  await db.tasks.update(id, {
    status: 'abandoned',
    abandonedAt: new Date().toISOString(),
  });
}

// Brief §5.3 caps snoozes at 2 — the UI hides the snooze button at the cap,
// and this guard is defense-in-depth for races (two tabs, etc.).
export async function snoozeTask(id: string): Promise<void> {
  await db.transaction('rw', db.tasks, async () => {
    const task = await db.tasks.get(id);
    if (!task || task.snoozeCount >= SNOOZE_CAP) return;
    await db.tasks.update(id, {
      snoozeCount: task.snoozeCount + 1,
      lastSurfacedAt: new Date().toISOString(),
    });
  });
}

// Replace title with the reframe text. Preserves the FIRST original across
// re-reframes — if the user reframes Joker then later Kinesthete, the
// originalTitle still points to the captured text, not the Joker version.
//
// Note: we deliberately do NOT update lastSurfacedAt here. A reframe is a
// reframing of the same task, not a deferral; if the user doesn't act on
// the reframed version, it should keep showing tomorrow.
export async function reframeTask(
  id: string,
  newTitle: string,
  mode: ReframeMode,
): Promise<void> {
  await db.transaction('rw', db.tasks, async () => {
    const task = await db.tasks.get(id);
    if (!task) return;
    await db.tasks.update(id, {
      title: newTitle,
      originalTitle: task.originalTitle ?? task.title,
      reframedAs: mode,
    });
  });
}
