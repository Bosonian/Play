import { db } from '../db/db';
import { buildWidgetSnapshot } from '../lib/widgetSnapshot';
import { updateWidgetSnapshot } from './widgetBridge';

/**
 * Rebuilds the widget snapshot from the latest Dexie data and pushes it to
 * the native Prüfung widget.
 *
 * Called explicitly from a short, fixed list of write sites, rather than
 * wired to a generic Dexie hook that fires on every write — a hook would
 * also fire on writes that don't touch anything the widget shows (a
 * departure edit, a settings toggle), and it would be one more layer to
 * trace through to answer "why did the widget just refresh". An explicit
 * call list is more code at each site, but it's traceable: every call site
 * below is here because it just changed something the widget snapshot
 * reads (exam anchor, topic estimates, or logged sprint hours).
 *
 * Current call sites:
 *   - main.tsx, once at startup (so the widget isn't left showing stale
 *     data from before the app was last closed, even in a session where
 *     nothing else changes)
 *   - Sprint.tsx, after a sprint's `endedAt` is written (logged hours
 *     changed)
 *   - ExamSetup.tsx, after saving the exam (windowStart/examDate — the
 *     anchor — may have changed)
 *   - TopicEdit.tsx, after saving the topic list (estimatedHours, or which
 *     topics exist, may have changed)
 *   - MilestoneEdit.tsx, after saving a milestone (does not itself change
 *     anything the Prüfung widget currently renders — no milestone data is
 *     in the W1 snapshot — but is included per the increment spec so a
 *     later widget revision that does show milestones doesn't need to
 *     rediscover this call site)
 *   - ExamOverview.tsx's zombie-sprint resolution handlers (resolving a
 *     zombie writes or deletes a Sprint row exactly like an ordinary sprint
 *     end, so it can change logged hours the same way)
 *
 * Never throws: this always runs as a fire-and-forget side effect after a
 * Dexie write that has already succeeded on its own. A widget refresh
 * failing — no exam yet, a native call error, anything else — must never
 * surface as a failure of the screen action that triggered it.
 */
export async function refreshWidgets(): Promise<void> {
  try {
    const exam = await db.exams.toCollection().first();
    const topics = exam ? await db.topics.where('examId').equals(exam.id).toArray() : [];
    const sprints = exam ? await db.sprints.where('examId').equals(exam.id).toArray() : [];
    // upcomingDeparture: always null in this increment — departure mode's
    // widget data is W2 (see WidgetSnapshot's own doc comment).
    const snapshot = buildWidgetSnapshot(new Date(), exam, topics, sprints, null);
    await updateWidgetSnapshot(JSON.stringify(snapshot));
  } catch (err) {
    console.warn('Runway: failed to refresh widgets', err);
  }
}
