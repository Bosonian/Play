import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getISODay } from 'date-fns';
import { db } from '../db/db';
import type { Departure, DepartureStep, Template, TemplateSchedule } from '../db/types';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { NumberField } from '../ui/NumberField';
import { TextField } from '../ui/TextField';
import { ScreenHeader } from '../ui/ScreenHeader';
import { RepeatEditor } from '../ui/RepeatEditor';
import { computeProjection, computeStartBy } from '../lib/projection';
import { formatDateInput, formatTime, formatTimeInput } from '../lib/format';
import { ensurePermissions, scheduleDepartureAlarms } from '../native/notifications';
import { readLiveTravelConfig } from '../lib/liveTravelSettings';
import { fetchDriveMinutes } from '../lib/routesApi';
import { getCurrentPosition } from '../native/geolocation';
import { refreshWidgets } from '../native/widgets';
import { refreshDayGauge } from '../lib/dayGaugeRefresh';
import { stepNameLibrary } from '../lib/learning';
import { materializeScheduledDepartures, replaceUntouchedFutureAutoRows } from '../lib/materialize';
import { scheduleDiffers } from '../lib/recurrence';
import { StepNameAutocomplete } from '../ui/StepNameAutocomplete';
import { logEvent } from '../lib/eventLog';

const DEFAULT_REPEAT_TIME = '08:00';

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
  // Calendar-recurrence increment (field report #10 §2): set only by Home's
  // "Plan departure" action on a calendar card whose event RRULE parsed
  // (src/lib/rrule.ts's parseWeeklyRrule) — ISO weekday numbers, ready to
  // drop straight into a TemplateSchedule. Same "applied once, create only"
  // shape as every other prefill prop on this screen; see the Repeat
  // section's own state below for how it's used.
  prefillRepeatDays?: number[];
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
  prefillRepeatDays,
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
  // Arrival-detection increment: same shape as TemplateEdit's own field —
  // blank form state means "not set", converted to the DB's `null` on save.
  const [arrivalWifiSsid, setArrivalWifiSsid] = useState<string>('');

  // Repeat-at-creation (field report #10 §2). Create-only, same as the
  // prefill props above — this section is never rendered in edit mode (see
  // the JSX below), so `repeatEnabled` simply stays false for the lifetime
  // of an edit-mode form and never affects anything. Pre-enabled, once, when
  // `prefillRepeatDays` arrived from a parsed calendar RRULE (Home's "Plan
  // departure" on a repeating calendar event) — same lazy-initializer,
  // applied-once shape as `name`/`destination` above. `repeatTime` seeds
  // from `prefillAppointmentIso` when there is one (the calendar event's own
  // time), falling back to the same DEFAULT_REPEAT_TIME TemplateEdit uses
  // when there's nothing yet to seed from.
  const [repeatEnabled, setRepeatEnabled] = useState(
    () => !departureId && (prefillRepeatDays?.length ?? 0) > 0,
  );
  const [repeatTime, setRepeatTime] = useState(() =>
    !departureId && prefillAppointmentIso ? formatTimeInput(new Date(prefillAppointmentIso)) : DEFAULT_REPEAT_TIME,
  );
  const [repeatDays, setRepeatDays] = useState<number[]>(() =>
    !departureId && prefillRepeatDays ? prefillRepeatDays : [],
  );
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
      setArrivalWifiSsid(existingDeparture.arrivalWifiSsid ?? '');
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
          // Estimation-bias increment: a copy of a template step has the
          // same provenance as its source — same reasoning as
          // materialize.ts's buildDeparture, just triggered by "New from
          // template" instead of the recurring materializer.
          estimateSource: step.estimateSource,
        })),
      );
      // Same fresh-ids-copied-from-template shape as `steps` above.
      setArrivalSteps(
        (sourceTemplate.arrivalSteps ?? []).map((step) => ({
          id: crypto.randomUUID(),
          name: step.name,
          plannedMinutes: step.minutes,
          checkedAt: null,
          estimateSource: step.estimateSource,
        })),
      );
      setArrivalWifiSsid(sourceTemplate.arrivalWifiSsid ?? '');

      // Field report #12: a template with a standing `schedule` seeds the
      // Repeat editor as ON, not the OFF default — the form must reflect
      // the template's actual standing reality. Leaving this OFF on a
      // repeating template was the "inviting condition" flagged in the
      // report: it looked like a normal, harmless toggle to flip back on,
      // but flipping it (before the save-fix below) minted a SECOND
      // template rather than editing the one already repeating, which is
      // exactly the twin-template bug field report #12 diagnosed. Mirrors
      // TemplateEdit's own populate-from-`existing` effect, which has
      // always done this for an edited template — this form just never
      // did it for a template being read FROM, only one being read INTO.
      if (sourceTemplate.schedule != null) {
        setRepeatEnabled(true);
        setRepeatTime(sourceTemplate.schedule.time);
        setRepeatDays(sourceTemplate.schedule.days);
      }
    }
  }, [sourceTemplate]);

  function addStep() {
    // Estimation-bias increment: a freshly added row's default 5 min is
    // Deepak's own baseline until an autocomplete pick or a hand-edit says
    // otherwise — see db/types.ts's DepartureStep.estimateSource comment.
    setSteps((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: '', plannedMinutes: 5, checkedAt: null, estimateSource: 'manual' },
    ]);
  }

  function removeStep(stepId: string) {
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
  }

  function updateStep(stepId: string, patch: Partial<DepartureStep>) {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
  }

  // Estimation-bias increment: any direct edit of a step's minutes is, by
  // definition, Deepak's own hand — flips provenance back to 'manual' even
  // if this step's minutes previously came from a learned prefill. Kept
  // separate from `updateStep` (which is also used for the autocomplete's
  // name+minutes patch, where 'learned' is the correct outcome) rather than
  // baked into it, so the two call sites can't be confused for each other.
  function updateStepMinutes(stepId: string, plannedMinutes: number) {
    updateStep(stepId, { plannedMinutes, estimateSource: 'manual' });
  }

  // Reordering increment (field report, direct request: "also need an
  // option to reorder the steps in their chronological order"). This used
  // to be a deliberate omission — DepartureSetup never offered reordering
  // for `steps`, on the reasoning that TemplateEdit was the one place that
  // needed it. That reasoning is reversed here by direct user request: a
  // one-off departure's own step order can be wrong too, and there's no
  // reason to force a round trip through "save as template, reorder there,
  // copy back" just to fix it. Implementation is copied from TemplateEdit's
  // moveStep verbatim — same swap-with-neighbor idiom, same no-op at either
  // end of the array — so the two editors stay behaviourally identical
  // rather than growing two subtly different reorder implementations.
  //
  // Safe to allow even while `isEditingRunning` (a departure whose run is
  // already under way), unlike some of this form's other edits: every
  // downstream reader that cares about step order reads it in a way that's
  // insensitive to swaps across a checked/unchecked boundary. computeProjection
  // (projection.ts) only ever SUMS unchecked steps' plannedMinutes — order
  // never enters the math. currentStepAnchor (currentStepElapsed.ts) picks
  // the "current" step as the first `checkedAt === null` entry in list
  // order, but its own doc comment already establishes checking is
  // nonlinear ("any step can be checked in any order") and its anchor
  // timestamp is the MOST RECENT checkedAt across the whole list, not
  // whatever precedes the current step positionally. The one place list
  // order is genuinely user-visible — which unchecked step Runway.tsx shows
  // as "current" vs. "later" — only depends on the RELATIVE order of
  // unchecked steps among themselves; swapping an unchecked step with an
  // adjacent CHECKED one (one step at a time, which is all `moveStep` ever
  // does) can never change that relative order, because the checked
  // neighbor is invisible to the unchecked-only filter both Runway.tsx and
  // this reasoning are built on. So reordering while running can only ever
  // do the one thing it's meant to do — change which step comes next — and
  // never corrupts the projection or the checked-step history.
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

  // Arrival-steps increment: same trio as the prep-steps quartet above,
  // mechanically identical, just pointed at `arrivalSteps`. `moveArrivalStep`
  // mirrors `moveStep` above for the same reordering increment, same safety
  // reasoning (computeProjection's arrival-minutes term is also a sum over
  // unchecked steps — see projection.ts).
  function addArrivalStep() {
    setArrivalSteps((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: '', plannedMinutes: 5, checkedAt: null, estimateSource: 'manual' },
    ]);
  }

  function removeArrivalStep(stepId: string) {
    setArrivalSteps((prev) => prev.filter((s) => s.id !== stepId));
  }

  function updateArrivalStep(stepId: string, patch: Partial<DepartureStep>) {
    setArrivalSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
  }

  // Same "a hand-edit is always manual" reasoning as updateStepMinutes above.
  function updateArrivalStepMinutes(stepId: string, plannedMinutes: number) {
    updateArrivalStep(stepId, { plannedMinutes, estimateSource: 'manual' });
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

  function toggleRepeatDay(iso: number) {
    setRepeatDays((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort()));
  }

  // Repeat-at-creation (§2): seeds sane defaults the moment the toggle is
  // turned ON, from whatever's already in the appointment date/time fields
  // right now — "time = the form's appointment time, days = [appointment
  // weekday]" per the fix spec. Only seeds when nothing's been chosen yet
  // (`repeatDays.length === 0`): flipping the toggle off and back on
  // shouldn't clobber a day/time already picked, and a calendar-prefilled
  // form arrives with `repeatDays` already non-empty, so this never
  // overwrites that either. If the appointment date/time aren't set yet
  // (blank Time field, the ordinary "from scratch" starting state), this
  // simply has nothing to seed from and leaves the existing repeatTime/
  // repeatDays state alone — RepeatEditor's own validation message then
  // guides the fill-in from there.
  function handleRepeatEnabledChange(nextEnabled: boolean) {
    setRepeatEnabled(nextEnabled);
    if (nextEnabled && repeatDays.length === 0) {
      if (appointmentTime !== '') setRepeatTime(appointmentTime);
      if (appointmentAtDate) setRepeatDays([getISODay(appointmentAtDate)]);
    }
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

  // Repeat-at-creation (§2). Only ever relevant on create — `repeatEnabled`
  // stays false for the lifetime of an edit-mode form (never toggled on,
  // the section isn't even rendered there), so this is trivially `true` in
  // edit mode and never blocks that save path. RepeatEditor renders its own
  // "Set a time and pick at least one day." message inline when this is
  // false, the same way TemplateEdit's own repeatValid does — no separate
  // entry in the generic `errors` list above.
  const repeatValid = !repeatEnabled || (repeatTime !== '' && repeatDays.length > 0);
  const canSave =
    appointmentInFuture &&
    travelMinutes >= 0 &&
    bufferMinutes >= 0 &&
    steps.every((step) => step.plannedMinutes >= 0) &&
    steps.length > 0 &&
    arrivalSteps.every((step) => step.plannedMinutes >= 0) &&
    repeatValid;

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
      // '' -> null, same tri-state rule TemplateEdit's own save uses.
      arrivalWifiSsid: arrivalWifiSsid.trim() === '' ? null : arrivalWifiSsid.trim(),
    };

    let savedDeparture: Departure;
    if (departureId && existingDeparture) {
      await db.departures.update(departureId, sharedFields);
      savedDeparture = { ...existingDeparture, ...sharedFields };
      void logEvent('departure', `Departure edited: ${savedDeparture.name}.`);
    } else {
      // Save-with-repeat (field report #10 §2, reworked by field report
      // #12) — the careful part, worth spelling out in full. Turning
      // Repeat on here does NOT spin up a second scheduler on this one
      // departure — per this fix's binding design decision (ONE recurrence
      // engine: templates) — but WHICH template it points at now depends
      // on whether this form was seeded from one:
      //
      //  - New-from-template (`sourceTemplate` set — App.tsx's
      //    `templateId` prop resolved to a real row): field report #12's
      //    bug. The pre-fix code ALWAYS minted a brand-new Template here
      //    whenever Repeat was on, even though the form already came FROM
      //    a template — "New from template" + Repeat on produced a twin:
      //    two templates, each materializing its own week of departures,
      //    with no way to tell from Home which twin owned which row (hence
      //    the report's second symptom, an "undeletable" departure — it
      //    wasn't undeletable, its sibling from the OTHER twin was still
      //    there). The fix: reuse `sourceTemplate` instead of creating a
      //    second one. See the branch below for what "reuse" writes.
      //  - From-scratch (`sourceTemplate` unset) with Repeat on: unchanged
      //    from field report #10 §2 — there's no existing template to
      //    reuse, so promoting this one-off form into a brand-new Template
      //    carrying the chosen schedule is still correct.
      //  - Without Repeat and without `sourceTemplate`: unchanged from
      //    before either fix — `templateId` stays whatever was passed in
      //    (or `null`) and `scheduledForDate` stays `null`.
      //
      // Whenever a template — new or reused — ends up linked,
      // `scheduledForDate` is stamped with THIS appointment's own date, the
      // exact join key materialize.ts's createMissingOccurrences reads to
      // decide "already planned" vs "still missing" for a given
      // template+date. Setting it here means the materialize call at the
      // end of this branch can never create a second departure for the
      // same date, even though this particular row was hand-built by this
      // form, not by the materializer itself — EVEN WHEN today's weekday
      // isn't among the chosen repeat days (a real combination: planning
      // today's one-off Friday appointment while the recurring schedule is
      // Mon/Wed only). The dedup key is an exact DATE match, not "was this
      // date implied by the schedule", so the two disagreeing is not a
      // conflict the materializer would ever need to resolve.
      let linkedTemplateId: string | null = templateId ?? null;
      let scheduledForDateValue: string | null = null;
      let repeatTemplateJustCreated = false;
      let scheduleChanged = false;

      if (sourceTemplate) {
        // Reuse path (field report #12's fix): this departure is always
        // linked back to the template it was created from, whether or not
        // Repeat ended up enabled — a one-off instance of a standing
        // routine is still an instance of it (buildDeparture, materialize.ts,
        // sets `templateId` on every materialized row the same
        // unconditional way, regardless of that occurrence's own date —
        // this keeps a hand-created "New from template" row consistent
        // with a materializer-created one).
        linkedTemplateId = sourceTemplate.id;

        if (repeatEnabled) {
          const nextSchedule: TemplateSchedule = { time: repeatTime, days: repeatDays };
          // Deliberately does NOT write this form's steps/travel/buffer
          // back to the template — a one-day tweak on today's departure
          // (an extra step, a longer buffer because of traffic) stays on
          // THIS departure; the template remains the standing routine
          // everyone else's occurrences still copy from. Only `schedule`
          // is ever eligible to flow back, and only when it actually
          // changed — see scheduleDiffers's own doc comment (recurrence.ts)
          // for why an order-insensitive day-set comparison is what
          // "changed" means here.
          if (scheduleDiffers(sourceTemplate.schedule, nextSchedule)) {
            const templateNowIso = new Date().toISOString();
            await db.templates.update(sourceTemplate.id, {
              schedule: nextSchedule,
              updatedAt: templateNowIso,
            });
            // Same "replace, then re-materialize" pairing TemplateEdit's
            // own schedule-change save uses (see its handleSave comment) —
            // without this sweep, the week already materialized under the
            // OLD schedule would keep its stale rows (and stale alarms)
            // sitting alongside whatever the new schedule produces below.
            await replaceUntouchedFutureAutoRows(sourceTemplate.id);
            scheduleChanged = true;
          }
          scheduledForDateValue = formatDateInput(appointmentAtDate);
        }
        // repeatEnabled === false here means Deepak explicitly turned the
        // toggle off on a from-template create (it seeds ON for a
        // repeating template — see the populate effect above). The
        // template is left completely untouched: turning Repeat off on
        // ONE instance is not a request to stop the standing routine.
        // `scheduledForDate` stays `null` — this row isn't claiming to BE
        // a materialized occurrence of the schedule, just a manually
        // created one-off that happens to share the template's steps.
      } else if (repeatEnabled) {
        // From-scratch create with Repeat on (field report #10 §2):
        // unchanged — there's no existing template to reuse, so this
        // promotes the one-off form into a brand-new Template.
        const templateNowIso = new Date().toISOString();
        const newTemplate: Template = {
          id: crypto.randomUUID(),
          name: sharedFields.name,
          destination: sharedFields.destination,
          travelMinutes,
          bufferMinutes,
          // Fresh ids, copied (not referenced) from this departure's own
          // steps — mirrors materialize.ts's buildDeparture doing the
          // exact reverse copy (Template -> Departure) and TemplateEdit's
          // "Make repeating" path (§3) doing this same Departure ->
          // Template direction for an EXISTING departure.
          steps: steps.map((step) => ({
            id: crypto.randomUUID(),
            name: step.name,
            minutes: step.plannedMinutes,
            // Estimation-bias increment: reverse-direction copy of the same
            // "a copy has the same provenance as its source" rule (see
            // db/types.ts's StepTemplate.estimateSource comment).
            estimateSource: step.estimateSource,
          })),
          arrivalSteps: arrivalSteps.map((step) => ({
            id: crypto.randomUUID(),
            name: step.name,
            minutes: step.plannedMinutes,
            estimateSource: step.estimateSource,
          })),
          arrivalWifiSsid: sharedFields.arrivalWifiSsid,
          createdAt: templateNowIso,
          updatedAt: templateNowIso,
          schedule: { time: repeatTime, days: repeatDays },
          // Opt-in only (db/types.ts's own doc comment) — a template
          // created from a one-off form has no run history yet for
          // autoLearn to have anything to learn from, same "off by
          // default" TemplateEdit's own BLANK constant uses for an
          // ordinary new template.
          autoLearn: false,
        };
        await db.templates.add(newTemplate);
        linkedTemplateId = newTemplate.id;
        repeatTemplateJustCreated = true;
        scheduledForDateValue = formatDateInput(appointmentAtDate);
      }

      savedDeparture = {
        id: crypto.randomUUID(),
        templateId: linkedTemplateId,
        ...sharedFields,
        status: 'planned',
        startedAt: null,
        leftAt: null,
        arrivalResult: null,
        arrivalLateMinutes: null,
        createdAt: nowIso,
        scheduledForDate: scheduledForDateValue,
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
      void logEvent('departure', `Departure created: ${savedDeparture.name}.`);
      if (sourceTemplate) {
        void logEvent('departure', `Departure linked to template: ${sourceTemplate.name}.`);
      }

      if (repeatTemplateJustCreated || scheduleChanged) {
        // Materializes the rest of the week, minus today — today's own
        // occurrence is already covered by the departure just saved above,
        // so this can only ever fill in the remaining scheduled days,
        // never duplicate it. Also the right call after a reused
        // template's schedule changed just above: replaceUntouchedFutureAutoRows
        // already cleared the stale week, so this is what actually
        // re-plans it under the new schedule.
        await materializeScheduledDepartures();
      }
    }

    // Widgets increment: name/appointment/steps/travel — everything the
    // departure widget's three lines read — may have just changed, or a
    // brand-new departure may now be the soonest planned one.
    void refreshWidgets();
    void refreshDayGauge();

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
          {steps.map((step, index) => {
            // F3: a checked step is history, not a draft - toggleStep
            // (Runway.tsx) stamped `checkedAt` for a reason, and this form
            // must not be a back door to un-stamp it, rename it, or resize
            // it after the fact. Locked rows render dimmed with a plain
            // "done" label instead of inputs; the step simply never appears
            // in an onChange/onClick handler, which is what actually keeps
            // its `checkedAt`/`name`/`plannedMinutes` untouched all the way
            // through to the save in handleSave above (this component never
            // clears or rewrites those fields for a step it never edited).
            // Same rule extends to the reorder buttons below (reordering
            // increment): a locked row gets none, so a checked step's
            // position — like everything else about it — stays untouched
            // by this form.
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
                {/* Reordering increment: same up/down pair as TemplateEdit's
                    step rows, mirrored exactly (aria-labels included) — see
                    moveStep's own doc comment for why this is safe to offer
                    even on a running departure's unchecked steps. `index` is
                    this row's position in the FULL `steps` array (locked
                    rows included), matching moveStep's own array-index
                    semantics. */}
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
                  library={stepLibrary}
                  onNameChange={(name) => updateStep(step.id, { name })}
                  onSelect={(entry) =>
                    updateStep(step.id, {
                      name: entry.name,
                      ...(entry.learnedMinutes !== null
                        ? { plannedMinutes: entry.learnedMinutes, estimateSource: 'learned' }
                        : {}),
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
          and empty by default. Reordering increment: also gets the same
          up/down pair as the prep-steps section above — see moveArrivalStep's
          own comment (next to moveStep) for the shared safety reasoning;
          computeProjection's arrival term is a sum over unchecked steps the
          same way its prep term is. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Arrival steps</h2>
        <p className="text-sm text-slate-500">
          After the drive, before the real target — changing, lifts, corridors. The appointment
          time is when the last of these is done.
        </p>

        <div className="flex flex-col gap-2">
          {arrivalSteps.map((step, index) => {
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
                  library={stepLibrary}
                  onNameChange={(name) => updateArrivalStep(step.id, { name })}
                  onSelect={(entry) =>
                    updateArrivalStep(step.id, {
                      name: entry.name,
                      ...(entry.learnedMinutes !== null
                        ? { plannedMinutes: entry.learnedMinutes, estimateSource: 'learned' }
                        : {}),
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
            );
          })}
        </div>

        <Button variant="secondary" onClick={addArrivalStep}>
          Add arrival step
        </Button>

        {/* Arrival-detection increment (0.23.0): same gating and copy as
            TemplateEdit's own field — only offered once there's an arrival
            phase for Wi-Fi detection to matter to. */}
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

      {/* Repeat-at-creation (field report #10 §2): create-only, never shown
          on an edit — Repeat's whole job is to promote a one-off FORM into
          a Template with a schedule (see handleSave's own comment), and an
          already-saved departure has nothing left to "promote" this way;
          use TemplateEdit's own "Make repeating" action (Home) for that
          instead. */}
      {!departureId && (
        <RepeatEditor
          enabled={repeatEnabled}
          onEnabledChange={handleRepeatEnabledChange}
          time={repeatTime}
          onTimeChange={setRepeatTime}
          days={repeatDays}
          onToggleDay={toggleRepeatDay}
          valid={repeatValid}
          extraCaption={
            (prefillRepeatDays?.length ?? 0) > 0 ? 'This appointment repeats in your calendar.' : undefined
          }
        />
      )}

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
