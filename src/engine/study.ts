// Recording a single answer: the one place that updates all three stores so a
// mode never has to. Called by Drill and Atlas after each question.
//
//  - SRS card: created on first exposure, then rescheduled by SM-2.
//  - Mastery: the answered fact's structure/tract climbs its Bloom rung.
//  - Attempt log: an append-only row powering Stats / weak-spots / retention.

import { db } from '../db/db';
import type { Attempt, Mastery, Rung } from '../db/types';
import { newCard, schedule, type Grade } from './srs';

export interface StudyResult {
  factId: string;
  masteryKey?: string;
  rung?: Rung;
  mode: Attempt['mode'];
  correct: boolean;
  // Drill provides an explicit self-grade; Atlas/others derive it from correct.
  grade?: Grade;
}

function keepRecent(recent: boolean[], v: boolean): boolean[] {
  const next = [...recent, v];
  return next.slice(-8); // last 8 attempts drive the unlock rule (§5a)
}

export async function recordStudy(r: StudyResult): Promise<void> {
  const at = new Date().toISOString();

  // 1. Attempt log
  const attempt: Attempt = {
    id: crypto.randomUUID(),
    factId: r.factId,
    mode: r.mode,
    rung: r.rung,
    correct: r.correct,
    at,
  };
  await db.attempts.add(attempt);

  // 2. Mastery (only when the fact is attributable to a structure/tract + rung)
  if (r.masteryKey && r.rung) {
    const existing = await db.mastery.get(r.masteryKey);
    const m: Mastery = existing ?? { structureId: r.masteryKey, rungs: {} };
    const prev = m.rungs[r.rung] ?? { attempts: 0, correct: 0, recent: [] };
    m.rungs[r.rung] = {
      attempts: prev.attempts + 1,
      correct: prev.correct + (r.correct ? 1 : 0),
      recent: keepRecent(prev.recent, r.correct),
    };
    await db.mastery.put(m);
  }

  // 3. SRS schedule
  const grade: Grade = r.grade ?? (r.correct ? 'good' : 'again');
  const card = (await db.srsCards.get(r.factId)) ?? newCard(r.factId);
  await db.srsCards.put(schedule(card, grade));
}
