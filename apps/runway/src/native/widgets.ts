import { db } from '../db/db';
import { buildWidgetSnapshot } from '../lib/widgetSnapshot';
import { updateWidgetSnapshot } from './widgetBridge';

/**
 * Rebuilds the widget snapshot from the latest Dexie data and pushes it to
 * both native widgets (Prüfung and, as of W2, departure).
 *
 * Called explicitly from a short, fixed list of write sites, rather than
 * wired to a generic Dexie hook that fires on every write — a hook would
 * also fire on writes that don't touch anything either widget shows (a
 * template edit, a settings toggle), and it would be one more layer to
 * trace through to answer "why did the widget just refresh". An explicit
 * call list is more code at each site, but it's traceable: every call site
 * below is here because it just changed something a widget snapshot reads
 * (exam anchor, topic estimates, logged sprint hours, or — W2 — a
 * departure's status/steps/travel time).
 *
 * Current call sites:
 *   - main.tsx, once at startup (so neither widget is left showing stale
 *     data from before the app was last closed, even in a session where
 *     nothing else changes)
 *   - Sprint.tsx, after a sprint's `endedAt` is written (logged hours
 *     changed)
 *   - ExamSetup.tsx, after saving the exam (windowStart/examDate — the
 *     anchor — may have changed)
 *   - TopicEdit.tsx, after saving the topic list (estimatedHours, or which
 *     topics exist, may have changed)
 *   - MilestoneEdit.tsx, after saving a milestone (does not itself change
 *     anything either widget currently renders — no milestone data is in
 *     either W1/W2 snapshot — but is included per the increment spec so a
 *     later widget revision that does show milestones doesn't need to
 *     rediscover this call site)
 *   - ExamOverview.tsx's zombie-sprint resolution handlers (resolving a
 *     zombie writes or deletes a Sprint row exactly like an ordinary sprint
 *     end, so it can change logged hours the same way)
 *   - DepartureSetup.tsx, after saving a departure (name/appointment/steps/
 *     travel — everything the departure widget's nameLine/appointmentLine/
 *     planLine read — may have changed, or a brand-new departure may now be
 *     the soonest one)
 *   - Runway.tsx's handleLeave and handleAbandon (status leaves
 *     'planned'/'running', so this departure may no longer be the widget's
 *     source — or a different one now is)
 *   - Home.tsx's removeDeparture and the three arrival-capture writes
 *     (recordArrival/confirmLate/skipArrival) — same "status leaves
 *     planned/running" reasoning as handleLeave/handleAbandon above
 *   - useLiveTravel.ts's ≥3 min drift write (travelMinutes changed, which
 *     moves leaveBy and therefore the departure widget's planLine)
 *
 * Never throws: this always runs as a fire-and-forget side effect after a
 * Dexie write that has already succeeded on its own. A widget refresh
 * failing — no exam yet, no departures yet, a native call error, anything
 * else — must never surface as a failure of the screen action that
 * triggered it.
 */
export async function refreshWidgets(): Promise<void> {
  try {
    const exam = await db.exams.toCollection().first();
    const topics = exam ? await db.topics.where('examId').equals(exam.id).toArray() : [];
    const sprints = exam ? await db.sprints.where('examId').equals(exam.id).toArray() : [];
    // Same query Home's own Upcoming section runs (src/screens/Home.tsx) —
    // widgetSnapshot.ts's selectUpcomingDeparture then applies the
    // past-threshold filter and picks the soonest one, if any.
    const departures = await db.departures.where('status').anyOf(['planned', 'running']).sortBy('appointmentAt');
    const snapshot = buildWidgetSnapshot(new Date(), exam, topics, sprints, departures);
    await updateWidgetSnapshot(JSON.stringify(snapshot));
  } catch (err) {
    console.warn('Runway: failed to refresh widgets', err);
  }
}
