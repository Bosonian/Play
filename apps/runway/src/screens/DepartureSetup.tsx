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

  const appointmentAtDate =
    appointmentDate && appointmentTime ? new Date(`${appointmentDate}T${appointmentTime}:00`) : null;
  const appointmentIsValid = appointmentAtDate !== null && !Number.isNaN(appointmentAtDate.getTime());
  const appointmentInFuture = appointmentIsValid && appointmentAtDate!.getTime() > Date.now();

  const errors: string[] = [];
  if (touched) {
    if (!appointmentIsValid) errors.push('Set an appointment date and time.');
    else if (!appointmentInFuture) errors.push('Appointment must be in the future.');
    if (travelMinutes < 0) errors.push('Travel minutes cannot be negative.');
    if (steps.length === 0) errors.push('Add at least one step.');
  }
  const canSave = appointmentInFuture && travelMinutes >= 0 && steps.length > 0;

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

    // Alarms only make sense for a departure that hasn't started yet — an
    // edit to an already-'running' or terminal departure (not a v1 path
    // today, but the guard costs nothing) shouldn't schedule new alerts.
    // Permission is requested here, lazily, on first save — never at app
    // launch (CLAUDE.md: no permission ambush) — and saving never blocks on
    // the answer: a 'denied' result still leaves the departure saved, the
    // Home screen's exact-alarm banner (increment-4 §6) is the non-blocking
    // surface for "alerts may not fire", not this form.
    if (savedDeparture.status === 'planned') {
      await ensurePermissions();
      await scheduleDepartureAlarms(savedDeparture);
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
