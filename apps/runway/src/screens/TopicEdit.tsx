import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Topic } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { ScreenHeader } from '../ui/ScreenHeader';
import { PRUEFUNG_GUIDED_DONE_KEY, isGuidedPassActive } from '../lib/guidedPass';
import { FACHARZT_NEUROLOGIE_TEMPLATE } from '../content/facharztNeurologieTemplate';
import { refreshWidgets } from '../native/widgets';

interface TopicEditProps {
  examId: string;
  onNavigate: (screen: Screen) => void;
}

/** Exact copy required by the spec — a topic with logged sprints can't be
 * removed in v1 because Sprint.topicId (db/types.ts) points at it for the
 * life of the prep window; deleting it would orphan that history. */
const HAS_SPRINTS_MESSAGE = 'This topic has logged sprints. Topics with history cannot be removed in v1.';

/** Upper clamp on estimatedHours (F5) — without one, a stray extra digit in
 * the hours field (or a corrupted/imported value) can produce a number
 * large enough that examProjection.ts's pace math overflows a JS number
 * (Infinity minutes-to-ready), which turns into an Invalid Date wherever
 * the ready date is displayed — a white-screen crash, not a validation
 * message. 10000h (~570 years at 4h/week) is comfortably past anything a
 * real exam topic could need while still catching the actual failure mode
 * (a typo like "50000" instead of "50"). examProjection.ts's own
 * projectFromAnchor also guards the overflow directly, as defense in depth
 * for any estimatedHours that reaches it by a path other than this form. */
const MAX_ESTIMATED_HOURS = 10000;
const ESTIMATED_HOURS_RANGE_MESSAGE = 'Estimated hours must be between 0 and 10000.';

/** Total placeholder hours across the draft template (§3) — computed once,
 * not hand-maintained as a second number that could drift from the array
 * it's summing. */
const TEMPLATE_TOTAL_HOURS = FACHARZT_NEUROLOGIE_TEMPLATE.reduce((sum, topic) => sum + topic.estimatedHours, 0);

/**
 * Add/remove/rename/reorder for an exam's topics (RUNWAY_PRUFUNG_PLAN.md
 * §4). Structurally this mirrors TemplateEdit's step editor — a local
 * array edited freely, persisted in one batch on Save — but topics are a
 * real table (db/db.ts v3), not an embedded array, because Sprints
 * reference a topicId for months (see Topic's doc comment in db/types.ts).
 * That difference only actually matters at two points below: `removeTopic`
 * has to ask the database (not just the local list) whether a topic is
 * safe to delete, and `handleSave` has to turn the local list back into
 * explicit adds/updates/deletes instead of overwriting one document.
 */
export function TopicEdit({ examId, onNavigate }: TopicEditProps) {
  const savedTopics = useLiveQuery(
    () => db.topics.where('examId').equals(examId).sortBy('order'),
    [examId],
  );

  const [topics, setTopics] = useState<Topic[]>([]);

  // Guided-layer increment (§2): this screen's guidance line is keyed off
  // the same flag as ExamSetup's — see lib/guidedPass.ts.
  const guidedSetting = useLiveQuery(() => db.settings.get(PRUEFUNG_GUIDED_DONE_KEY), []);
  const guidedPassActive = isGuidedPassActive(guidedSetting);

  // Populate once on load, same "runs when the query's identity changes,
  // which in practice means once" pattern as TemplateEdit's steps — this
  // screen is the only writer of the topics table while it's open, so
  // `savedTopics` doesn't change again until Save navigates away.
  useEffect(() => {
    if (savedTopics) setTopics(savedTopics);
  }, [savedTopics]);

  function addTopic() {
    setTopics((prev) => [
      ...prev,
      { id: crypto.randomUUID(), examId, name: '', estimatedHours: 0, order: prev.length },
    ]);
  }

  /** "Insert template" (§3): bulk-adds the draft topic list into the local,
   * unsaved editor state — same as every other edit on this screen, nothing
   * touches the database until "Save topics" is tapped. Only offered while
   * `topics` is empty (see the JSX below) and there's no existing state to
   * merge with, so this can safely replace rather than append. */
  function insertTemplate() {
    setTopics(
      FACHARZT_NEUROLOGIE_TEMPLATE.map((templateTopic, index) => ({
        id: crypto.randomUUID(),
        examId,
        name: templateTopic.name,
        estimatedHours: templateTopic.estimatedHours,
        order: index,
      })),
    );
  }

  // Only a topic that's already in the database can possibly have logged
  // sprints against it — one added this session and never saved has no id
  // any Sprint could reference yet — so the check below is skipped
  // entirely for brand-new rows rather than always querying for nothing.
  async function removeTopic(topic: Topic) {
    const persisted = await db.topics.get(topic.id);
    if (persisted) {
      const sprintCount = await db.sprints.where('topicId').equals(topic.id).count();
      if (sprintCount > 0) {
        window.alert(HAS_SPRINTS_MESSAGE);
        return;
      }
    }
    setTopics((prev) => prev.filter((t) => t.id !== topic.id));
  }

  function updateTopic(topicId: string, patch: Partial<Topic>) {
    setTopics((prev) => prev.map((t) => (t.id === topicId ? { ...t, ...patch } : t)));
  }

  function moveTopic(topicId: string, direction: -1 | 1) {
    setTopics((prev) => {
      const index = prev.findIndex((t) => t.id === topicId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const canSave = topics.every(
    (topic) => topic.estimatedHours >= 0 && topic.estimatedHours <= MAX_ESTIMATED_HOURS,
  );

  async function handleSave() {
    if (!canSave) return;

    // Diff against the database's current rows for this exam, not against
    // `topics`' own history, so a topic removed and then re-added in the
    // same session (unlikely, but not prevented) just resolves to "still
    // there" rather than a delete-then-add.
    const currentIds = new Set(topics.map((t) => t.id));
    const removedIds = (savedTopics ?? []).filter((t) => !currentIds.has(t.id)).map((t) => t.id);

    await db.transaction('rw', db.topics, db.milestones, async () => {
      if (removedIds.length > 0) await db.topics.bulkDelete(removedIds);
      // `order` is written here, from final list position, rather than
      // tracked field-by-field through every addTopic/moveTopic call — the
      // array position *is* the order while editing, so recomputing it
      // once at save time is simpler than keeping a redundant field in
      // sync on every reorder.
      await db.topics.bulkPut(topics.map((topic, index) => ({ ...topic, examId, order: index })));

      // F7: prune every deleted topic's id out of every milestone's
      // topicIds too, in the same transaction as the delete itself — a
      // milestone left pointing at a topic id that no longer exists is a
      // dangling reference (milestoneProjection.ts falls back to the whole
      // exam if this is ever missed some other way, but fixing it here
      // means that fallback is a safety net, not the normal path).
      if (removedIds.length > 0) {
        const removedIdSet = new Set(removedIds);
        const examMilestones = await db.milestones.where('examId').equals(examId).toArray();
        for (const milestone of examMilestones) {
          const prunedTopicIds = milestone.topicIds.filter((id) => !removedIdSet.has(id));
          if (prunedTopicIds.length !== milestone.topicIds.length) {
            await db.milestones.update(milestone.id, { topicIds: prunedTopicIds });
          }
        }
      }
    });

    // Widgets increment: estimatedHours (or which topics exist at all) may
    // have just changed - both feed straight into remainingHours, and
    // therefore the widget's ready-date projection.
    await refreshWidgets();

    onNavigate({ name: 'exam' });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Edit topics" onBack={() => onNavigate({ name: 'exam' })} />
      </div>

      {/* Guided-layer increment (§2): the walkthrough's second line. Shown
          regardless of whether the topic list is empty — it's about how to
          fill in the estimates about to be entered, not about there being
          nothing yet. */}
      {guidedPassActive && (
        <p className="text-sm text-slate-500">
          Honest hour estimates beat hopeful ones — the projection is only as true as these numbers.
        </p>
      )}

      {savedTopics && topics.length === 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-500">
            No topics yet. Add the chapters the exam covers, with honest hour estimates.
          </p>
          {/* Draft template offer (§3) - never shown once any topic exists
              (this whole block is inside the `topics.length === 0` guard),
              so there's no risk of it silently re-appearing and inviting a
              second bulk-insert on top of real data. */}
          <div className="flex flex-col gap-2 rounded-md border border-slate-800 bg-slate-900 p-3">
            <p className="text-sm text-slate-400">
              Start from a template — Facharzt Neurologie draft, {FACHARZT_NEUROLOGIE_TEMPLATE.length} topics, ~
              {TEMPLATE_TOTAL_HOURS} h. Adjust names and hours to the actual exam contents; the numbers are
              placeholders, not guidance.
            </p>
            <Button variant="secondary" onClick={insertTemplate} className="self-start">
              Insert template
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {topics.map((topic, index) => (
          <div
            key={topic.id}
            className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 p-2"
          >
            <div className="flex flex-col">
              <button
                onClick={() => moveTopic(topic.id, -1)}
                disabled={index === 0}
                aria-label={`Move ${topic.name || 'topic'} up`}
                className="flex h-5 w-8 items-center justify-center text-slate-500 hover:text-slate-200 disabled:opacity-30"
              >
                ▲
              </button>
              <button
                onClick={() => moveTopic(topic.id, 1)}
                disabled={index === topics.length - 1}
                aria-label={`Move ${topic.name || 'topic'} down`}
                className="flex h-5 w-8 items-center justify-center text-slate-500 hover:text-slate-200 disabled:opacity-30"
              >
                ▼
              </button>
            </div>

            <input
              value={topic.name}
              onChange={(e) => updateTopic(topic.id, { name: e.target.value })}
              placeholder="Topic name"
              aria-label="Topic name"
              className="min-h-11 flex-1 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />

            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={MAX_ESTIMATED_HOURS}
              step={0.5}
              value={topic.estimatedHours}
              aria-label={`${topic.name || 'Topic'} estimated hours`}
              onChange={(e) => {
                const parsed = Number.parseFloat(e.target.value);
                updateTopic(topic.id, { estimatedHours: Number.isNaN(parsed) ? 0 : parsed });
              }}
              className="min-h-11 w-20 rounded-md border border-slate-800 bg-slate-950 px-2 py-2 text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
            />
            <span className="text-sm text-slate-500">h</span>

            <button
              onClick={() => void removeTopic(topic)}
              aria-label={`Remove ${topic.name || 'topic'}`}
              className="flex min-h-11 min-w-11 items-center justify-center text-slate-500 hover:text-red-400"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      <Button variant="secondary" onClick={addTopic}>
        Add topic
      </Button>

      {!canSave && <p className="text-sm text-red-400">{ESTIMATED_HOURS_RANGE_MESSAGE}</p>}

      <Button onClick={() => void handleSave()}>Save topics</Button>
    </div>
  );
}
