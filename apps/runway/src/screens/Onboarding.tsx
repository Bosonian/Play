import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { db } from '../db/db';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { NumberField } from '../ui/NumberField';
import { TextAction } from '../ui/TextAction';
import { TextField } from '../ui/TextField';
import { computeProjection, computeStartBy } from '../lib/projection';
import { formatTime } from '../lib/format';
import {
  buildFirstDeparture,
  DEFAULT_TRAVEL_MINUTES,
  ONBOARDING_DONE_KEY,
  PRUEFUNG_ENABLED_KEY,
  resolveAppointment,
  STARTER_STEPS,
} from '../lib/onboarding';
import { ensurePermissions, scheduleDepartureAlarms } from '../native/notifications';
import { refreshWidgets } from '../native/widgets';
import { refreshDayGauge } from '../lib/dayGaugeRefresh';
import { logEvent } from '../lib/eventLog';

interface OnboardingProps {
  onNavigate: (screen: Screen) => void;
}

/**
 * First-run introduction: three steps, and a way out of all of them.
 *
 * Why this does not reuse DepartureSetup (see also the 0.52.0 report):
 * DepartureSetup is a ~1,100-line form whose save logic is inlined in the
 * component and entangled with templates, repeat, live travel, arrival
 * steps and calendar prefills, and it always navigates Home when done.
 * There is no seam to call it from here and land on step 3. What IS shared:
 * the UI primitives, projection.ts's equations (so the "leave at" shown here
 * is the same number Runway will show), and the same post-save side effects
 * (widgets, day gauge, alarms with lazy permission). The Departure row
 * itself comes from buildFirstDeparture (lib/onboarding.ts), which mirrors
 * DepartureSetup's create path. Tradeoff: if the Departure shape changes
 * again, that builder is a second place to update; its unit test and
 * typecheck are the guard.
 *
 * Skipping: "Skip setup" is on every step and writes ONBOARDING_DONE_KEY, so
 * skipping is never "ask me again tomorrow". It leaves Prüfung hidden (a
 * missing setting on a database without an exam reads as disabled).
 */
type Step = 1 | 2 | 3;

export function Onboarding({ onNavigate }: OnboardingProps) {
  const [step, setStep] = useState<Step>(1);

  // Step 2 state. `now` is read fresh on every render (and again at save)
  // rather than frozen at mount: someone who types 17:00 at 16:58 and saves
  // at 17:02 must get tomorrow, not an appointment already in the past.
  const now = new Date();
  const [name, setName] = useState('');
  const [time, setTime] = useState('');
  const [travelMinutes, setTravelMinutes] = useState(DEFAULT_TRAVEL_MINUTES);
  const [stepRows, setStepRows] = useState(() => STARTER_STEPS.map((s) => ({ ...s })));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const resolved = resolveAppointment(time, now);
  const usableSteps = stepRows.filter((row) => row.name.trim() !== '');
  const valid = resolved !== null && travelMinutes >= 0 && usableSteps.length > 0;

  // Cheap enough to recompute per render; no memo needed.
  let preview: { startBy: Date; leaveBy: Date } | null = null;
  if (resolved && usableSteps.length > 0) {
    const draft = buildFirstDeparture({
      name,
      appointmentAt: resolved.at,
      travelMinutes,
      steps: stepRows,
      now,
      newId: () => 'preview',
    });
    preview = { startBy: computeStartBy(draft), leaveBy: computeProjection(now, draft).leaveBy };
  }

  async function finish(answer: boolean | null) {
    // answer === null means skipped before answering: write no
    // Prüfung row at all, leaving the default (hidden on a database with no
    // exam) rather than recording an answer nobody gave.
    if (answer !== null) {
      await db.settings.put({ key: PRUEFUNG_ENABLED_KEY, value: answer ? 'true' : 'false' });
    }
    await db.settings.put({ key: ONBOARDING_DONE_KEY, value: 'true' });
    void logEvent('lifecycle', 'Onboarding finished.');
    onNavigate({ name: 'home' });
  }

  async function skipSetup() {
    await db.settings.put({ key: ONBOARDING_DONE_KEY, value: 'true' });
    void logEvent('lifecycle', 'Onboarding skipped.');
    onNavigate({ name: 'home' });
  }

  async function saveDeparture() {
    setTouched(true);
    // Re-resolved against the real clock at the moment of saving.
    const savedAt = new Date();
    const target = resolveAppointment(time, savedAt);
    if (!valid || !target || saving) return;
    setSaving(true);
    const departure = buildFirstDeparture({
      name,
      appointmentAt: target.at,
      travelMinutes,
      steps: stepRows,
      now: savedAt,
      newId: () => crypto.randomUUID(),
    });
    await db.departures.add(departure);
    void logEvent('departure', `Departure created: ${departure.name}.`);
    void refreshWidgets();
    void refreshDayGauge();
    // Same lazy permission ask as DepartureSetup's save: a rejected or
    // failed alarm schedule never blocks the departure that already landed.
    try {
      if (await ensurePermissions()) await scheduleDepartureAlarms(departure);
    } catch (err) {
      console.warn('Runway: failed to schedule departure alarms', err);
    }
    setSaving(false);
    setStep(3);
  }

  function updateRow(index: number, patch: Partial<{ name: string; minutes: number }>) {
    setStepRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <p className="text-sm tabular-nums text-slate-500">{step} of 3</p>
      </div>

      {step === 1 && (
        <section className="flex flex-col gap-4">
          <h1 className="text-xl font-semibold text-slate-100">Runway</h1>
          <p className="text-slate-300">
            Runway is for the gap between knowing when you need to be somewhere and leaving in time.
          </p>
          <p className="text-slate-300">
            You give it the time you need to be there and the steps you do beforehand. It works
            backwards to when you need to leave, then keeps telling you the truth as minutes slip.
          </p>
          <Button onClick={() => setStep(2)}>Continue</Button>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-5">
          <h1 className="text-xl font-semibold text-slate-100">Your first departure</h1>
          <p className="text-slate-400">
            Something you need to get to. A real one is better than an example.
          </p>

          <TextField
            // "Name", not "What is it" (review fix): DepartureSetup labels
            // this exact field "Name", and a stranger reaches that screen
            // within a minute of finishing here. Two labels for one field,
            // on consecutive screens, is the imprecision the brief warns
            // about. The placeholder does the guiding "What is it" was
            // reaching for, without inventing a second name for the field.
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dentist"
            autoComplete="off"
          />
          <TextField
            label="Be there at"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            hint={
              resolved
                ? resolved.isTomorrow
                  ? `Tomorrow, ${time}.`
                  : `Today, ${time}.`
                : 'A time in 24-hour format. If it has passed today, it means tomorrow.'
            }
          />
          <NumberField
            // Matches DepartureSetup's own "Travel minutes" for the same
            // reason as "Name" above, and it reads better: the comma in
            // "Travel, in minutes" was doing no work.
            label="Travel minutes"
            value={travelMinutes}
            onChange={setTravelMinutes}
            hint="Door to door."
          />

          <div className="flex flex-col gap-3">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
              Steps before you leave
            </h2>
            {stepRows.map((row, index) => (
              <div key={index} className="flex items-end gap-3">
                <TextField
                  label={`Step ${index + 1}`}
                  containerClassName="flex-1"
                  value={row.name}
                  onChange={(e) => updateRow(index, { name: e.target.value })}
                  autoComplete="off"
                />
                <NumberField
                  label="Minutes"
                  value={row.minutes}
                  onChange={(minutes) => updateRow(index, { minutes })}
                />
              </div>
            ))}
            <p className="text-sm text-slate-500">
              Change these to match you. Clear a name to drop that step.
            </p>
          </div>

          {preview && (
            <p className="tabular-nums text-slate-200">
              Start at {formatTime(preview.startBy)}. Leave at {formatTime(preview.leaveBy)}.
              {/* "Includes ten minutes of buffer." — the previous wording,
                  "Ten minutes of buffer are included.", put a plural verb
                  against a singular head noun and read as a translation.
                  The active form is shorter and says the same thing. */}
              <span className="block text-sm text-slate-500">Includes ten minutes of buffer.</span>
            </p>
          )}

          {touched && !valid && (
            <p className="text-sm text-amber-400">
              {resolved === null
                ? 'Set a time.'
                : usableSteps.length === 0
                  ? 'Keep at least one step.'
                  : 'Travel minutes cannot be negative.'}
            </p>
          )}

          {Capacitor.isNativePlatform() && (
            <p className="text-sm text-slate-500">
              Saving asks Android for permission to send alerts. They are how Runway tells you when
              to start and when to leave.
            </p>
          )}

          <div className="flex flex-col gap-2">
            <Button onClick={() => void saveDeparture()} disabled={saving}>
              Save departure
            </Button>
            <Button variant="secondary" onClick={() => setStep(3)} disabled={saving}>
              Skip this step
            </Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="flex flex-col gap-4">
          <h1 className="text-xl font-semibold text-slate-100">Are you preparing for an exam?</h1>
          <p className="text-slate-300">
            Runway has a separate mode, Prüfung, for exam preparation: topics, timed study sprints
            and milestones. It stays hidden unless you want it.
          </p>
          <p className="text-slate-400">
            Optional. You can change this later in Settings, under Show Prüfung on Home.
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => void finish(true)}>Yes, show Prüfung</Button>
            <Button variant="secondary" onClick={() => void finish(false)}>
              No, keep it hidden
            </Button>
          </div>
        </section>
      )}

      <div className="mt-auto">
        {/* On every step. Writes the done flag, so skipping is final. On
            step 3 it behaves like "No": nothing has been answered, and the
            default is hidden. */}
        <TextAction onClick={() => void (step === 3 ? finish(null) : skipSetup())}>Skip setup</TextAction>
      </div>
    </div>
  );
}
