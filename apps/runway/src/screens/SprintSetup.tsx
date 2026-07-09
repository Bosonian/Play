import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Sprint } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { ScreenHeader } from '../ui/ScreenHeader';
import { useNow } from '../hooks/useNow';
import { findLiveSprint, loggedHoursByTopic } from '../lib/examProjection';
import { ensurePermissions, scheduleSprintEndAlarm } from '../native/notifications';
import { hapticImpact } from '../native/haptics';

interface SprintSetupProps {
  /** Prefill from ExamOverview's next-move card (guided-layer increment) —
   * present only when reached via that card's "Start" button. */
  topicId?: string;
  plannedMinutes?: number;
  onNavigate: (screen: Screen) => void;
}

const SPRINT_LENGTHS = [25, 50, 90] as const;
type SprintLength = (typeof SPRINT_LENGTHS)[number];

/** settings-table key for the start ritual's default checklist
 * (RUNWAY_PRUFUNG_PLAN.md §4.2). A dedicated table would be overkill for
 * one small ordered list of strings — the same reasoning db/types.ts's
 * `Setting` doc comment already gives for the first-run-card flag, just
 * with a JSON-array value instead of a single string. */
const RITUAL_SETTING_KEY = 'sprintRitual';

const DEFAULT_RITUAL_NAMES = ['Clear the desk.', 'Phone out of reach.', 'Open the material.'];

/** One ritual checklist row while it's being edited on this screen. `id` is
 * a local-only React key (never persisted) — what's actually saved, both
 * to the settings default and onto the Sprint itself, is just `name` and
 * `checkedAt`, matching SprintRitualItem in db/types.ts exactly. */
interface RitualItemDraft {
  id: string;
  name: string;
  checkedAt: string | null;
}

/**
 * The real ≤3-tap sprint setup flow (RUNWAY_PRUFUNG_PLAN.md §4.2): topic →
 * length → the start ritual → "Begin sprint". Replaces increment 2's
 * placeholder. All three choices live on one screen (no wizard paging) —
 * consistent with every other setup screen in this app (DepartureSetup,
 * ExamSetup, TopicEdit), and "≤3 taps" describes the three decisions
 * themselves, not a page-per-tap navigation structure.
 *
 * Reachable only from ExamOverview's "Start a sprint" button, which already
 * requires an exam to exist — same reachability argument ExamOverview
 * itself makes for reading the single exam directly rather than taking an
 * examId prop.
 */
export function SprintSetup({ topicId, plannedMinutes, onNavigate }: SprintSetupProps) {
  const exam = useLiveQuery(() => db.exams.toCollection().first(), []);
  const topics = useLiveQuery(
    async () => (exam ? db.topics.where('examId').equals(exam.id).sortBy('order') : []),
    [exam],
  );
  const sprints = useLiveQuery(
    async () => (exam ? db.sprints.where('examId').equals(exam.id).toArray() : []),
    [exam],
  );

  // Same tick cadence as ExamOverview's minute-level `now` — a live sprint
  // aging past LIVE_SPRINT_THRESHOLD_MS while this screen happens to be
  // sitting open is a rare edge case, not one that needs second-level
  // freshness to catch.
  const now = useNow(60_000);

  // Zombie-vs-live gate (F3): a genuinely running sprint (started recently,
  // never ended) blocks starting a second one — see findLiveSprint's own
  // comment in examProjection.ts for the shared threshold this and
  // ExamOverview's reconciliation card both key off. A ZOMBIE sprint
  // (unfinished but old) does NOT block here — that's deliberate: zombie
  // reconciliation lives on ExamOverview's card, and making this screen
  // also refuse to start would strand Deepak unable to do either.
  const liveSprint = findLiveSprint(sprints ?? [], now);
  const liveSprintTopicName = liveSprint ? topics?.find((topic) => topic.id === liveSprint.topicId)?.name : undefined;

  // Seeded once from props, not re-validated against `topics` once they
  // load: a prefilled topicId/plannedMinutes arrives only from an
  // immediate navigation right after ExamOverview's nextMove() computed it
  // against live data, so the gap in which the topic could vanish out from
  // under it (a concurrent edit in another tab, in the same instant) isn't
  // a case this single-user app needs to guard against. The ritual
  // checklist below still has to be completed regardless of prefill — the
  // prefill only removes the topic/length taps, never the initiation
  // ritual itself.
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(topicId ?? null);
  const [selectedMinutes, setSelectedMinutes] = useState<SprintLength | null>(
    plannedMinutes === 25 || plannedMinutes === 50 || plannedMinutes === 90 ? plannedMinutes : null,
  );
  const [ritualItems, setRitualItems] = useState<RitualItemDraft[]>([]);
  const [ritualLoaded, setRitualLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Loads the saved default ritual once, on mount — a plain one-shot
  // db.settings.get() rather than useLiveQuery, because nothing else in
  // the app writes this key while this screen is open (it's only ever
  // written by this screen's own handleBegin, below) and useLiveQuery's
  // `undefined` return can't distinguish "still loading" from "no row
  // saved yet" without extra state to track that itself. `cancelled`
  // guards the classic unmount-before-resolve race (e.g. the user taps
  // back before the read finishes).
  useEffect(() => {
    let cancelled = false;
    void db.settings.get(RITUAL_SETTING_KEY).then((setting) => {
      if (cancelled) return;
      let names: string[];
      try {
        const parsed: unknown = setting ? JSON.parse(setting.value) : DEFAULT_RITUAL_NAMES;
        // F8: JSON.parse succeeding doesn't mean the *shape* is right — a
        // settings row written by some future format, or hand-edited, could
        // parse fine as e.g. `{}` or `[3, 4]` and then blow up on
        // `.map((name) => ...)` below (or worse, silently render numbers as
        // ritual step names). Falls back to defaults exactly like a parse
        // failure does, rather than trusting an unverified shape.
        names = Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : DEFAULT_RITUAL_NAMES;
      } catch {
        names = DEFAULT_RITUAL_NAMES; // defensive: a corrupted settings row falls back rather than crashing setup
      }
      setRitualItems(names.map((name) => ({ id: crypto.randomUUID(), name, checkedAt: null })));
      setRitualLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleRitualItem(id: string) {
    void hapticImpact('light');
    setRitualItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, checkedAt: item.checkedAt === null ? new Date().toISOString() : null } : item)),
    );
  }

  function renameRitualItem(id: string, name: string) {
    setRitualItems((prev) => prev.map((item) => (item.id === id ? { ...item, name } : item)));
  }

  function addRitualItem() {
    setRitualItems((prev) => [...prev, { id: crypto.randomUUID(), name: '', checkedAt: null }]);
  }

  function removeRitualItem(id: string) {
    setRitualItems((prev) => prev.filter((item) => item.id !== id));
  }

  // Checking every item enables "Begin sprint" — the ritual IS the
  // task-initiation bridge (RUNWAY_PRUFUNG_PLAN.md §4.2), not paperwork
  // gating a button. Deliberately vacuously true on an empty list (every
  // item of nothing is checked): if Deepak strips the ritual down to
  // nothing, that's a real choice this screen respects rather than
  // inventing an unskippable step to enforce a checklist he's said he
  // doesn't want.
  const allRitualChecked = ritualItems.every((item) => item.checkedAt !== null);
  // `!liveSprint` (F3) belongs in canBegin, not just in what's rendered
  // below — canBegin is also what handleBegin's own guard checks, so this
  // is the one place that has to be right for both to agree.
  const canBegin =
    ritualLoaded && selectedTopicId !== null && selectedMinutes !== null && allRitualChecked && !liveSprint;

  const loggedByTopic = loggedHoursByTopic(sprints ?? []);

  async function handleBegin() {
    if (!exam || !canBegin || selectedTopicId === null || selectedMinutes === null || submitting) return;
    // Re-check right before writing (F3): the render above already hides
    // the whole form once a live sprint exists, but a sprint started
    // moments ago — e.g. from another tab — could still slip in between
    // that render and this tap. `sprints` is a live Dexie query, so this
    // reads current state rather than a stale render-time snapshot.
    if (findLiveSprint(sprints ?? [], new Date())) return;
    setSubmitting(true);
    void hapticImpact('light');

    const nowIso = new Date().toISOString();
    const sprint: Sprint = {
      id: crypto.randomUUID(),
      examId: exam.id,
      topicId: selectedTopicId,
      plannedMinutes: selectedMinutes,
      startedAt: nowIso,
      endedAt: null,
      ritual: ritualItems.map(({ name, checkedAt }) => ({ name, checkedAt })),
      createdAt: nowIso,
    };

    // Persist the (possibly just-edited) ritual as next time's default,
    // ahead of adding the sprint itself — same "settings row for a small
    // app-level flag" pattern as Home's first-run dismissal.
    await db.settings.put({
      key: RITUAL_SETTING_KEY,
      value: JSON.stringify(ritualItems.map((item) => item.name)),
    });
    await db.sprints.add(sprint);

    // Lazy permission request, on first sprint start — never at app launch
    // (CLAUDE.md: no permission ambush) — same shape as
    // DepartureSetup.handleSave. A denied or failed schedule still leaves
    // the sprint saved and navigation still happens: the sprint itself is
    // the thing that matters, the alarm is a convenience on top of it.
    try {
      const granted = await ensurePermissions();
      if (granted) {
        const topicName = topics?.find((t) => t.id === selectedTopicId)?.name ?? '';
        await scheduleSprintEndAlarm(sprint, topicName);
      }
    } catch (err) {
      console.warn('Runway: failed to schedule sprint end alarm', err);
    }

    onNavigate({ name: 'sprint', sprintId: sprint.id });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Start a sprint" onBack={() => onNavigate({ name: 'exam' })} />
      </div>

      {!exam || !topics ? null : liveSprint ? (
        // F3: a live sprint already exists — this screen's whole job
        // (topic → length → ritual → begin) doesn't apply until that one
        // is resolved, so the setup form is replaced entirely rather than
        // just disabling its "Begin sprint" button.
        <div className="flex flex-col gap-3">
          <p className="text-slate-100">{liveSprintTopicName ?? 'Untitled topic'}</p>
          <p className="text-sm text-slate-400">A sprint is already running.</p>
          <Button onClick={() => onNavigate({ name: 'sprint', sprintId: liveSprint.id })} className="w-full">
            Open sprint
          </Button>
        </div>
      ) : topics.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-500">No topics yet. Add topics before starting a sprint.</p>
          <button
            onClick={() => onNavigate({ name: 'topicEdit', examId: exam.id })}
            className="min-h-11 self-start text-sm font-medium text-sky-400 hover:text-sky-300"
          >
            Edit topics
          </button>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Topic</h2>
            <div className="flex flex-col gap-2">
              {topics.map((topic) => {
                const selected = selectedTopicId === topic.id;
                const logged = loggedByTopic.get(topic.id) ?? 0;
                return (
                  <button
                    key={topic.id}
                    type="button"
                    onClick={() => setSelectedTopicId(topic.id)}
                    className={`flex min-h-11 items-center justify-between rounded-md border px-4 py-3 text-left ${
                      selected ? 'border-sky-500 bg-slate-900' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                    }`}
                  >
                    <span className="text-slate-100">{topic.name}</span>
                    <span className="text-sm tabular-nums text-slate-400">
                      {logged.toFixed(1)} of {topic.estimatedHours.toFixed(1)} h
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Length</h2>
            <div className="flex gap-3">
              {SPRINT_LENGTHS.map((minutes) => {
                const selected = selectedMinutes === minutes;
                return (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => setSelectedMinutes(minutes)}
                    className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-md border py-4 text-2xl font-bold tabular-nums transition-colors ${
                      selected
                        ? 'border-sky-500 bg-sky-500 text-slate-950'
                        : 'border-slate-800 bg-slate-900 text-slate-100 hover:border-slate-700'
                    }`}
                  >
                    {minutes}
                    <span className={`text-xs font-normal ${selected ? 'text-slate-900' : 'text-slate-500'}`}>min</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Before you start</h2>
            <div className="flex flex-col gap-2">
              {ritualItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 p-2"
                >
                  <input
                    type="checkbox"
                    checked={item.checkedAt !== null}
                    onChange={() => toggleRitualItem(item.id)}
                    aria-label={`${item.name || 'Ritual step'} done`}
                    className="h-6 w-6 shrink-0 rounded border-slate-700 bg-slate-950 text-sky-500 focus:ring-sky-500"
                  />
                  <input
                    value={item.name}
                    onChange={(e) => renameRitualItem(item.id, e.target.value)}
                    placeholder="Ritual step"
                    aria-label="Ritual step name"
                    className="min-h-11 flex-1 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                  />
                  <button
                    onClick={() => removeRitualItem(item.id)}
                    aria-label={`Remove ${item.name || 'ritual step'}`}
                    className="flex min-h-11 min-w-11 items-center justify-center text-slate-500 hover:text-red-400"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <Button variant="secondary" onClick={addRitualItem}>
              Add step
            </Button>
          </section>

          <Button onClick={() => void handleBegin()} disabled={!canBegin || submitting} className="w-full">
            Begin sprint
          </Button>
        </>
      )}
    </div>
  );
}
