import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Departure, DepartureStep } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { NumberField } from '../ui/NumberField';
import { TextField } from '../ui/TextField';
import { ScreenHeader } from '../ui/ScreenHeader';
import { computeProjection, computeStartBy } from '../lib/projection';
import { formatDateInput, formatTime, formatTimeInput } from '../lib/format';
import { ensurePermissions, scheduleDepartureAlarms } from '../native/notifications';
import { readLiveTravelConfig } from '../lib/liveTravelSettings';
import { fetchDriveMinutes } from '../lib/routesApi';
import { getCurrentPosition } from '../native/geolocation';
import { refreshWidgets } from '../native/widgets';
import { stepNameLibrary } from '../lib/learning';
import { StepNameAutocomplete } from '../ui/StepNameAutocomplete';

interface DepartureSetupProps {
  templateId?: string;
  departureId?: string;
  // Calendar/share-target increment (E1) — see App.tsx's Screen union doc
  // comment on the departureSetup case for who passes these and why.
  prefillName?: string;
  prefillDestination?: string;
  prefillAppointmentIso?: string;
  // Quick-capture increment (E2) — see App.tsx's Screen union doc comment
  // on why this is a separate date-only prefill rather than folding into
  // prefillAppointmentIso with a fabricated time.
  prefillDate?: string;
  prefillTimeMissing?: boolean;
  onNavigate: (screen: Screen) => void;
}

export function DepartureSetup({
  templateId,
  departureId,
  prefillName,
  prefillDestination,
  prefillAppointmentIso,
  prefillDate,
  prefillTimeMissing,
  onNavigate,
}: DepartureSetupProps) {
  const existingDeparture = useLiveQuery(
    () => (departureId ? db.departures.get(departureId) : undefined),
    [departureId],
  );

  // F3: whether this form is editing a departure whose run is already under
  // way. A 'planned' departure can never carry a checked step (toggleStep in
  // Runway.tsx flips status to 'running' in the same transaction as the
  // first check-off), so the locked-step rendering below only ever actually
  // triggers when this is true — but it's kept as an explicit derived flag,
  // not inferred implicitly from "does any step happen to be checked",
  // because the point being made in the UI (and in the doc comment on
  // handleSave's alarm-reschedule gate below) is about the departure's
  // status, not a coincidental property of its steps.
  const isEditingRunning = existingDeparture?.status === 'running';
  const sourceTemplate = useLiveQuery(
    () => (templateId && !departureId ? db.templates.get(templateId) : undefined),
    [templateId, departureId],
  );

  const now = new Date();
  // Calendar/share-target increment (E1): prefill props apply ONCE, as the
  // initial value of each field's own useState — not via a useEffect the
  // way sourceTemplate below does, because these arrive synchronously as
  // plain props (no Dexie read to wait on), unlike a template which has to
  // resolve from a live query first. A lazy initializer (the `() => ...`
  // form) only ever runs on this component's first render, which is
  // exactly "applied once"; gating on `!departureId` is what keeps this
  // CREATE-only — App.tsx's two prefill callers (Home's "Plan departure"
  // action, the share-target deep link) never pass a departureId alongside
  // a prefill anyway, but the guard makes that invariant true by
  // construction rather than by caller discipline alone.
  const [name, setName] = useState(() => (departureId ? '' : (prefillName ?? '')));
  const [destination, setDestination] = useState(() => (departureId ? '' : (prefillDestination ?? '')));
  // Default date is today (CLAUDE.md: don't make the user re-pick what's
  // already obvious). Time is left blank — defaulting it to "now" would
  // silently fail the future-appointment validation for most real setups,
  // so it's more honest to make the user choose. A prefillAppointmentIso
  // (calendar "Plan departure") overrides both defaults at once, since a
  // calendar event's begin time is already both a real date and a real
  // time — there's nothing left for the user to "more honestly" choose
  // there the way there is for a from-scratch departure.
  const [appointmentDate, setAppointmentDate] = useState(() => {
    if (departureId) return formatDateInput(now);
    if (prefillAppointmentIso) return formatDateInput(new Date(prefillAppointmentIso));
    // Quick-capture's "date heard, time not heard" case (E2) — a bare
    // YYYY-MM-DD from Gemini's draft, already in the right shape for this
    // input's value binding, no Date round-trip needed.
    if (prefillDate) return prefillDate;
    return formatDateInput(now);
  });
  const [appointmentTime, setAppointmentTime] = useState(() =>
    !departureId && prefillAppointmentIso ? formatTimeInput(new Date(prefillAppointmentIso)) : '',
  );
  const [travelMinutes, setTravelMinutes] = useState(20);
  const [bufferMinutes, setBufferMinutes] = useState(10);
  const [steps, setSteps] = useState<DepartureStep[]>([]);
  // Arrival-steps increment: same shape as `steps` above, own state — see
  // db/types.ts's Departure.arrivalSteps doc comment. Optional, empty by
  // default; only ever populated by hand, from an existing departure being
  // edited, or copied from a template, exactly like `steps`.
  const [arrivalSteps, setArrivalSteps] = useState<DepartureStep[]>([]);
  const [touched, setTouched] = useState(false);

  // Task-memory autocomplete (learning increment §5) — every step name
  // that's ever appeared, across all history and all templates, not just
  // whatever template (if any) this departure started from. Loaded once,
  // unfiltered; stepNameLibrary does its own name-collection and learned-
  // estimate lookup.
  const allDepartures = useLiveQuery(() => db.departures.toArray(), []);
  const allTemplates = useLiveQuery(() => db.templates.toArray(), []);
  const stepLibrary = useMemo(
    () => stepNameLibrary(allDepartures ?? [], allTemplates ?? []),
    [allDepartures, allTemplates],
  );

  // Live-travel increment (RUNWAY_PLAN.md §5.1+§5.6). `undefined` while the
  // settings read is still in flight is treated the same as "disabled" —
  // the fetch button simply doesn't render for that one tick, rather than
  // flashing in once the query resolves.
  const liveTravelConfig = useLiveQuery(() => readLiveTravelConfig(), []);
  const [fetchingLiveTravel, setFetchingLiveTravel] = useState(false);
  const [liveTravelFetchedJustNow, setLiveTravelFetchedJustNow] = useState(false);
  const [liveTravelError, setLiveTravelError] = useState(false);

  // Populate from whichever source resolved — an existing departure (edit
  // path) takes priority over a template (fresh-departure-from-template
  // path); if neither id was passed, the form just keeps its blank
  // defaults ("from scratch").
  useEffect(() => {
    if (existingDeparture) {
      const appointment = new Date(existingDeparture.appointmentAt);
      setName(existingDeparture.name);
      setDestination(existingDeparture.destination);
      setAppointmentDate(formatDateInput(appointment));
      setAppointmentTime(formatTimeInput(appointment));
      setTravelMinutes(existingDeparture.travelMinutes);
      setBufferMinutes(existingDeparture.bufferMinutes);
      setSteps(existingDeparture.steps);
      // undefined-as-null: a departure saved before arrival steps existed
      // carries no `arrivalSteps` property at all, not an `[]` one.
      setArrivalSteps(existingDeparture.arrivalSteps ?? []);
    }
  }, [existingDeparture]);

  useEffect(() => {
    if (sourceTemplate) {
      setName(sourceTemplate.name);
      setDestination(sourceTemplate.destination);
      setTravelMinutes(sourceTemplate.travelMinutes);
      setBufferMinutes(sourceTemplate.bufferMinutes);
      setSteps(
        sourceTemplate.steps.map((step) => ({
          id: crypto.randomUUID(),
          name: step.name,
          plannedMinutes: step.minutes,
          checkedAt: null,
        })),
      );
      // Same fresh-ids-copied-from-template shape as `steps` above.
      setArrivalSteps(
        (sourceTemplate.arrivalSteps ?? []).map((step) => ({
          id: crypto.randomUUID(),
          name: step.name,
          plannedMinutes: step.minutes,
          checkedAt: null,
        })),
      );
    }
  }, [sourceTemplate]);

  function addStep() {
    setSteps((prev) => [...prev, { id: crypto.randomUUID(), name: '', plannedMinutes: 5, checkedAt: null }]);
  }

  function removeStep(stepId: string) {
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
  }

  function updateStep(stepId: string, patch: Partial<DepartureStep>) {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
  }

  // Arrival-steps increment: same three operations as the prep-steps trio
  // above (DepartureSetup, unlike TemplateEdit, never offered reordering
  // for `steps` either — arrival steps stay consistent with that, no
  // move function here).
  function addArrivalStep() {
    setArrivalSteps((prev) => [...prev, { id: crypto.randomUUID(), name: '', plannedMinutes: 5, checkedAt: null }]);
  }

  function removeArrivalStep(stepId: string) {
    setArrivalSteps((prev) => prev.filter((s) => s.id !== stepId));
  }

  function updateArrivalStep(stepId: string, patch: Partial<DepartureStep>) {
    setArrivalSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
  }

  // Explicit tap only — never automatic. An API call and a location prompt
  // are real side effects (a network request, possibly a first-ever
  // permission dialog), and neither should ever fire just because someone
  // typed a destination or opened this screen; the button is the only
  // trigger.
  async function handleFetchLiveTravel() {
    if (!liveTravelConfig?.enabled || destination.trim() === '') return;
    setFetchingLiveTravel(true);
    setLiveTravelError(false);
    setLiveTravelFetchedJustNow(false);
    try {
      const origin = await getCurrentPosition();
      if (origin === null) {
        setLiveTravelError(true);
        return;
      }
      const result = await fetchDriveMinutes({
        origin,
        destinationAddress: destination.trim(),
        apiKey: liveTravelConfig.apiKey,
      });
      if (!result.ok) {
        setLiveTravelError(true);
        return;
      }
      setTravelMinutes(result.minutes);
      setLiveTravelFetchedJustNow(true);
    } finally {
      setFetchingLiveTravel(false);
    }
  }

  const appointmentAtDate =
    appointmentDate && appointmentTime ? new Date(`${appointmentDate}T${appointmentTime}:00`) : null;
  const appointmentIsValid = appointmentAtDate !== null && !Number.isNaN(appointmentAtDate.getTime());
  const appointmentInFuture = appointmentIsValid && appointmentAtDate!.getTime() > Date.now();

  const errors: string[] = [];
  if (touched) {
    if (!appointmentIsValid) errors.push('Set an appointment date and time.');
    else if (!appointmentInFuture) errors.push('Appointment must be in the future.');
    if (travelMinutes < 0) errors.push('Travel minutes cannot be negative.');
    if (bufferMinutes < 0) errors.push('Buffer minutes cannot be negative.');
    if (steps.some((step) => step.plannedMinutes < 0)) errors.push('Step minutes cannot be negative.');
    if (steps.length === 0) errors.push('Add at least one step.');
    // Arrival steps are optional (no minimum-count requirement, unlike prep
    // steps above) but any that do exist still need a sane, non-negative
    // duration — same guard, same copy, just scoped to the other list.
    if (arrivalSteps.some((step) => step.plannedMinutes < 0)) errors.push('Step minutes cannot be negative.');
  }
  const canSave =
    appointmentInFuture &&
    travelMinutes >= 0 &&
    bufferMinutes >= 0 &&
    steps.every((step) => step.plannedMinutes >= 0) &&
    steps.length > 0 &&
    arrivalSteps.every((step) => step.plannedMinutes >= 0);

  // Live preview — same equation as the Runway screen, evaluated with
  // every step unchecked (nothing has started yet). computeStartBy answers
  // "when do I need to start prep"; computeProjection's leaveBy answers
  // "when do I need to be out the door", independent of prep — both now
  // also account for arrival steps (projection.ts), so a departure with
  // any shows an earlier startBy/leaveBy here exactly as it will on the
  // live Runway screen.
  const preview =
    appointmentIsValid && steps.length > 0
      ? {
          startBy: computeStartBy({
            appointmentAt: appointmentAtDate!.toISOString(),
            travelMinutes,
            bufferMinutes,
            steps,
            arrivalSteps,
          }),
          leaveBy: computeProjection(now, {
            appointmentAt: appointmentAtDate!.toISOString(),
            travelMinutes,
            bufferMinutes,
            steps,
            arrivalSteps,
          }).leaveBy,
        }
      : null;

  async function handleSave() {
    setTouched(true);
    if (!canSave || !appointmentAtDate) return;

    const nowIso = new Date().toISOString();
    const appointmentIso = appointmentAtDate.toISOString();
    const sharedFields = {
      name: name.trim() || destination.trim() || 'Departure',
      destination: destination.trim(),
      appointmentAt: appointmentIso,
      // originalAppointmentAt tracks appointmentAt on EVERY save here, both
      // create and edit — see db/types.ts's own comment on the field. For a
      // brand-new departure the two start identical (there's nothing to
      // diverge from yet). For an edit, this IS the "reality moved" writer
      // the field's semantics rule describes: a deliberate edit updates the
      // record's original commitment along with the appointment itself,
      // unlike Runway.tsx's re-anchor action, which deliberately leaves
      // this field alone.
      originalAppointmentAt: appointmentIso,
      travelMinutes,
      bufferMinutes,
      steps,
      arrivalSteps,
    };

    let savedDeparture: Departure;
    if (departureId && existingDeparture) {
      await db.departures.update(departureId, sharedFields);
      savedDeparture = { ...existingDeparture, ...sharedFields };
    } else {
      savedDeparture = {
        id: crypto.randomUUID(),
        templateId: templateId ?? null,
        ...sharedFields,
        status: 'planned',
        startedAt: null,
        leftAt: null,
        arrivalResult: null,
        arrivalLateMinutes: null,
        createdAt: nowIso,
        // A departure created here was typed in by hand (even if it started
        // from a template) — only the materializer (src/lib/materialize.ts)
        // stamps a non-null scheduledForDate, so its "never re-create an
        // abandoned occurrence" dedup check never mistakes a manually-made
        // departure for one it already materialized.
        scheduledForDate: null,
        // A brand-new departure has never been through compressPlan - see
        // db/types.ts's own comment on wasReplanned.
        wasReplanned: false,
        // Arrival-steps increment: the arrival phase hasn't begun for a
        // departure that doesn't even exist yet — see db/types.ts's
        // Departure.arrivedAt doc comment on why this is an explicit tap,
        // not an inferred timestamp.
        arrivedAt: null,
      };
      await db.departures.add(savedDeparture);
    }

    // Widgets increment: name/appointment/steps/travel — everything the
    // departure widget's three lines read — may have just changed, or a
    // brand-new departure may now be the soonest planned one.
    void refreshWidgets();

    // Alarms only make sense for a departure that's still ahead of you — a
    // terminal departure ('left'/'done'/'abandoned') has nothing left to
    // alert about, so the status check matters here even though Home's Edit
    // action already only offers editing while 'planned' or 'running' (belt
    // and suspenders: this function has no way to know *why* it was
    // called). Both 'planned' and 'running' reschedule identically —
    // scheduleDepartureAlarms cancels whatever was scheduled from the
    // previous save before scheduling the new times (src/native/
    // notifications.ts) — including F3's own case, editing a departure
    // already under way: wrapUp/startBy shift with a changed step or
    // buffer, and computeAlarmTimes itself filters out anything already in
    // the past (e.g. slot 0's "Start getting ready.", if that stage already
    // fired), so there's nothing extra to reimplement for the running case.
    //
    // F3's asymmetry, worth stating plainly: editing a running departure is
    // for when REALITY moved — the Termin got pushed back, a step is taking
    // longer than planned — not a soft-delete or a way to quietly reset a
    // run that's going badly. Abandon (Runway.tsx) stays the only exit from
    // a departure that's actually being given up on; this form only ever
    // reschedules the SAME run, it never starts a new one or clears
    // startedAt/checked-step history (DepartureSetup's step-list rendering
    // below locks already-checked steps out of editing entirely, and
    // `sharedFields` above never touches `status`/`startedAt`, so neither
    // can drift here even by omission).
    //
    // Permission is requested here, lazily, on first save — never at app
    // launch (CLAUDE.md: no permission ambush). The plugin's schedule()
    // REJECTS outright when permission is denied, so this never lets that
    // throw block the save that already landed in Dexie above: `granted`
    // gates whether we even attempt to schedule, and the try/catch is a
    // second backstop for anything else the native call could throw. A
    // 'denied' or failed result still leaves the departure saved and
    // navigation still happens — Home's notification-permission banner
    // (B1) is the non-blocking surface for "alerts won't fire", not this
    // form.
    if (savedDeparture.status === 'planned' || savedDeparture.status === 'running') {
      try {
        const granted = await ensurePermissions();
        if (granted) {
          await scheduleDepartureAlarms(savedDeparture);
        }
      } catch (err) {
        console.warn('Runway: failed to schedule departure alarms', err);
      }
    }

    onNavigate({ name: 'home' });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader
          title={departureId ? 'Edit departure' : 'New departure'}
          onBack={() => onNavigate({ name: 'home' })}
        />
      </div>

      {/* F3: only shown while editing a running departure - explains why
          some step rows below are locked, rather than leaving that as an
          unexplained inconsistency in an otherwise fully-editable form. */}
      {isEditingRunning && (
        <p className="rounded-xl border border-slate-800/60 bg-surface p-4 text-sm text-slate-400">
          This departure is already running. Steps already checked off are locked; everything else can still change.
        </p>
      )}

      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Klinik appointment"
        enterKeyHint="next"
      />

      <TextField
        label="Destination"
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
        placeholder="e.g. Klinikum Stuttgart"
        enterKeyHint="next"
      />

      {/* Quick-capture increment (E2): shown only when Gemini's draft
          named a date but heard no time — the note explains why the Time
          field below is empty instead of leaving that unexplained the way
          a silently-blank field would. */}
      {prefillTimeMissing && (
        <p className="text-sm text-amber-400">No time was heard — check it.</p>
      )}

      <div className="flex gap-3">
        <TextField
          label="Date"
          type="date"
          value={appointmentDate}
          onChange={(e) => setAppointmentDate(e.target.value)}
          containerClassName="flex-1"
        />
        <TextField
          label="Time"
          type="time"
          value={appointmentTime}
          onChange={(e) => setAppointmentTime(e.target.value)}
          enterKeyHint="done"
          containerClassName="flex-1"
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <NumberField
          label="Travel minutes"
          hint="From a quick look at Maps. This won't auto-update with live traffic."
          value={travelMinutes}
          onChange={(value) => {
            setTravelMinutes(value);
            // A manual edit after a live fetch means the "live · just now"
            // tag no longer describes what's in the field — clear it rather
            // than leave a stale claim next to a hand-typed number.
            setLiveTravelFetchedJustNow(false);
          }}
        />
        {/* Only offered once there's a destination to route to — an empty
            Maps search is worse than no link at all. RUNWAY_PLAN.md §5.1
            committed to this "one tap to glance" deep link for v1. */}
        {destination.trim() !== '' && (
          <button
            type="button"
            onClick={() =>
              window.open(
                `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`,
                '_blank',
              )
            }
            className="min-h-12 rounded-lg px-2 text-sm font-medium text-sky-400 transition-colors hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            Check route in Maps
          </button>
        )}
        {/* Live-travel increment: only offered when the feature is on
            (Settings) and there's a destination to fetch a route to — same
            gating the Maps link above uses, plus the settings check. Both
            this and "Check route in Maps" above keep the sky accent rather
            than the plain TextAction slate — CLAUDE.md/design-system split:
            sky is reserved for actions with a real external effect (open
            Maps, hit a network API), TextAction slate is for quiet in-app
            navigation and housekeeping. */}
        {liveTravelConfig?.enabled && destination.trim() !== '' && (
          <button
            type="button"
            onClick={() => void handleFetchLiveTravel()}
            disabled={fetchingLiveTravel}
            className="min-h-12 rounded-lg px-2 text-sm font-medium text-sky-400 transition-colors hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:opacity-40"
          >
            {fetchingLiveTravel ? 'Fetching…' : 'Fetch live travel time'}
          </button>
        )}
      </div>

      {liveTravelFetchedJustNow && <p className="text-sm text-sky-400">live · just now</p>}
      {liveTravelError && (
        <p className="text-sm text-amber-400">Live travel time unavailable — using your estimate.</p>
      )}

      <NumberField
        label="Friction buffer"
        hint="Keys, toilet, one more thing."
        value={bufferMinutes}
        onChange={setBufferMinutes}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
          Steps for this run
        </h2>

        <div className="flex flex-col gap-2">
          {steps.map((step) => {
            // F3: a checked step is history, not a draft - toggleStep
            // (Runway.tsx) stamped `checkedAt` for a reason, and this form
            // must not be a back door to un-stamp it, rename it, or resize
            // it after the fact. Locked rows render dimmed with a plain
            // "done" label instead of inputs; the step simply never appears
            // in an onChange/onClick handler, which is what actually keeps
            // its `checkedAt`/`name`/`plannedMinutes` untouched all the way
            // through to the save in handleSave above (this component never
            // clears or rewrites those fields for a step it never edited).
            const locked = step.checkedAt !== null;
            if (locked) {
              return (
                <div
                  key={step.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-800/60 bg-surface p-2 opacity-60"
                >
                  <span className="min-h-12 flex flex-1 items-center px-3 text-slate-400 line-through">
                    {step.name || 'Step'}
                  </span>
                  <span className="min-h-12 flex w-16 items-center justify-end px-2 text-sm tabular-nums text-slate-500">
                    {step.plannedMinutes} min
                  </span>
                  <span className="flex min-h-12 min-w-12 items-center justify-center text-xs font-medium uppercase tracking-wide text-slate-600">
                    done
                  </span>
                </div>
              );
            }
            return (
              <div key={step.id} className="flex items-center gap-2 rounded-lg border border-slate-800/60 bg-surface p-2">
                <StepNameAutocomplete
                  value={step.name}
                  library={stepLibrary}
                  onNameChange={(name) => updateStep(step.id, { name })}
                  onSelect={(entry) =>
                    updateStep(step.id, {
                      name: entry.name,
                      ...(entry.learnedMinutes !== null ? { plannedMinutes: entry.learnedMinutes } : {}),
                    })
                  }
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={step.plannedMinutes}
                  aria-label={`${step.name || 'Step'} minutes`}
                  onChange={(e) => {
                    const parsed = Number.parseInt(e.target.value, 10);
                    updateStep(step.id, { plannedMinutes: Number.isNaN(parsed) ? 0 : parsed });
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
            );
          })}
        </div>

        <Button variant="secondary" onClick={addStep}>
          Add step
        </Button>
      </section>

      {/* Arrival-steps increment: same row UI as "Steps for this run" above
          (including the locked/checked-off treatment, F3's own reasoning —
          an arrival step can only ever be checked once the arrival phase
          begins on the Runway screen, but this form has no way to know
          that hasn't somehow already happened for whatever departure it's
          editing, so the same defensive lock applies here too). Optional
          and empty by default. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Arrival steps</h2>
        <p className="text-sm text-slate-500">
          After the drive, before the real target — changing, lifts, corridors. The appointment
          time is when the last of these is done.
        </p>

        <div className="flex flex-col gap-2">
          {arrivalSteps.map((step) => {
            const locked = step.checkedAt !== null;
            if (locked) {
              return (
                <div
                  key={step.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-800/60 bg-surface p-2 opacity-60"
                >
                  <span className="min-h-12 flex flex-1 items-center px-3 text-slate-400 line-through">
                    {step.name || 'Step'}
                  </span>
                  <span className="min-h-12 flex w-16 items-center justify-end px-2 text-sm tabular-nums text-slate-500">
                    {step.plannedMinutes} min
                  </span>
                  <span className="flex min-h-12 min-w-12 items-center justify-center text-xs font-medium uppercase tracking-wide text-slate-600">
                    done
                  </span>
                </div>
              );
            }
            return (
              <div key={step.id} className="flex items-center gap-2 rounded-lg border border-slate-800/60 bg-surface p-2">
                <StepNameAutocomplete
                  value={step.name}
                  library={stepLibrary}
                  onNameChange={(name) => updateArrivalStep(step.id, { name })}
                  onSelect={(entry) =>
                    updateArrivalStep(step.id, {
                      name: entry.name,
                      ...(entry.learnedMinutes !== null ? { plannedMinutes: entry.learnedMinutes } : {}),
                    })
                  }
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={step.plannedMinutes}
                  aria-label={`${step.name || 'Step'} minutes`}
                  onChange={(e) => {
                    const parsed = Number.parseInt(e.target.value, 10);
                    updateArrivalStep(step.id, { plannedMinutes: Number.isNaN(parsed) ? 0 : parsed });
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
            );
          })}
        </div>

        <Button variant="secondary" onClick={addArrivalStep}>
          Add arrival step
        </Button>
      </section>

      {preview && (
        <p className="tabular-nums text-slate-400">
          Start getting ready by <span className="font-semibold text-slate-100">{formatTime(preview.startBy)}</span>
          {' · '}
          Leave by <span className="font-semibold text-slate-100">{formatTime(preview.leaveBy)}</span>
        </p>
      )}

      {errors.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-red-400">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <Button onClick={handleSave}>Save departure</Button>
    </div>
  );
}
