import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { StepTemplate, Template, TemplateSchedule } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { NumberField } from '../ui/NumberField';
import { TextField } from '../ui/TextField';
import { ScreenHeader } from '../ui/ScreenHeader';
import { cancelDepartureAlarms } from '../native/notifications';
import { materializeScheduledDepartures } from '../lib/materialize';

interface TemplateEditProps {
  id?: string;
  onNavigate: (screen: Screen) => void;
}

const BLANK: Omit<Template, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  destination: '',
  travelMinutes: 20,
  bufferMinutes: 10,
  steps: [],
  schedule: null,
};

/** Monday-first (CLAUDE.md), ISO weekday numbers 1..7 paired with the
 * single-letter chip label TemplateEdit renders. Two Tuesdays/Saturdays in
 * a row read fine as single letters in a 7-chip row; `ariaLabel` carries
 * the full name so the chip's accessible name isn't just "T". */
const DAY_CHIPS: { iso: number; label: string; ariaLabel: string }[] = [
  { iso: 1, label: 'M', ariaLabel: 'Monday' },
  { iso: 2, label: 'T', ariaLabel: 'Tuesday' },
  { iso: 3, label: 'W', ariaLabel: 'Wednesday' },
  { iso: 4, label: 'T', ariaLabel: 'Thursday' },
  { iso: 5, label: 'F', ariaLabel: 'Friday' },
  { iso: 6, label: 'S', ariaLabel: 'Saturday' },
  { iso: 7, label: 'S', ariaLabel: 'Sunday' },
];

const DEFAULT_REPEAT_TIME = '08:00';

export function TemplateEdit({ id, onNavigate }: TemplateEditProps) {
  // Loads once per `id`; existing is undefined while loading, null if the
  // id doesn't resolve to anything (shouldn't normally happen from Home's
  // own links, but guards against a stale reference).
  const existing = useLiveQuery(() => (id ? db.templates.get(id) : undefined), [id]);

  const [name, setName] = useState(BLANK.name);
  const [destination, setDestination] = useState(BLANK.destination);
  const [travelMinutes, setTravelMinutes] = useState(BLANK.travelMinutes);
  const [bufferMinutes, setBufferMinutes] = useState(BLANK.bufferMinutes);
  const [steps, setSteps] = useState<StepTemplate[]>(BLANK.steps);

  // Recurring-departures increment. `repeatDays` holds ISO weekday numbers
  // (1 Monday .. 7 Sunday); kept as three separate pieces of local state
  // rather than one TemplateSchedule-shaped object so the day-chip toggle
  // and time input can update independently, same pattern the rest of this
  // form already uses for every other field.
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatTime, setRepeatTime] = useState(DEFAULT_REPEAT_TIME);
  const [repeatDays, setRepeatDays] = useState<number[]>([]);

  // Populate the form once the existing template has loaded. Runs only
  // when `existing` changes identity (i.e. once, on load) rather than on
  // every render, so typing in the form afterwards doesn't get clobbered.
  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setDestination(existing.destination);
      setTravelMinutes(existing.travelMinutes);
      setBufferMinutes(existing.bufferMinutes);
      setSteps(existing.steps);
      // undefined-as-null: a row saved before this field existed has no
      // `schedule` property at all, not a `null` one — treat both the same
      // (db/types.ts's TemplateSchedule doc comment; the v0.13.0 review
      // caught exactly this bug class for originalAppointmentAt).
      if (existing.schedule != null) {
        setRepeatEnabled(true);
        setRepeatTime(existing.schedule.time);
        setRepeatDays(existing.schedule.days);
      } else {
        setRepeatEnabled(false);
        setRepeatTime(DEFAULT_REPEAT_TIME);
        setRepeatDays([]);
      }
    }
  }, [existing]);

  function toggleRepeatDay(iso: number) {
    setRepeatDays((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort()));
  }

  function addStep() {
    setSteps((prev) => [...prev, { id: crypto.randomUUID(), name: '', minutes: 5 }]);
  }

  function removeStep(stepId: string) {
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
  }

  function updateStep(stepId: string, patch: Partial<StepTemplate>) {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
  }

  function moveStep(stepId: string, direction: -1 | 1) {
    setSteps((prev) => {
      const index = prev.findIndex((s) => s.id === stepId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const repeatValid = !repeatEnabled || (repeatTime !== '' && repeatDays.length > 0);
  const canSave = name.trim().length > 0 && travelMinutes >= 0 && bufferMinutes >= 0 && repeatValid;

  /**
   * Deletes every FUTURE, UNTOUCHED auto-created departure for this
   * template and cancels their alarms — the "replace" half of
   * materializeScheduledDepartures's own dedup rule, run right before that
   * function is called again below so a schedule/step/travel edit actually
   * reaches the week that's already planned instead of only affecting
   * occurrences materialized from now on.
   *
   * Deliberately narrow: `startedAt == null` excludes anything Deepak has
   * already begun — a departure he's mid-prep on is HIS now, not the
   * template's to silently rewrite out from under him, matching the same
   * "touched rows are the user's" rule DepartureSetup's own edit path
   * applies to individual steps. `appointmentAt` in the future excludes
   * anything already past, which the materializer's own stale-sweep (not
   * this function) is responsible for.
   */
  async function replaceUntouchedFutureAutoRows(templateId: string): Promise<void> {
    const nowMs = Date.now();
    // Same "load planned rows, filter the rest in JS" pattern as
    // materialize.ts's sweep — templateId isn't an indexed field.
    const plannedDepartures = await db.departures.where('status').equals('planned').toArray();
    for (const departure of plannedDepartures) {
      if (departure.templateId !== templateId) continue;
      if (departure.scheduledForDate == null) continue; // a manual departure, not the materializer's to replace
      if (departure.startedAt != null) continue; // touched — his now, not ours to replace
      if (new Date(departure.appointmentAt).getTime() <= nowMs) continue; // already past

      await db.departures.delete(departure.id);
      await cancelDepartureAlarms(departure.id);
    }
  }

  async function handleSave() {
    if (!canSave) return;
    const now = new Date().toISOString();
    const schedule: TemplateSchedule | null = repeatEnabled ? { time: repeatTime, days: repeatDays } : null;
    const templateId = id ?? crypto.randomUUID();

    if (id && existing) {
      await db.templates.update(id, {
        name: name.trim(),
        destination: destination.trim(),
        travelMinutes,
        bufferMinutes,
        steps,
        updatedAt: now,
        schedule,
      });
    } else {
      await db.templates.add({
        id: templateId,
        name: name.trim(),
        destination: destination.trim(),
        travelMinutes,
        bufferMinutes,
        steps,
        createdAt: now,
        updatedAt: now,
        schedule,
      });
    }

    // Always sweep, whether the schedule changed, was newly turned on, or
    // just got turned off — a step/travel/time edit and an off-toggle both
    // need the already-planned future week cleared of rows that no longer
    // reflect it. Re-materializing (which recreates whatever's still
    // missing for the horizon) only makes sense when a schedule remains —
    // toggling off means the sweep IS the whole story, per the spec's
    // "toggling off: same delete sweep, no re-materialize."
    await replaceUntouchedFutureAutoRows(templateId);
    if (schedule != null) {
      await materializeScheduledDepartures();
    }

    onNavigate({ name: 'home' });
  }

  async function handleDelete() {
    if (!id) return;
    // A native confirm() is a deliberate shortcut for increment 1 — it's
    // the one destructive action on this screen and doesn't warrant a
    // custom dialog component yet. Revisit if more destructive actions
    // show up later and the jarring native styling starts to stand out.
    if (window.confirm(`Delete template "${name}"? This cannot be undone.`)) {
      // A scheduled template may have up to a week of auto-created future
      // departures with armed alarms — deleting the template without this
      // sweep would leave them firing for a plan that no longer exists
      // (orphan gap flagged in the recurring-departures review). Manual and
      // already-started departures survive, same rule as the save path.
      await replaceUntouchedFutureAutoRows(id);
      await db.templates.delete(id);
      onNavigate({ name: 'home' });
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader
          title={id ? 'Edit template' : 'New template'}
          onBack={() => onNavigate({ name: 'home' })}
        />
      </div>

      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Klinik"
        enterKeyHint="next"
      />

      <TextField
        label="Destination"
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
        placeholder="e.g. Klinikum Stuttgart"
        hint="Where you're going. Used for the Maps link on the Runway screen."
        enterKeyHint="next"
      />

      <NumberField
        label="Travel minutes"
        hint="From a quick look at Maps. This won't auto-update with live traffic."
        value={travelMinutes}
        onChange={setTravelMinutes}
      />

      <NumberField
        label="Friction buffer"
        hint="Keys, toilet, one more thing."
        value={bufferMinutes}
        onChange={setBufferMinutes}
      />

      <section className="flex flex-col gap-3 rounded-md border border-slate-800 bg-slate-900 p-3">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={repeatEnabled}
            onChange={(e) => setRepeatEnabled(e.target.checked)}
            className="h-6 w-6 shrink-0 rounded border-slate-700 bg-slate-950 text-sky-500 focus:ring-sky-500"
          />
          <span className="flex-1 text-slate-100">Repeat this departure</span>
        </label>

        {repeatEnabled && (
          <div className="flex flex-col gap-3">
            <TextField
              label="Time"
              type="time"
              value={repeatTime}
              onChange={(e) => setRepeatTime(e.target.value)}
              containerClassName="w-32"
            />

            <div className="flex gap-1.5">
              {DAY_CHIPS.map((day) => {
                const selected = repeatDays.includes(day.iso);
                return (
                  <button
                    key={day.iso}
                    type="button"
                    onClick={() => toggleRepeatDay(day.iso)}
                    aria-label={day.ariaLabel}
                    aria-pressed={selected}
                    className={`flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-md border text-sm font-medium ${
                      selected
                        ? 'border-sky-500 bg-sky-500/20 text-sky-300'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>

            {!repeatValid && (
              <p className="text-sm text-red-400">Set a time and pick at least one day.</p>
            )}

            <p className="text-sm text-slate-500">
              Planned 7 days ahead. Open Runway at least once a week to keep alarms armed.
            </p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Steps</h2>

        <div className="flex flex-col gap-2">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 p-2">
              <div className="flex flex-col">
                <button
                  onClick={() => moveStep(step.id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${step.name || 'step'} up`}
                  className="flex h-5 w-8 items-center justify-center text-slate-500 hover:text-slate-200 disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  onClick={() => moveStep(step.id, 1)}
                  disabled={index === steps.length - 1}
                  aria-label={`Move ${step.name || 'step'} down`}
                  className="flex h-5 w-8 items-center justify-center text-slate-500 hover:text-slate-200 disabled:opacity-30"
                >
                  ▼
                </button>
              </div>

              <input
                value={step.name}
                onChange={(e) => updateStep(step.id, { name: e.target.value })}
                placeholder="Step name"
                aria-label="Step name"
                className="min-h-11 flex-1 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
              />

              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={step.minutes}
                aria-label={`${step.name || 'Step'} minutes`}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10);
                  updateStep(step.id, { minutes: Number.isNaN(parsed) ? 0 : parsed });
                }}
                className="min-h-11 w-16 rounded-md border border-slate-800 bg-slate-950 px-2 py-2 text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
              />

              <button
                onClick={() => removeStep(step.id)}
                aria-label={`Remove ${step.name || 'step'}`}
                className="flex min-h-11 min-w-11 items-center justify-center text-slate-500 hover:text-red-400"
              >
                &times;
              </button>
            </div>
          ))}
        </div>

        <Button variant="secondary" onClick={addStep}>
          Add step
        </Button>
      </section>

      <div className="mt-4 flex flex-col gap-3">
        <Button onClick={handleSave} disabled={!canSave}>
          Save template
        </Button>
        {id && (
          <Button variant="danger" onClick={handleDelete}>
            Delete template
          </Button>
        )}
      </div>
    </div>
  );
}
