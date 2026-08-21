import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Milestone } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { ScreenHeader } from '../ui/ScreenHeader';
import { TextAction } from '../ui/TextAction';
import { formatDateInput, formatDateLong, formatTime, formatTimeInput } from '../lib/format';
import { cancelMilestoneAlarm, ensurePermissions, scheduleMilestoneAlarm } from '../native/notifications';
import { refreshWidgets } from '../native/widgets';
import { refreshDayGauge } from '../lib/dayGaugeRefresh';

interface MilestoneEditProps {
  examId: string;
  onNavigate: (screen: Screen) => void;
}

/**
 * List + add/remove/edit for an exam's milestones (RUNWAY_PRUFUNG_PLAN.md
 * §3, §4.1, increment 4) — the real external dates (a booked mock oral) the
 * mode's mini-projections anchor to. One screen, no per-milestone route
 * (unlike ExamSetup/TopicEdit's separate screens): the form below doubles as
 * both "add a new milestone" and "edit the one currently selected", toggled
 * by `editingId`, because a milestone is a small enough object (name,
 * datetime, topic checkboxes) that a second screen per edit would be
 * ceremony without payoff.
 *
 * Unlike TopicEdit's "batch every change into one Save" pattern, each
 * milestone here is written to Dexie (and its alarm scheduled/cancelled)
 * immediately on its own Save/Delete — closer to TemplateEdit's shape than
 * TopicEdit's. That's not a style choice, it's forced by alarms: an alarm
 * has to be scheduled or cancelled against a specific, already-persisted
 * milestone id the moment that action happens, not batched up and resolved
 * against a diff at the end the way TopicEdit gets to for a plain data
 * table with no side effects of its own.
 */
export function MilestoneEdit({ examId, onNavigate }: MilestoneEditProps) {
  const topics = useLiveQuery(() => db.topics.where('examId').equals(examId).sortBy('order'), [examId]);
  const milestones = useLiveQuery(() => db.milestones.where('examId').equals(examId).sortBy('at'), [examId]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [topicIds, setTopicIds] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setEditingId(null);
    setName('');
    setDate('');
    setTime('');
    setTopicIds(new Set());
    setTouched(false);
  }

  function startEdit(milestone: Milestone) {
    const at = new Date(milestone.at);
    setEditingId(milestone.id);
    setName(milestone.name);
    setDate(formatDateInput(at));
    setTime(formatTimeInput(at));
    setTopicIds(new Set(milestone.topicIds));
    setTouched(false);
  }

  function toggleTopic(topicId: string) {
    setTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  }

  const atDate = date && time ? new Date(`${date}T${time}:00`) : null;
  const nameValid = name.trim().length > 0;
  const dateValid = atDate !== null && !Number.isNaN(atDate.getTime());
  // "editing an existing past milestone: allowed to view/delete, not to
  // save changes backdated — keep simple: date must be future on save"
  // (increment-4 spec). No special-casing for new-vs-edit here: requiring a
  // future date on every save is *already* exactly that rule — it lets a
  // past milestone sit in the list untouched (view/delete both skip this
  // check entirely) while blocking a Save that would otherwise silently
  // leave a backdated milestone's alarm logic in an undefined state.
  const dateInFuture = dateValid && atDate!.getTime() > Date.now();
  const canSave = nameValid && dateInFuture;

  const errors: string[] = [];
  if (touched) {
    if (!nameValid) errors.push('Name is required.');
    if (!dateValid) errors.push('Set a date and time.');
    else if (!dateInFuture) errors.push('Milestone must be in the future.');
  }

  async function handleSave() {
    setTouched(true);
    if (!canSave || !atDate || submitting) return;
    setSubmitting(true);

    const nowIso = new Date().toISOString();
    const existing = editingId ? milestones?.find((m) => m.id === editingId) : undefined;
    const milestone: Milestone = {
      id: editingId ?? crypto.randomUUID(),
      examId,
      name: name.trim(),
      at: atDate.toISOString(),
      topicIds: Array.from(topicIds),
      createdAt: existing?.createdAt ?? nowIso,
    };

    if (editingId) {
      await db.milestones.update(editingId, {
        name: milestone.name,
        at: milestone.at,
        topicIds: milestone.topicIds,
      });
    } else {
      await db.milestones.add(milestone);
    }

    // Lazy permission request, on first milestone save — never at app
    // launch (CLAUDE.md: no permission ambush) — same shape as
    // DepartureSetup.handleSave and SprintSetup.handleBegin. A denied or
    // failed schedule still leaves the milestone saved and the form reset:
    // the milestone itself is what matters, the alarm is a convenience on
    // top of it.
    try {
      const granted = await ensurePermissions();
      if (granted) await scheduleMilestoneAlarm(milestone);
    } catch (err) {
      console.warn('Runway: failed to schedule milestone alarm', err);
    }

    // Widgets increment: milestones aren't in the W1 snapshot itself, but
    // this call site is included per spec so a later widget revision that
    // does show them doesn't need to rediscover it (see refreshWidgets' own
    // doc comment).
    await refreshWidgets();
    await refreshDayGauge();

    resetForm();
    setSubmitting(false);
  }

  async function handleDelete(milestone: Milestone) {
    // Same native confirm() shortcut as TemplateEdit's handleDelete — the
    // one destructive action on this screen.
    if (!window.confirm(`Delete milestone "${milestone.name}"? This cannot be undone.`)) return;
    await cancelMilestoneAlarm(milestone.id);
    await db.milestones.delete(milestone.id);
    if (editingId === milestone.id) resetForm();
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Milestones" onBack={() => onNavigate({ name: 'exam' })} />
      </div>

      {/* The one framing line required by the increment spec — states
          plainly what a milestone is (and isn't) so the rest of the screen
          doesn't have to keep re-explaining it. */}
      <p className="text-sm text-slate-500">
        Milestones are real events with real people — a mock oral, a study session you committed to. Runway renders
        them; it does not invent them.
      </p>

      <div className="flex flex-col gap-2">
        {milestones && milestones.length === 0 && <p className="text-sm text-slate-500">No milestones yet.</p>}
        {milestones?.map((milestone) => {
          const at = new Date(milestone.at);
          return (
            <div
              key={milestone.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/60 bg-surface p-4"
            >
              <div className="flex flex-col">
                <p className="text-slate-100">{milestone.name}</p>
                <p className="text-sm tabular-nums text-slate-400">
                  {formatDateLong(at)} {formatTime(at)}
                </p>
              </div>
              <div className="flex gap-1">
                <TextAction onClick={() => startEdit(milestone)}>Edit</TextAction>
                <TextAction onClick={() => void handleDelete(milestone)}>Delete</TextAction>
              </div>
            </div>
          );
        })}
      </div>

      <section className="flex flex-col gap-4 border-t border-slate-800 pt-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
          {editingId ? 'Edit milestone' : 'Add milestone'}
        </h2>

        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Mock oral with ..."
          enterKeyHint="next"
        />

        <div className="flex gap-3">
          <TextField
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            containerClassName="flex-1"
          />
          <TextField
            label="Time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            enterKeyHint="done"
            containerClassName="flex-1"
          />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Topics covered</h3>
          {(topics ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">No topics yet — this milestone will cover the whole exam.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {topics?.map((topic) => (
                <label
                  key={topic.id}
                  className="flex min-h-12 items-center gap-2 rounded-lg border border-slate-800/60 bg-surface px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={topicIds.has(topic.id)}
                    onChange={() => toggleTopic(topic.id)}
                    aria-label={topic.name || 'Topic'}
                    className="size-6 shrink-0 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  />
                  <span className="text-slate-100">{topic.name}</span>
                </label>
              ))}
            </div>
          )}
          {topicIds.size === 0 && (topics ?? []).length > 0 && (
            <p className="text-sm text-slate-500">No topics selected: covers the whole exam.</p>
          )}
        </div>

        {errors.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-red-400">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}

        <div className="flex gap-3">
          <Button onClick={() => void handleSave()} disabled={submitting} className="flex-1">
            {editingId ? 'Save changes' : 'Add milestone'}
          </Button>
          {editingId && (
            <Button variant="secondary" onClick={resetForm} className="flex-1">
              Cancel
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
