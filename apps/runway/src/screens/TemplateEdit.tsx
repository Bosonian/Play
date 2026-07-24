import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getISODay } from 'date-fns';
import { db } from '../db/db';
import type { StepTemplate, Template, TemplateSchedule } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { NumberField } from '../ui/NumberField';
import { TextField } from '../ui/TextField';
import { ScreenHeader } from '../ui/ScreenHeader';
import { RepeatEditor } from '../ui/RepeatEditor';
import { materializeScheduledDepartures, replaceUntouchedFutureAutoRows } from '../lib/materialize';
import { formatDateInput, formatTimeInput } from '../lib/format';
import { learnedEstimate, naturalActualsByStepName, stepNameLibrary } from '../lib/learning';
import type { LearnedEstimate } from '../lib/learning';
import { StepNameAutocomplete } from '../ui/StepNameAutocomplete';
import { logEvent } from '../lib/eventLog';

interface TemplateEditProps {
  id?: string;
  // "Make repeating" promotion path (field report #10 §3): set only by
  // Home's "Make repeating" action on a planned, template-less departure
  // card. Mutually exclusive with `id` in practice — Home never passes both
  // — but each is guarded independently below (`!id`) the same way
  // DepartureSetup guards its own `sourceTemplate` query against a
  // simultaneous `departureId`, rather than relying on caller discipline
  // alone.
  fromDepartureId?: string;
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
  arrivalWifiSsid: null,
};

const DEFAULT_REPEAT_TIME = '08:00';

export function TemplateEdit({ id, fromDepartureId, onNavigate }: TemplateEditProps) {
  // Loads once per `id`; existing is undefined while loading, null if the
  // id doesn't resolve to anything (shouldn't normally happen from Home's
  // own links, but guards against a stale reference).
  const existing = useLiveQuery(() => (id ? db.templates.get(id) : undefined), [id]);

  // "Make repeating" promotion path (§3): the departure this template is
  // being built FROM, when Home's "Make repeating" action opened this
  // screen. Guarded on `!id` for the same reason DepartureSetup guards its
  // `sourceTemplate` query — an edit-existing-template navigation should
  // never also carry a from-departure prefill.
  const sourceDeparture = useLiveQuery(
    () => (fromDepartureId && !id ? db.departures.get(fromDepartureId) : undefined),
    [fromDepartureId, id],
  );

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

  // Arrival-detection increment (0.23.0): the Wi-Fi network name this
  // template's arrival phase should watch for — see db/types.ts's
  // Template.arrivalWifiSsid doc comment. Kept as a plain string in form
  // state (blank means "not set") and only converted to the DB's `null`
  // shape on save, same pattern DepartureSetup already uses for numeric
  // fields that are optional in spirit but not in TypeScript's eyes.
  const [arrivalWifiSsid, setArrivalWifiSsid] = useState<string>(BLANK.arrivalWifiSsid ?? '');

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
      // undefined-as-null: a template saved before this field existed
      // carries no `arrivalWifiSsid` property at all, not a `null` one —
      // both collapse to the same blank form value.
      setArrivalWifiSsid(existing.arrivalWifiSsid ?? '');
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

  // "Make repeating" promotion path (§3): populate the whole form from the
  // source departure once it loads, mirroring DepartureSetup's own
  // populate-from-`sourceTemplate` effect — same "fresh ids, steps copied
  // not referenced" shape, just going the other direction (Departure ->
  // Template instead of Template -> Departure). Runs once, when
  // `sourceDeparture` changes identity, same "don't clobber typing"
  // reasoning as the `existing` effect above.
  useEffect(() => {
    if (sourceDeparture) {
      setName(sourceDeparture.name);
      setDestination(sourceDeparture.destination);
      setTravelMinutes(sourceDeparture.travelMinutes);
      setBufferMinutes(sourceDeparture.bufferMinutes);
      setSteps(
        sourceDeparture.steps.map((step) => ({
          id: crypto.randomUUID(),
          name: step.name,
          minutes: step.plannedMinutes,
          // Estimation-bias increment: a copy has the same provenance as
          // its source — see db/types.ts's StepTemplate.estimateSource
          // comment.
          estimateSource: step.estimateSource,
        })),
      );
      setArrivalSteps(
        (sourceDeparture.arrivalSteps ?? []).map((step) => ({
          id: crypto.randomUUID(),
          name: step.name,
          minutes: step.plannedMinutes,
          estimateSource: step.estimateSource,
        })),
      );
      setArrivalWifiSsid(sourceDeparture.arrivalWifiSsid ?? '');

      // Repeat pre-enabled, seeded from the departure's own appointment —
      // time as HH:mm, days as its single weekday. This is only a starting
      // point: the whole point of routing through TemplateEdit (rather than
      // silently attaching a schedule) is that Deepak can widen it to more
      // days, change the time, or leave Repeat off entirely before saving —
      // see handleSave's own comment on why the link happens either way.
      const appointment = new Date(sourceDeparture.appointmentAt);
      setRepeatEnabled(true);
      setRepeatTime(formatTimeInput(appointment));
      setRepeatDays([getISODay(appointment)]);
    }
  }, [sourceDeparture]);

  function toggleRepeatDay(iso: number) {
    setRepeatDays((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort()));
  }

  function addStep() {
    // Estimation-bias increment: a freshly added row's default 5 min is
    // Deepak's own baseline until an autocomplete pick or a hand-edit says
    // otherwise — see db/types.ts's StepTemplate.estimateSource comment.
    setSteps((prev) => [...prev, { id: crypto.randomUUID(), name: '', minutes: 5, estimateSource: 'manual' }]);
  }

  function removeStep(stepId: string) {
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
  }

  function updateStep(stepId: string, patch: Partial<StepTemplate>) {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
  }

  // Estimation-bias increment: any direct edit of a step's minutes is, by
  // definition, Deepak's own hand — flips provenance back to 'manual' even
  // if this step's minutes previously came from a learned prefill. Kept
  // separate from `updateStep` (also used for the autocomplete's name+
  // minutes patch, where 'learned' is the correct outcome) so the two call
  // sites can't be confused for each other.
  function updateStepMinutes(stepId: string, minutes: number) {
    updateStep(stepId, { minutes, estimateSource: 'manual' });
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
    setArrivalSteps((prev) => [...prev, { id: crypto.randomUUID(), name: '', minutes: 5, estimateSource: 'manual' }]);
  }

  function removeArrivalStep(stepId: string) {
    setArrivalSteps((prev) => prev.filter((s) => s.id !== stepId));
  }

  function updateArrivalStep(stepId: string, patch: Partial<StepTemplate>) {
    setArrivalSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
  }

  // Same "a hand-edit is always manual" reasoning as updateStepMinutes above.
  function updateArrivalStepMinutes(stepId: string, minutes: number) {
    updateArrivalStep(stepId, { minutes, estimateSource: 'manual' });
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
    // '' -> null, same tri-state rule as `schedule` above: a blank field
    // means "not configured", never an empty-string SSID.
    const trimmedArrivalWifiSsid = arrivalWifiSsid.trim();
    const arrivalWifiSsidToSave = trimmedArrivalWifiSsid === '' ? null : trimmedArrivalWifiSsid;

    // "Make repeating" promotion (§3): the template write and the source
    // departure's link both happen in ONE Dexie transaction — if either
    // failed partway, the alternative (a new template with no departure
    // pointing at it, or a departure linked to a template that was never
    // actually saved) is a worse, harder-to-notice inconsistency than the
    // whole save just not happening. `replaceUntouchedFutureAutoRows`/
    // `materializeScheduledDepartures` stay OUTSIDE this transaction,
    // deliberately — they're the sweep/re-plan step that reads what this
    // transaction just committed, not part of the atomic write itself, same
    // separation TopicEdit's own save uses for the analogous case.
    await db.transaction('rw', db.templates, db.departures, async () => {
      if (id && existing) {
        await db.templates.update(id, {
          name: name.trim(),
          destination: destination.trim(),
          travelMinutes,
          bufferMinutes,
          steps,
          arrivalSteps,
          arrivalWifiSsid: arrivalWifiSsidToSave,
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
          arrivalWifiSsid: arrivalWifiSsidToSave,
          createdAt: now,
          updatedAt: now,
          schedule,
          autoLearn,
        });
      }

      // `sourceDeparture` is only ever set on the create path (`!id`
      // guards the query above) — link it to the template just created,
      // regardless of whether Repeat ended up enabled or not. Per the
      // spec: a template is a useful thing to have either way, and the
      // link is harmless when there's no schedule for the materializer to
      // read — the source departure simply never gains an auto-created
      // sibling. `scheduledForDate` = the departure's own appointment
      // date is what makes materialize.ts's dedup key
      // (templateId + scheduledForDate) already cover this exact
      // occurrence, so the materialize call below can never double-book
      // it — same reasoning as DepartureSetup's own save-with-repeat path
      // (§2).
      if (sourceDeparture) {
        await db.departures.update(sourceDeparture.id, {
          templateId,
          scheduledForDate: formatDateInput(new Date(sourceDeparture.appointmentAt)),
        });
      }
    });

    // Sweep only on an edit of an ALREADY-EXISTING template — whether the
    // schedule changed, was newly turned on, or just got turned off, an
    // edit needs the already-planned future week cleared of rows that no
    // longer reflect it (re-materializing afterwards, which recreates
    // whatever's still missing for the horizon, only makes sense when a
    // schedule remains — toggling off means the sweep IS the whole story,
    // per the spec's "toggling off: same delete sweep, no re-materialize").
    //
    // Deliberately skipped on CREATE (`id` undefined) — field report #10
    // §3: a brand-new template has no already-materialized future rows to
    // sweep in the ordinary case (nothing else could reference a templateId
    // that didn't exist a moment ago), and on the "Make repeating" path
    // specifically, running this sweep here WOULD find a match — the
    // source departure just linked inside the transaction above, which now
    // satisfies every one of the sweep's own criteria (planned,
    // scheduledForDate set, untouched, still in the future). Sweeping it
    // would delete the very departure this whole save exists to preserve,
    // undoing the link for no reason, right before materialize recreates an
    // equivalent-but-different row in its place. "Link, then materialize"
    // (the promotion spec's own ordering) only means what it says if this
    // step is skipped for that path.
    if (id && existing) {
      await replaceUntouchedFutureAutoRows(templateId);
    }
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
      //
      // Field report #12: this sweep is also what lets Deepak clean up a
      // twin template minted by the since-fixed DepartureSetup bug — delete
      // the duplicate, its future rows (and their alarms, via
      // cancelDepartureAlarms inside the sweep) vanish with it, which is
      // what makes the twin's occurrence deletable again.
      const removedCount = await replaceUntouchedFutureAutoRows(id);
      await db.templates.delete(id);
      void logEvent('departure', `Template deleted: ${name}, ${removedCount} upcoming departures removed.`);
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

      <RepeatEditor
        enabled={repeatEnabled}
        onEnabledChange={setRepeatEnabled}
        time={repeatTime}
        onTimeChange={setRepeatTime}
        days={repeatDays}
        onToggleDay={toggleRepeatDay}
        valid={repeatValid}
      />

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
                        ...(entry.learnedMinutes !== null
                          ? { minutes: entry.learnedMinutes, estimateSource: 'learned' }
                          : {}),
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
                      updateStepMinutes(step.id, Number.isNaN(parsed) ? 0 : parsed);
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
                        ...(entry.learnedMinutes !== null
                          ? { minutes: entry.learnedMinutes, estimateSource: 'learned' }
                          : {}),
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
                      updateArrivalStepMinutes(step.id, Number.isNaN(parsed) ? 0 : parsed);
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

        {/* Arrival-detection increment (0.23.0): only offered once there's
            an arrival phase to detect the start of — a departure with no
            arrival steps never shows the journey-phase checklist this field
            would auto-advance (Runway.tsx), so showing it unconditionally
            would be an option with nothing to act on. */}
        {arrivalSteps.length > 0 && (
          <TextField
            label="Arrival Wi-Fi network"
            value={arrivalWifiSsid}
            onChange={(e) => setArrivalWifiSsid(e.target.value)}
            hint="Exact network name (SSID). When the phone joins it with Runway open, arrival is recorded automatically."
            placeholder="e.g. Klinikum-Guest"
          />
        )}
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
