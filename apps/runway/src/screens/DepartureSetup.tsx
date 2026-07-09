import { useEffect, useState } from 'react';
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

interface DepartureSetupProps {
  templateId?: string;
  departureId?: string;
  onNavigate: (screen: Screen) => void;
}

export function DepartureSetup({ templateId, departureId, onNavigate }: DepartureSetupProps) {
  const existingDeparture = useLiveQuery(
    () => (departureId ? db.departures.get(departureId) : undefined),
    [departureId],
  );
  const sourceTemplate = useLiveQuery(
    () => (templateId && !departureId ? db.templates.get(templateId) : undefined),
    [templateId, departureId],
  );

  const now = new Date();
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  // Default date is today (CLAUDE.md: don't make the user re-pick what's
  // already obvious). Time is left blank — defaulting it to "now" would
  // silently fail the future-appointment validation for most real setups,
  // so it's more honest to make the user choose.
  const [appointmentDate, setAppointmentDate] = useState(formatDateInput(now));
  const [appointmentTime, setAppointmentTime] = useState('');
  const [travelMinutes, setTravelMinutes] = useState(20);
  const [bufferMinutes, setBufferMinutes] = useState(10);
  const [steps, setSteps] = useState<DepartureStep[]>([]);
  const [touched, setTouched] = useState(false);

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
  }
  const canSave =
    appointmentInFuture &&
    travelMinutes >= 0 &&
    bufferMinutes >= 0 &&
    steps.every((step) => step.plannedMinutes >= 0) &&
    steps.length > 0;

  // Live preview — same equation as the Runway screen, evaluated with
  // every step unchecked (nothing has started yet). computeStartBy answers
  // "when do I need to start prep"; computeProjection's leaveBy answers
  // "when do I need to be out the door", independent of prep.
  const preview =
    appointmentIsValid && steps.length > 0
      ? {
          startBy: computeStartBy({
            appointmentAt: appointmentAtDate!.toISOString(),
            travelMinutes,
            bufferMinutes,
            steps,
          }),
          leaveBy: computeProjection(now, {
            appointmentAt: appointmentAtDate!.toISOString(),
            travelMinutes,
            bufferMinutes,
            steps,
          }).leaveBy,
        }
      : null;

  async function handleSave() {
    setTouched(true);
    if (!canSave || !appointmentAtDate) return;

    const nowIso = new Date().toISOString();
    const sharedFields = {
      name: name.trim() || destination.trim() || 'Departure',
      destination: destination.trim(),
      appointmentAt: appointmentAtDate.toISOString(),
      travelMinutes,
      bufferMinutes,
      steps,
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
      };
      await db.departures.add(savedDeparture);
    }

    // Widgets increment: name/appointment/steps/travel — everything the
    // departure widget's three lines read — may have just changed, or a
    // brand-new departure may now be the soonest planned one.
    void refreshWidgets();

    // Alarms only make sense for a departure that hasn't started yet — an
    // edit to a 'running' or terminal departure would schedule alerts for a
    // plan that's already moot, so the status check matters here even
    // though Home's Edit action already only offers editing while
    // 'planned' (belt and suspenders: this function has no way to know
    // *why* it was called). Editing a 'planned' departure lands here too —
    // scheduleDepartureAlarms cancels whatever was scheduled from the
    // previous save before scheduling the new times (src/native/
    // notifications.ts), so an edit always reschedules, unconditionally,
    // for the only path this branch can take (planned).
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
    if (savedDeparture.status === 'planned') {
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
            className="min-h-11 rounded-md px-2 text-sm font-medium text-sky-400 hover:text-sky-300"
          >
            Check route in Maps
          </button>
        )}
        {/* Live-travel increment: only offered when the feature is on
            (Settings) and there's a destination to fetch a route to — same
            gating the Maps link above uses, plus the settings check. */}
        {liveTravelConfig?.enabled && destination.trim() !== '' && (
          <button
            type="button"
            onClick={() => void handleFetchLiveTravel()}
            disabled={fetchingLiveTravel}
            className="min-h-11 rounded-md px-2 text-sm font-medium text-sky-400 hover:text-sky-300 disabled:opacity-40"
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
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
          Steps for this run
        </h2>

        <div className="flex flex-col gap-2">
          {steps.map((step) => (
            <div key={step.id} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 p-2">
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
                value={step.plannedMinutes}
                aria-label={`${step.name || 'Step'} minutes`}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10);
                  updateStep(step.id, { plannedMinutes: Number.isNaN(parsed) ? 0 : parsed });
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

      {preview && (
        <p className="tabular-nums text-slate-300">
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
