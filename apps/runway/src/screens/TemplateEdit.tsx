import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { StepTemplate, Template, TemplateSchedule } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { NumberField } from '../ui/NumberField';
import { TextField } from '../ui/TextField';
import { ScreenHeader } from '../ui/ScreenHeader';
import { materializeScheduledDepartures, replaceUntouchedFutureAutoRows } from '../lib/materialize';
import { learnedEstimate, naturalActualsByStepName, stepNameLibrary } from '../lib/learning';
import type { LearnedEstimate } from '../lib/learning';
import { StepNameAutocomplete } from '../ui/StepNameAutocomplete';

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
  autoLearn: false,
  arrivalSteps: [],
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

  // Arrival-steps increment (ward-station insight): a second, optional set
  // of steps that live AFTER travel and BEFORE the true appointment target
  // — see db/types.ts's Template.arrivalSteps doc comment. Same shape as
  // `steps` above (own state, own add/remove/update/move helpers below),
  // deliberately kept as a SEPARATE array rather than one combined list
  // with a "kind" flag — the two sections are edited, copied to a
  // Departure, and read by the projection math as genuinely distinct
  // phases (RUNWAY_PLAN.md's prep/travel/arrival split), so keeping them
  // as separate arrays all the way down avoids a "which kind is this row"
  // check creeping into every place that touches steps.
  const [arrivalSteps, setArrivalSteps] = useState<StepTemplate[]>(BLANK.arrivalSteps);

  // Recurring-departures increment. `repeatDays` holds ISO weekday numbers
  // (1 Monday .. 7 Sunday); kept as three separate pieces of local state
  // rather than one TemplateSchedule-shaped object so the day-chip toggle
  // and time input can update independently, same pattern the rest of this
  // form already uses for every other field.
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatTime, setRepeatTime] = useState(DEFAULT_REPEAT_TIME);
  const [repeatDays, setRepeatDays] = useState<number[]>([]);

  // Learning increment: opt-in automation, off by default for both a
  // brand-new template and any row saved before this field existed
  // (BLANK.autoLearn === false covers the create path; the populate effect
  // below covers the edit path with the same undefined-as-null treatment
  // every other late-added Template field gets).
  const [autoLearn, setAutoLearn] = useState(BLANK.autoLearn);

  // All history + every template's steps, for the step-name autocomplete
  // (learning increment §5) and this template's own "learned · N runs"
  // provenance labels below. Loaded once, unfiltered - stepNameLibrary and
  // naturalActualsByStepName do their own filtering in JS, same "load
  // small tables whole" pattern the rest of this app already uses (see
  // materialize.ts's own comment on why templateId isn't worth indexing).
  const allDepartures = useLiveQuery(() => db.departures.toArray(), []);
  const allTemplates = useLiveQuery(() => db.templates.toArray(), []);

  const library = useMemo(
    () => stepNameLibrary(allDepartures ?? [], allTemplates ?? []),
    [allDepartures, allTemplates],
  );

  // This template's own learned-per-step-name estimates, for the "learned ·
  // N runs" label next to a step whose minutes already equal it. Scoped to
  // `id` (not every departure) because provenance is about THIS template's
  // own history, unlike `library` above, which is deliberately global.
  const learnedByStepName = useMemo(() => {
    const map = new Map<string, LearnedEstimate>();
    if (!id || !allDepartures) return map;
    const templateRuns = allDepartures.filter((d) => d.templateId === id);
    for (const [name, actuals] of naturalActualsByStepName(templateRuns)) {
      const learned = learnedEstimate(actuals);
      if (learned) map.set(name, learned);
    }
    return map;
  }, [id, allDepartures]);

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
      // undefined-as-null: a template saved before arrival steps existed
      // carries no `arrivalSteps` property at all, not an `[]` one — same
      // rule as `autoLearn`/`schedule` just below.
      setArrivalSteps(existing.arrivalSteps ?? []);
      // undefined-as-null: a row saved before this field existed carries no
      // `autoLearn` property at all, not a `false` one — `=== true` (not a
      // truthy check) is what makes that read correctly regardless.
      setAutoLearn(existing.autoLearn === true);
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

  // Arrival-steps increment: same four operations as the prep-steps quartet
  // above, mechanically identical, just pointed at `arrivalSteps` — kept as
  // separate functions rather than a shared "which array" parameter because
  // that parameterization would only save a few lines here at the cost of
  // every call site needing to say which list it means anyway.
  function addArrivalStep() {
    setArrivalSteps((prev) => [...prev, { id: crypto.randomUUID(), name: '', minutes: 5 }]);
  }

  function removeArrivalStep(stepId: string) {
    setArrivalSteps((prev) => prev.filter((s) => s.id !== stepId));
  }

  function updateArrivalStep(stepId: string, patch: Partial<StepTemplate>) {
    setArrivalSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
  }

  function moveArrivalStep(stepId: string, direction: -1 | 1) {
    setArrivalSteps((prev) => {
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
        arrivalSteps,
        updatedAt: now,
        schedule,
        autoLearn,
      });
    } else {
      await db.templates.add({
        id: templateId,
        name: name.trim(),
        destination: destination.trim(),
        travelMinutes,
        bufferMinutes,
        steps,
        arrivalSteps,
        createdAt: now,
        updatedAt: now,
        schedule,
        autoLearn,
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

      <section className="flex flex-col gap-3 rounded-xl border border-slate-800/60 bg-surface p-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={repeatEnabled}
            onChange={(e) => setRepeatEnabled(e.target.checked)}
            className="size-6 shrink-0 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          />
          <span className="flex-1 text-slate-100">Repeat this departure</span>
        </label>

        {repeatEnabled && (
          <div className="flex flex-col gap-3 motion-safe:animate-fade-in">
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
                    className={`flex min-h-12 min-w-12 flex-1 items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
                      selected
                        ? 'border-sky-500 bg-sky-500/20 text-sky-300'
                        : 'border-slate-700 bg-raised text-slate-400 hover:text-slate-200'
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

      <section className="flex flex-col gap-3 rounded-xl border border-slate-800/60 bg-surface p-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={autoLearn}
            onChange={(e) => setAutoLearn(e.target.checked)}
            className="size-6 shrink-0 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          />
          <span className="flex-1 text-slate-100">Learn step times automatically</span>
        </label>
        <p className="text-sm text-slate-500">
          After each completed departure, step estimates update to the time that covers three of
          four of your recent runs. Learned values are labeled; your own edits always win and
          become the new baseline.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Steps</h2>

        <div className="flex flex-col gap-2">
          {steps.map((step, index) => {
            const learned = learnedByStepName.get(step.name);
            const showsLearnedLabel = learned !== undefined && learned.minutes === step.minutes;
            return (
              <div key={step.id} className="flex flex-col gap-1 rounded-lg border border-slate-800/60 bg-surface p-2">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button
                      onClick={() => moveStep(step.id, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${step.name || 'step'} up`}
                      className="flex h-5 w-8 items-center justify-center text-slate-500 transition-colors hover:text-slate-200 disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveStep(step.id, 1)}
                      disabled={index === steps.length - 1}
                      aria-label={`Move ${step.name || 'step'} down`}
                      className="flex h-5 w-8 items-center justify-center text-slate-500 transition-colors hover:text-slate-200 disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>

                  <StepNameAutocomplete
                    value={step.name}
                    library={library}
                    onNameChange={(name) => updateStep(step.id, { name })}
                    onSelect={(entry) =>
                      updateStep(step.id, {
                        name: entry.name,
                        ...(entry.learnedMinutes !== null ? { minutes: entry.learnedMinutes } : {}),
                      })
                    }
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
                    className="min-h-12 w-16 rounded-lg border border-slate-700 bg-raised px-2 py-2 text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
                  />

                  <button
                    onClick={() => removeStep(step.id)}
                    aria-label={`Remove ${step.name || 'step'}`}
                    className="flex min-h-12 min-w-12 items-center justify-center text-slate-500 transition-colors hover:text-red-400"
                  >
                    &times;
                  </button>
                </div>
                {/* Provenance (learning increment §3): only shown once this
                    step's minutes genuinely equal the learned estimate — an
                    edit that moves it away from that value (his edit always
                    wins, per the toggle's own caption above) makes the label
                    disappear rather than keep claiming a provenance that's
                    no longer true. */}
                {showsLearnedLabel && (
                  <p className="pl-10 text-xs text-slate-600">learned · {learned.runCount} runs</p>
                )}
              </div>
            );
          })}
        </div>

        <Button variant="secondary" onClick={addStep}>
          Add step
        </Button>
      </section>

      {/* Arrival-steps increment: same row UI as Steps above (reorder,
          autocomplete, learned-label provenance), a second independent
          array. Optional and empty by default — most departures never
          touch this section, and the copy below says exactly what it's
          for so it never reads as "another Steps section, why two". */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Arrival steps</h2>
        <p className="text-sm text-slate-500">
          After the drive, before the real target — changing, lifts, corridors. The appointment
          time is when the last of these is done.
        </p>

        <div className="flex flex-col gap-2">
          {arrivalSteps.map((step, index) => {
            const learned = learnedByStepName.get(step.name);
            const showsLearnedLabel = learned !== undefined && learned.minutes === step.minutes;
            return (
              <div key={step.id} className="flex flex-col gap-1 rounded-lg border border-slate-800/60 bg-surface p-2">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button
                      onClick={() => moveArrivalStep(step.id, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${step.name || 'step'} up`}
                      className="flex h-5 w-8 items-center justify-center text-slate-500 transition-colors hover:text-slate-200 disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveArrivalStep(step.id, 1)}
                      disabled={index === arrivalSteps.length - 1}
                      aria-label={`Move ${step.name || 'step'} down`}
                      className="flex h-5 w-8 items-center justify-center text-slate-500 transition-colors hover:text-slate-200 disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>

                  <StepNameAutocomplete
                    value={step.name}
                    library={library}
                    onNameChange={(name) => updateArrivalStep(step.id, { name })}
                    onSelect={(entry) =>
                      updateArrivalStep(step.id, {
                        name: entry.name,
                        ...(entry.learnedMinutes !== null ? { minutes: entry.learnedMinutes } : {}),
                      })
                    }
                  />

                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={step.minutes}
                    aria-label={`${step.name || 'Step'} minutes`}
                    onChange={(e) => {
                      const parsed = Number.parseInt(e.target.value, 10);
                      updateArrivalStep(step.id, { minutes: Number.isNaN(parsed) ? 0 : parsed });
                    }}
                    className="min-h-12 w-16 rounded-lg border border-slate-700 bg-raised px-2 py-2 text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
                  />

                  <button
                    onClick={() => removeArrivalStep(step.id)}
                    aria-label={`Remove ${step.name || 'step'}`}
                    className="flex min-h-12 min-w-12 items-center justify-center text-slate-500 transition-colors hover:text-red-400"
                  >
                    &times;
                  </button>
                </div>
                {showsLearnedLabel && (
                  <p className="pl-10 text-xs text-slate-600">learned · {learned.runCount} runs</p>
                )}
              </div>
            );
          })}
        </div>

        <Button variant="secondary" onClick={addArrivalStep}>
          Add arrival step
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
