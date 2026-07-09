import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Topic } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { ScreenHeader } from '../ui/ScreenHeader';

interface TopicEditProps {
  examId: string;
  onNavigate: (screen: Screen) => void;
}

/** Exact copy required by the spec — a topic with logged sprints can't be
 * removed in v1 because Sprint.topicId (db/types.ts) points at it for the
 * life of the prep window; deleting it would orphan that history. */
const HAS_SPRINTS_MESSAGE = 'This topic has logged sprints. Topics with history cannot be removed in v1.';

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

  const canSave = topics.every((topic) => topic.estimatedHours >= 0);

  async function handleSave() {
    if (!canSave) return;

    // Diff against the database's current rows for this exam, not against
    // `topics`' own history, so a topic removed and then re-added in the
    // same session (unlikely, but not prevented) just resolves to "still
    // there" rather than a delete-then-add.
    const currentIds = new Set(topics.map((t) => t.id));
    const removedIds = (savedTopics ?? []).filter((t) => !currentIds.has(t.id)).map((t) => t.id);

    await db.transaction('rw', db.topics, async () => {
      if (removedIds.length > 0) await db.topics.bulkDelete(removedIds);
      // `order` is written here, from final list position, rather than
      // tracked field-by-field through every addTopic/moveTopic call — the
      // array position *is* the order while editing, so recomputing it
      // once at save time is simpler than keeping a redundant field in
      // sync on every reorder.
      await db.topics.bulkPut(topics.map((topic, index) => ({ ...topic, examId, order: index })));
    });

    onNavigate({ name: 'exam' });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Edit topics" onBack={() => onNavigate({ name: 'exam' })} />
      </div>

      {savedTopics && topics.length === 0 && (
        <p className="text-sm text-slate-500">
          No topics yet. Add the chapters the exam covers, with honest hour estimates.
        </p>
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

      {!canSave && (
        <p className="text-sm text-red-400">Estimated hours cannot be negative.</p>
      )}

      <Button onClick={() => void handleSave()}>Save topics</Button>
    </div>
  );
}
