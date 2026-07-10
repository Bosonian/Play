import { db } from '../db/db';
import { learnedEstimate, naturalActualsByStepName } from './learning';
import { materializeScheduledDepartures, replaceUntouchedFutureAutoRows } from './materialize';

/** Same "meaningfully different, not just rounding noise" threshold as
 * calibration/learning.ts's Home suggestion cards (MIN_DELTA_MINUTES) —
 * kept as its own constant rather than importing that one, because the two
 * are conceptually independent knobs (a suggestion's threshold for
 * PROMPTING a tap vs. auto-learn's threshold for WRITING without one) that
 * happen to share a value today, not a single shared rule. */
const AUTO_LEARN_DELTA_MINUTES = 2;

/**
 * The opt-in automation engine (learning increment §3). For an
 * `autoLearn`-enabled template, recomputes each step's learned estimate
 * from that template's own natural (non-`wasReplanned`, non-batched) run
 * history, and writes any step whose learned value has drifted
 * `AUTO_LEARN_DELTA_MINUTES` or more from what's currently saved — then
 * propagates that change into the already-planned week the same way a
 * manual TemplateEdit save does (replaceUntouchedFutureAutoRows +
 * materializeScheduledDepartures), so a departure Deepak hasn't touched
 * yet actually reflects the new numbers instead of quietly diverging from
 * its own template.
 *
 * Effectful and Dexie-touching by design (unlike learning.ts, which stays
 * pure) — this is the one place a learned value writes itself without a
 * tap, which is exactly why it's opt-in (Template.autoLearn), and exactly
 * why every write it makes is labeled back to the user (TemplateEdit's
 * "learned · N runs" provenance line reads the same data this function
 * just wrote).
 *
 * Called fire-and-forget after a departure of an autoLearn template
 * reaches 'left' or 'done' (Runway.tsx's handleLeave, Home.tsx's
 * arrival-capture actions) — never at render, and never throws, matching
 * materializeScheduledDepartures's own "must never block the caller" rule
 * (see materialize.ts's own doc comment on why that matters for a
 * fire-and-forget background call).
 */
export async function applyAutoLearn(templateId: string): Promise<void> {
  try {
    const template = await db.templates.get(templateId);
    // undefined-as-null: a template saved before `autoLearn` existed has no
    // such property at all - `=== true` is what keeps that read correctly
    // "off" instead of accidentally truthy on some unrelated value.
    if (!template || template.autoLearn !== true) return;

    // templateId isn't an indexed field (see materialize.ts's own comment
    // on the same tradeoff) - load once, filter in JS.
    const allDepartures = await db.departures.toArray();
    const templateRuns = allDepartures.filter((d) => d.templateId === templateId);
    const naturalByName = naturalActualsByStepName(templateRuns);

    let changed = false;
    const nextSteps = template.steps.map((step) => {
      const actuals = naturalByName.get(step.name);
      if (!actuals) return step;
      const learned = learnedEstimate(actuals);
      if (!learned) return step; // under 3 samples - not enough evidence to write anything
      if (Math.abs(learned.minutes - step.minutes) < AUTO_LEARN_DELTA_MINUTES) return step;
      changed = true;
      return { ...step, minutes: learned.minutes };
    });

    if (!changed) return;

    await db.templates.update(templateId, { steps: nextSteps, updatedAt: new Date().toISOString() });

    // Same "replace untouched future rows, then re-materialize" chain
    // TemplateEdit's own save path runs after a manual step-minutes edit —
    // reused, not duplicated, so an auto-learned change reaches the
    // already-planned week exactly the same way a hand-typed one does.
    await replaceUntouchedFutureAutoRows(templateId);
    await materializeScheduledDepartures();
  } catch (err) {
    // Never throws — see this function's own doc comment above for why
    // both call sites (Runway.tsx's handleLeave, Home.tsx's
    // arrival-capture actions) depend on that.
    console.warn('Runway: auto-learn failed', err);
  }
}
