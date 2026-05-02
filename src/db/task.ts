import { db } from './db';
import type { Task } from './types';

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
