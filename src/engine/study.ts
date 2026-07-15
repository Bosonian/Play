// Recording a single answer: the one place that updates all three stores so a
// mode never has to. Called by Drill and Atlas after each question.
//
//  - SRS card: created on first exposure, then rescheduled by SM-2.
//  - Mastery: the answered fact's structure/tract climbs its Bloom rung.
//  - Attempt log: an append-only row powering Stats / weak-spots / retention.
//
// CRITICAL: this function must NEVER throw. Gameplay advances only after the
// save resolves, so a persistence failure that rejected here would freeze the
// current question (observed on device). The whole body is wrapped so a failed
// write is logged and swallowed — the player keeps going, we just lose that one
// row.

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
  // Cases records which localization axes were right (partial credit).
  axes?: Attempt['axes'];
}

function keepRecent(recent: boolean[], v: boolean): boolean[] {
  const next = [...recent, v];
  return next.slice(-8); // last 8 attempts drive the unlock rule (§5a)
}

// UUID with a fallback: crypto.randomUUID exists in secure contexts on modern
// browsers, but not in every Android WebView / older engine — and calling it
// when absent throws, which previously froze the answer flow.
function safeUuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Non-cryptographic fallback; fine for a local attempt-log id.
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function recordStudy(r: StudyResult): Promise<void> {
  try {
    const at = new Date().toISOString();

    // 1. Attempt log
    const attempt: Attempt = {
      id: safeUuid(),
      factId: r.factId,
      mode: r.mode,
      rung: r.rung,
      correct: r.correct,
      axes: r.axes,
      at,
    };
    const grade: Grade = r.grade ?? (r.correct ? 'good' : 'again');

    // All three writes in one transaction so a mid-way failure doesn't leave a
    // half-updated state (attempt logged but mastery/SRS not).
    await db.transaction('rw', db.attempts, db.mastery, db.srsCards, async () => {
      // 1. Attempt log
      await db.attempts.add(attempt);

      // 2. Mastery (only when attributable to a structure/tract + rung)
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
      const card = (await db.srsCards.get(r.factId)) ?? newCard(r.factId);
      await db.srsCards.put(schedule(card, grade));
    });
  } catch (err) {
    // Never let a persistence failure block the UI (design note above).
    // eslint-disable-next-line no-console
    console.error('[recordStudy] failed (progress not saved for this answer):', err);
  }
}
