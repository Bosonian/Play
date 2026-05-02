import { db } from './db';
import type { PropSeed, SceneSeed } from './types';

export async function updateReflectionDay(day: number): Promise<void> {
  const profile = await db.userProfile.toCollection().first();
  if (!profile) return;
  await db.userProfile.update(profile.id, { reflectionDayOfWeek: day });
}

// `time` is "HH:MM" 24-hour, matching the field type and what the native
// <input type="time"> emits.
export async function updateReflectionTime(time: string): Promise<void> {
  const profile = await db.userProfile.toCollection().first();
  if (!profile) return;
  await db.userProfile.update(profile.id, { reflectionTime: time });
}

export async function addProp(title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const seed: PropSeed = {
    id: crypto.randomUUID(),
    title: trimmed,
    active: true,
    lastShownAt: null,
  };
  await db.propSeeds.add(seed);
}

export async function removeProp(id: string): Promise<void> {
  await db.propSeeds.delete(id);
}

export async function addScene(title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const seed: SceneSeed = {
    id: crypto.randomUUID(),
    title: trimmed,
    active: true,
    lastShownAt: null,
  };
  await db.sceneSeeds.add(seed);
}

export async function removeScene(id: string): Promise<void> {
  await db.sceneSeeds.delete(id);
}
