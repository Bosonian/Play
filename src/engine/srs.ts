// Spaced repetition — SM-2 (design doc §6 Drill). The scheduler decides *what*
// is due; the skin/question layer decides *how* it's shown.
//
// The player self-grades with three buttons — Again / Hard / Good — mapped to
// SM-2 quality values here. Tradeoff (named per project voice): three buttons
// drop the full 0–5 scale's "Easy" bucket, so we lose its interval stretch.
// Accepted for a calmer phone UI; revisit if intervals feel too tight.

import type { SrsCard } from '../db/types';
import { todayISO, addDaysISO } from '../lib/date';

export type Grade = 'again' | 'hard' | 'good';

// Again = a lapse (q<3); Hard = a hard pass (q=3); Good = a clean pass (q=5).
const QUALITY: Record<Grade, number> = { again: 2, hard: 3, good: 5 };

export function newCard(factId: string): SrsCard {
  return {
    id: factId,
    factId,
    ease: 2.5,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    dueOn: todayISO(), // due immediately on creation
  };
}

// Apply a grade to a card, returning the updated card (pure — the caller
// persists it). Standard SM-2: a lapse resets the rep count and schedules for
// tomorrow; a pass grows the interval by the ease factor.
export function schedule(card: SrsCard, grade: Grade): SrsCard {
  const q = QUALITY[grade];
  const today = todayISO();

  let { ease, intervalDays, reps, lapses } = card;

  if (q < 3) {
    reps = 0;
    intervalDays = 1;
    lapses += 1;
  } else {
    if (reps === 0) intervalDays = 1;
    else if (reps === 1) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * ease);
    reps += 1;
  }

  // SM-2 ease update; floored at 1.3 so a hard card can't spiral.
  ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ease < 1.3) ease = 1.3;

  return {
    ...card,
    ease,
    intervalDays,
    reps,
    lapses,
    lastReviewedOn: today,
    dueOn: addDaysISO(today, intervalDays),
  };
}
