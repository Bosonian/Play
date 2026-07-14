import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { TaskUnit, WorkTask } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { NumberField } from '../ui/NumberField';
import { TextField } from '../ui/TextField';
import { ScreenHeader } from '../ui/ScreenHeader';
import { StepNameAutocomplete } from '../ui/StepNameAutocomplete';
import { stepNameLibrary } from '../lib/learning';
import { taskProjection } from '../lib/taskProjection';
import { formatSlackLine, formatTime } from '../lib/format';
import { nextOccurrenceOf } from '../lib/nextOccurrence';
import { logEvent } from '../lib/eventLog';

/** Same "defaults lean toward less, not more" reasoning (CLAUDE.md) behind
 * every other capped list in this app — 50 identical units is already a
 * long clinical list; past that, something's more likely mistyped than
 * genuinely a single task. */
const MAX_UNITS = 50;

interface TaskSetupProps {
  onNavigate: (screen: Screen) => void;
}

/**
 * Create-only setup for a Task — "Befunden EEG", 5 units, ~15 min each,
 * optionally due before the 16:00 Übergabe. Deliberately no edit path (the
 * App.tsx Screen union's `taskSetup` case takes no `taskId`, unlike
 * `departureSetup`'s optional one) — v1's scope is create + the live
 * TaskRun screen's own "Abandon this task" exit, not a general editor; see
 * README's "Tasks" section for this as a stated cut, not an oversight.
 */
export function TaskSetup({ onNavigate }: TaskSetupProps) {
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

    const task: WorkTask = {
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
    onNavigate({ name: 'task', taskId: task.id });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="New task" onBack={() => onNavigate({ name: 'home' })} />
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
    </div>
  );
}
