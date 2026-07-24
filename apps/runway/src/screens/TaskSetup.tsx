import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { TaskUnit, WorkTask } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { NumberField } from '../ui/NumberField';
import { TextField } from '../ui/TextField';
import { ScreenHeader } from '../ui/ScreenHeader';
import { StepNameAutocomplete } from '../ui/StepNameAutocomplete';
import { TextAction } from '../ui/TextAction';
import { stepNameLibrary } from '../lib/learning';
import { taskProjection } from '../lib/taskProjection';
import { formatSlackLine, formatTime } from '../lib/format';
import { nextOccurrenceOf } from '../lib/nextOccurrence';
import { ensurePermissions, scheduleTaskAlarm } from '../native/notifications';
import { logEvent } from '../lib/eventLog';
import { refreshWidgets } from '../native/widgets';
import { refreshDayGauge } from '../lib/dayGaugeRefresh';

/** Same "defaults lean toward less, not more" reasoning (CLAUDE.md) behind
 * every other capped list in this app — 50 identical units is already a
 * long clinical list; past that, something's more likely mistyped than
 * genuinely a single task. */
const MAX_UNITS = 50;

interface TaskSetupProps {
  onNavigate: (screen: Screen) => void;
  /**
   * Anti-rot increment 2 (0.38.0): set only by Home's "To arm" shelf card
   * tap. Puts this screen into PROMOTE mode — the ordinary Save button
   * UPDATEs the existing 'captured' row (units/deadline/status, keeping its
   * original `createdAt` — see handleSave's own comment for why) instead of
   * adding a new task, and a "Discard capture" action becomes available.
   * Still not a general edit path (see this component's own doc comment
   * below) — the only editable row this ever reaches is one in 'captured'
   * status, never a 'planned'/'running' one.
   */
  capturedTaskId?: string;
}

/**
 * Create-only setup for a Task — "Befunden EEG", 5 units, ~15 min each,
 * optionally due before the 16:00 Übergabe. Deliberately no GENERAL edit
 * path (the App.tsx Screen union's `taskSetup` case takes no `taskId` the
 * way `departureSetup`'s optional one does) — v1's scope is create + the
 * live TaskRun screen's own "Abandon this task" exit, not a general editor;
 * see README's "Tasks" section for this as a stated cut, not an oversight.
 *
 * `capturedTaskId` (anti-rot increment 2) is a narrower, deliberate
 * exception to that cut, not a reversal of it: it only ever arms a
 * name-only 'captured' row into a real plan, never edits an already-planned
 * or running task's units/deadline. See `capturedTaskId`'s own prop comment.
 */
export function TaskSetup({ onNavigate, capturedTaskId }: TaskSetupProps) {
  const [name, setName] = useState('');
  const [unitCount, setUnitCount] = useState(1);
  const [minutesPerUnit, setMinutesPerUnit] = useState(15);
  // Blank means "no deadline" — same "blank time field = genuinely unset,
  // never a fabricated default" convention DepartureSetup's own Time field
  // uses, rather than a separate enabled/disabled toggle on top of it.
  const [deadlineTime, setDeadlineTime] = useState('');
  const [touched, setTouched] = useState(false);

  // "learned · N runs" provenance caption (learning increment §5's pattern,
  // reused here) — set only when a name is CHOSEN from the autocomplete
  // dropdown, cleared on any further typing, same as TemplateEdit/
  // DepartureSetup never claiming provenance for a name that hasn't
  // actually been confirmed as a match.
  //
  // `applied` tracks a separate fact from `runCount`: `learnedEstimate`
  // (learning.ts) needs 3+ samples before it returns anything at all, so a
  // name with 1 or 2 recorded runs has real history (`runCount > 0`) but no
  // learned minutes were actually applied to the form (`entry.learnedMinutes
  // === null`) — the caption below has to say which of those happened,
  // not just "learned" regardless (that word claims minutesPerUnit was
  // actually updated, which under 3 samples it wasn't).
  const [selectedEntry, setSelectedEntry] = useState<{ runCount: number; applied: boolean } | null>(null);

  // Estimation-bias increment (0.30.0): provenance of `minutesPerUnit` —
  // see db/types.ts's TaskUnit.estimateSource doc comment. Starts 'manual'
  // (a freshly opened form's default of 15 is exactly Deepak's own baseline
  // guess until something else overwrites it), flips to 'learned' only when
  // the autocomplete's onSelect actually applies a learned value below, and
  // flips right back to 'manual' on ANY subsequent hand-edit of the Minutes
  // per unit field — the same "his edit always wins" rule TemplateEdit's
  // provenance label already lives by.
  const [estimateSource, setEstimateSource] = useState<'manual' | 'learned'>('manual');

  // Task-memory autocomplete (learning increment §5, extended by the tasks
  // increment): every step name ever used across departures/templates, PLUS
  // every task name ever used — the whole point of a shared, name-keyed
  // corpus is that "Befunden EEG" typed here surfaces the same learned
  // minutes it would if it had been typed as a departure step name, and
  // vice versa. Loaded once, unfiltered, same "small tables, load whole"
  // pattern DepartureSetup/TemplateEdit already use.
  const allDepartures = useLiveQuery(() => db.departures.toArray(), []);
  const allTemplates = useLiveQuery(() => db.templates.toArray(), []);
  const allTasks = useLiveQuery(() => db.tasks.toArray(), []);
  const library = useMemo(
    () => stepNameLibrary(allDepartures ?? [], allTemplates ?? [], allTasks ?? []),
    [allDepartures, allTemplates, allTasks],
  );

  // Promote mode (anti-rot increment 2): the 'captured' row this screen is
  // arming, or `undefined` while `capturedTaskId` is unset (ordinary create)
  // or the read is still in flight. Same "load once, prefill via a mount
  // effect" pattern DepartureSetup.tsx uses for `existingDeparture` — see
  // the effect just below.
  const capturedTask = useLiveQuery(
    () => (capturedTaskId ? db.tasks.get(capturedTaskId) : undefined),
    [capturedTaskId],
  );

  // Prefills the name field ONCE the captured row loads — mirrors
  // DepartureSetup's own existingDeparture effect. Only `name` is prefilled
  // (a captured task has no units/minutes/deadline to prefill FROM — that's
  // capture's whole point, see TaskSetup's capture action below) so the rest
  // of the form starts exactly as blank as an ordinary create does.
  useEffect(() => {
    if (capturedTask) setName(capturedTask.name);
  }, [capturedTask]);

  const errors: string[] = [];
  if (touched) {
    if (name.trim() === '') errors.push('Name this task.');
    if (unitCount < 1 || unitCount > MAX_UNITS) errors.push(`Units must be between 1 and ${MAX_UNITS}.`);
    if (minutesPerUnit <= 0) errors.push('Minutes per unit must be a positive number.');
  }

  const canSave = name.trim() !== '' && unitCount >= 1 && unitCount <= MAX_UNITS && minutesPerUnit > 0;

  // Live preview — same "evaluate the equation with the form's own current
  // values, nothing checked yet" pattern DepartureSetup's own preview line
  // uses (computeStartBy/computeProjection there, taskProjection here).
  // Deadline resolves through nextOccurrenceOf exactly as it will on save,
  // so the preview never shows a stale reading of what Save would produce.
  const now = new Date();
  const previewDeadlineAt = deadlineTime.trim() !== '' ? nextOccurrenceOf(now, deadlineTime).toISOString() : null;
  const preview =
    canSave
      ? taskProjection(now, {
          units: Array.from({ length: unitCount }, () => ({
            id: 'preview',
            name: name.trim(),
            plannedMinutes: minutesPerUnit,
            checkedAt: null,
          })),
          deadlineAt: previewDeadlineAt,
        })
      : null;

  async function handleSave() {
    setTouched(true);
    if (!canSave) return;

    const trimmedName = name.trim();
    const nowIso = new Date().toISOString();
    // Unit name = task name (db/types.ts's TaskUnit doc comment) — TaskRun
    // renders the "EEG 1" / "EEG 2" ordinals at display time from this same
    // name plus list position, never stored per-unit.
    const units: TaskUnit[] = Array.from({ length: unitCount }, () => ({
      id: crypto.randomUUID(),
      name: trimmedName,
      plannedMinutes: minutesPerUnit,
      checkedAt: null,
      estimateSource,
    }));
    const deadlineAt = deadlineTime.trim() !== '' ? nextOccurrenceOf(new Date(), deadlineTime).toISOString() : null;

    let task: WorkTask;
    if (capturedTaskId && capturedTask) {
      // Promote mode: UPDATE the existing 'captured' row rather than adding
      // a second one — `createdAt` is deliberately left untouched (not
      // reset to `nowIso`) so the capture's age stays honest history: "this
      // sat on the shelf for 6 days before it got armed" is a true and
      // useful fact, not something arming should erase.
      task = {
        ...capturedTask,
        name: trimmedName,
        units,
        deadlineAt,
        status: 'planned',
        startedAt: null,
      };
      await db.tasks.update(capturedTaskId, {
        name: trimmedName,
        units,
        deadlineAt,
        status: 'planned',
        startedAt: null,
      });
      void logEvent('task', `Task armed from capture: ${task.name}.`);
    } else {
      task = {
        id: crypto.randomUUID(),
        name: trimmedName,
        units,
        deadlineAt,
        status: 'planned',
        startedAt: null,
        createdAt: nowIso,
      };
      await db.tasks.add(task);
      void logEvent('task', `Task created: ${task.name}.`);
    }

    // Anti-rot increment (0.37.0): mirrors DepartureSetup's own save path —
    // request notification permission lazily, only now that there's
    // actually something to schedule (a deadline-less task has nothing for
    // scheduleTaskAlarm to arm, so there's nothing worth an Android
    // permission prompt for). Failure here is deliberately non-blocking:
    // the task is already saved and navigation still happens either way —
    // Home's notification-permission banner is the non-blocking surface for
    // "alerts won't fire", not this form.
    if (deadlineAt !== null) {
      try {
        const granted = await ensurePermissions();
        if (granted) {
          await scheduleTaskAlarm(task);
        }
      } catch (err) {
        console.warn('Runway: failed to schedule task alarm', err);
      }
    }

    // Anti-rot increment 3 (0.39.0): a saved task (create OR promote) may
    // now be the tasks widget's headline, or move its armed/to-arm counts —
    // audited as a missing call site during that increment (this path had
    // no refreshWidgets/refreshDayGauge call at all before). Fire-and-forget
    // and after everything else, same "already saved either way" reasoning
    // the alarm-scheduling try/catch just above already uses.
    void refreshWidgets();
    void refreshDayGauge();

    onNavigate({ name: 'task', taskId: task.id });
  }

  // Capture action (anti-rot increment 2): the whole point is skipping the
  // arming cost, so this deliberately does NOT run the unit-count/minutes/
  // deadline validation `handleSave` above enforces — a captured task has
  // none of those fields yet (`units: []`, `deadlineAt: null`) and isn't
  // pretending to. Only shown on the ordinary create form (`!capturedTask`,
  // see the render below) — capturing a capture makes no sense.
  const canCapture = name.trim() !== '';

  async function handleCapture() {
    if (!canCapture) return;
    const trimmedName = name.trim();
    const task: WorkTask = {
      id: crypto.randomUUID(),
      name: trimmedName,
      units: [],
      deadlineAt: null,
      status: 'captured',
      startedAt: null,
      createdAt: new Date().toISOString(),
    };
    await db.tasks.add(task);
    void logEvent('task', `Task captured: ${task.name}.`);
    // W3 audit (see handleSave's own comment): a new capture moves the
    // tasks widget's toArmCount.
    void refreshWidgets();
    void refreshDayGauge();
    onNavigate({ name: 'home' });
  }

  // Discard (promote mode only): deletes the captured row outright rather
  // than abandoning it — 'abandoned' is a status TaskRun/History give real
  // meaning to (a task that was actually started and then let go); a
  // capture that never became a real plan has no run to abandon, so the
  // honest action is removing the row entirely, same as it never existed.
  async function handleDiscardCapture() {
    if (!capturedTask) return;
    if (!window.confirm(`Discard this capture? ${capturedTask.name} is deleted.`)) return;
    await db.tasks.delete(capturedTask.id);
    void logEvent('task', `Capture discarded: ${capturedTask.name}.`);
    // W3 audit (see handleSave's own comment): a discarded capture moves
    // the tasks widget's toArmCount back down.
    void refreshWidgets();
    void refreshDayGauge();
    onNavigate({ name: 'home' });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title={capturedTaskId ? 'Arm task' : 'New task'} onBack={() => onNavigate({ name: 'home' })} />
      </div>

      <div>
        <StepNameAutocomplete
          value={name}
          library={library}
          onNameChange={(next) => {
            setName(next);
            setSelectedEntry(null);
          }}
          onSelect={(entry) => {
            setName(entry.name);
            if (entry.learnedMinutes !== null) {
              setMinutesPerUnit(entry.learnedMinutes);
              setEstimateSource('learned');
            }
            setSelectedEntry({ runCount: entry.runCount, applied: entry.learnedMinutes !== null });
          }}
        />
        {selectedEntry !== null && selectedEntry.runCount > 0 && (
          <p className="mt-1.5 text-sm text-slate-500">
            {selectedEntry.applied
              ? `learned · ${selectedEntry.runCount} runs`
              : `${selectedEntry.runCount} run${selectedEntry.runCount === 1 ? '' : 's'} recorded. A learned time needs 3.`}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <NumberField
          label="Units"
          hint={`Identical units of work, up to ${MAX_UNITS}.`}
          value={unitCount}
          min={1}
          onChange={setUnitCount}
        />
        <NumberField
          label="Minutes per unit"
          value={minutesPerUnit}
          min={1}
          onChange={(value) => {
            setMinutesPerUnit(value);
            setEstimateSource('manual');
          }}
        />
      </div>

      <TextField
        label="Deadline"
        type="time"
        value={deadlineTime}
        onChange={(e) => setDeadlineTime(e.target.value)}
        hint="Optional — e.g. before the 16:00 Übergabe. Leave blank for no deadline."
        enterKeyHint="done"
      />

      {preview && (
        <p className="tabular-nums text-slate-400">
          Finishes by <span className="font-semibold text-slate-100">{formatTime(preview.projectedFinish)}</span>
          {preview.slackMinutes !== null && (
            <>
              {' · '}
              {formatSlackLine(preview.slackMinutes, 'past the deadline')}
            </>
          )}
        </p>
      )}

      {errors.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-red-400">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <Button onClick={() => void handleSave()}>Save task</Button>

      {/* Capture action (anti-rot increment 2): ordinary create form only —
          arming an existing capture already has its own commitment (Save
          task, above); offering "Capture for later" too would just be a
          second way to defer the same row. */}
      {!capturedTaskId && (
        <TextAction onClick={() => void handleCapture()} disabled={!canCapture} className="self-start disabled:opacity-40">
          Capture for later
        </TextAction>
      )}

      {/* Promote mode only — deleting the row this screen exists to arm. */}
      {capturedTaskId && capturedTask && (
        <TextAction onClick={() => void handleDiscardCapture()} className="self-start">
          Discard capture
        </TextAction>
      )}
    </div>
  );
}
