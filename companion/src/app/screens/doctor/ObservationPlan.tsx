import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, finishObservationStudy, getActiveObservationStudy, putObservationStudy } from '../../db/store';
import { buildObservationStudy, observationProgress, type ObservationDurationDays } from '../../../domain/observation';
import type { RegimenItem } from '../../../domain/regimen';
import { safeUuid } from '../../lib/uuid';
import { logEvent } from '../../activity/activityLog';
import { observationRemindersNative } from '../../observationReminders/native';
import { syncObservationReminderStudy } from '../../observationReminders/reconcile';
import {
  reminderTimes,
  validateObservationReminderPlan,
  type ObservationReminderPlanV1,
  type ReminderIntervalMinutes,
} from '../../../domain/observationReminders';

function defaultReminderPlan(): ObservationReminderPlanV1 {
  return {
    version: 1,
    revision: 1,
    enabled: false,
    mode: 'interval',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    firstTime: '08:00',
    lastTime: '20:00',
    intervalMinutes: 120,
  };
}

function ReminderPlanEditor({
  plan,
  onChange,
  onEnabledChange,
}: {
  plan: ObservationReminderPlanV1;
  onChange: (plan: ObservationReminderPlanV1) => void;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const errors = plan.enabled ? validateObservationReminderPlan(plan) : [];
  const times = reminderTimes(plan);
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <label className="flex items-start gap-2 text-body text-fg">
        <input type="checkbox" checked={plan.enabled}
          onChange={(event) => onEnabledChange(event.target.checked)} />
        <span>Remind the patient to complete a state check and both-hand tapping test</span>
      </label>
      <p className="mt-2 text-caption text-fg-muted">
        Reminders are off by default. These times organize data collection; they are not treatment or dosing recommendations.
      </p>
      {plan.enabled && (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2" aria-label="Reminder schedule type">
            <button type="button" aria-pressed={plan.mode === 'interval'}
              onClick={() => onChange({ ...plan, mode: 'interval', customTimes: undefined })}
              className="rounded-sm border border-line px-3 py-2 text-label">Regular interval</button>
            <button type="button" aria-pressed={plan.mode === 'custom'}
              onClick={() => onChange({ ...plan, mode: 'custom', intervalMinutes: undefined, customTimes: [] })}
              className="rounded-sm border border-line px-3 py-2 text-label">Custom times</button>
          </div>
          <div className="flex gap-3">
            <label className="text-label text-fg-muted">First
              <input type="time" value={plan.firstTime}
                onChange={(event) => onChange({ ...plan, firstTime: event.target.value })}
                className="mt-1 block rounded-sm border border-line bg-bg px-3 py-2 text-body" />
            </label>
            <label className="text-label text-fg-muted">Last
              <input type="time" value={plan.lastTime}
                onChange={(event) => onChange({ ...plan, lastTime: event.target.value })}
                className="mt-1 block rounded-sm border border-line bg-bg px-3 py-2 text-body" />
            </label>
          </div>
          {plan.mode === 'interval' ? (
            <div className="flex flex-wrap gap-2">
              {([
                [30, '30 min'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'],
              ] as Array<[ReminderIntervalMinutes, string]>).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={plan.intervalMinutes === value}
                  onClick={() => onChange({ ...plan, intervalMinutes: value })}
                  className="rounded-sm border border-line px-3 py-2 text-label">{label}</button>
              ))}
            </div>
          ) : (
            <label className="block text-label text-fg-muted">Reminder times, separated by commas
              <input value={(plan.customTimes ?? []).join(', ')}
                onChange={(event) => onChange({
                  ...plan,
                  customTimes: event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                })}
                placeholder="09:00, 13:30, 18:00"
                className="mt-1 w-full rounded-sm border border-line bg-bg px-3 py-2 text-body" />
            </label>
          )}
          <p className="text-caption text-fg-muted">Time zone: {plan.timeZone}</p>
          {errors.length === 0 && (
            <p className="text-body text-fg">{times.length} reminder{times.length === 1 ? '' : 's'} per day: {times.join(', ')}</p>
          )}
          {errors.map((error) => <p key={error} className="text-label text-warn">{error}</p>)}
        </div>
      )}
    </div>
  );
}

export function ObservationPlan({
  patientCode,
  regimen,
  onBack,
  onAddMedication,
  onOpenPatient,
}: {
  patientCode: string;
  regimen: RegimenItem[] | undefined;
  onBack: () => void;
  onAddMedication: () => void;
  onOpenPatient: () => void;
}) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nativeStatus, setNativeStatus] = useState<string | null>(null);
  const [reminderPlan, setReminderPlan] = useState(defaultReminderPlan);
  const reminderInitialized = useRef(false);
  const active = useLiveQuery(
    async () => (await getActiveObservationStudy(db, patientCode)) ?? null,
    [patientCode],
  );

  useEffect(() => {
    if (active === undefined || reminderInitialized.current) return;
    reminderInitialized.current = true;
    if (active?.reminderPlan) setReminderPlan({
      ...active.reminderPlan,
      customTimes: active.reminderPlan.customTimes ? [...active.reminderPlan.customTimes] : undefined,
    });
  }, [active]);

  async function changeReminderEnabled(enabled: boolean) {
    if (!enabled) {
      setReminderPlan((plan) => ({ ...plan, enabled: false }));
      setNativeStatus(null);
      return;
    }
    if (!observationRemindersNative.isAvailable()) {
      setError('Android notifications are available only in the Android app.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const status = await observationRemindersNative.requestPermission();
      if (status.permission !== 'granted') {
        setError('Notification permission was not granted. Reminders remain off.');
        return;
      }
      setReminderPlan((plan) => ({ ...plan, enabled: true }));
    } catch {
      setError('Could not request Android notification permission. Reminders remain off.');
    } finally {
      setBusy(false);
    }
  }

  async function start(durationDays: ObservationDurationDays) {
    if (busyRef.current || !regimen) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const startedAt = new Date().toISOString();
      const study = buildObservationStudy({
        id: safeUuid(),
        patient: patientCode,
        durationDays,
        startedAt,
        regimen,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(reminderPlan.enabled ? { reminderPlan } : {}),
      });
      await putObservationStudy(db, study);
      void logEvent('lifecycle', `Started ${durationDays}-day observation study`);
      try {
        const status = await syncObservationReminderStudy(study);
        if (study.reminderPlan?.enabled) setNativeStatus(
          status?.configured && status.permission === 'granted'
            && status.studyId === study.id && status.revision === study.reminderPlan.revision
            ? 'Android reminders are active.'
            : 'The study and reminder plan were saved locally, but Android notifications are not active. Use Save reminder plan to retry.',
        );
      } catch {
        setNativeStatus('The study and reminder plan were saved locally, but Android notifications are not active. Use Save reminder plan to retry.');
      }
    } catch {
      setError('Couldn’t start the observation period. Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function finish(status: 'completed' | 'cancelled') {
    if (!active || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await finishObservationStudy(db, active.id, status, new Date().toISOString());
      void logEvent('lifecycle', `${status === 'completed' ? 'Completed' : 'Cancelled'} observation study`);
      try {
        if (observationRemindersNative.isAvailable()) await observationRemindersNative.cancelStudy(active.id);
        setNativeStatus(null);
      } catch {
        setNativeStatus('The study was closed locally, but Android notifications could not be cancelled. Reopen this screen to retry synchronization.');
      }
    } catch {
      setError(`Couldn’t ${status === 'completed' ? 'complete' : 'cancel'} the observation period. Please try again.`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function saveReminderPlan() {
    if (!active || busyRef.current) return;
    const next = { ...reminderPlan, revision: (active.reminderPlan?.revision ?? 0) + 1 };
    if (next.enabled && validateObservationReminderPlan(next).length > 0) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const updated = { ...active, reminderPlan: next };
      await putObservationStudy(db, updated);
      setReminderPlan(next);
      void logEvent('lifecycle', `${next.enabled ? 'Updated' : 'Disabled'} observation reminders`);
      try {
        const status = await syncObservationReminderStudy(updated);
        setNativeStatus(next.enabled
          ? status?.configured && status.permission === 'granted'
            && status.studyId === updated.id && status.revision === next.revision
            ? 'Android reminders are active.'
            : 'The reminder plan was saved locally, but Android notifications are not active. Use Save reminder plan to retry.'
          : 'Android reminders are off.');
      } catch {
        setNativeStatus('The reminder plan was saved locally, but Android notifications are not in sync. Use Save reminder plan to retry.');
      }
    } catch {
      setError('Couldn’t save the reminder plan locally. Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Do not mistake the first unresolved regimen query for an empty regimen.
  // An already-active study can render from its frozen snapshot, while the
  // setup controls wait until both live queries have resolved.
  if (active === undefined || (active === null && regimen === undefined)) return null;

  const progress = active ? observationProgress(active) : null;
  const availableRegimen = regimen ?? [];
  return (
    <div className="flex flex-col">
      <button type="button" onClick={onBack}
        className="self-start text-label text-fg-muted underline underline-offset-2">Back</button>
      <h1 className="mt-6 text-title font-medium text-fg">Finger tapping setup</h1>
      <p className="mt-2 text-body text-fg-muted">
        Choose a 14- or 28-day study to collect dose, symptom and finger-tapping data for the next consultation.
      </p>
      {error && <p className="mt-4 text-body text-warn" role="alert">{error}</p>}
      {nativeStatus && <p className="mt-4 text-body text-fg" role="status">{nativeStatus}</p>}

      {active && progress ? (
        <div className="mt-6 rounded-md border border-line bg-surface p-4">
          <p className="text-label text-fg-muted">Active study</p>
          <p className="mt-2 text-body-lg font-medium text-fg">Finger tapping is ready</p>
          <p className="mt-2 text-title text-fg">
            Day {progress.dayNumber} of {progress.durationDays}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-soft" aria-hidden="true">
            <div className="h-full bg-accent" style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="mt-3 text-body text-fg-muted">
            Baseline regimen: {active.regimenSnapshot.length} medication
            {active.regimenSnapshot.length === 1 ? '' : 's'}
          </p>
          <div className="mt-4">
            <ReminderPlanEditor plan={reminderPlan} onChange={setReminderPlan} onEnabledChange={(enabled) => void changeReminderEnabled(enabled)} />
            <button type="button" disabled={busy || (reminderPlan.enabled && validateObservationReminderPlan(reminderPlan).length > 0)}
              onClick={() => void saveReminderPlan()}
              className="mt-3 rounded-md border border-line px-4 py-2 text-label disabled:opacity-40">
              Save reminder plan
            </button>
          </div>
          {progress.collectionComplete && (
            <p className="mt-3 text-body text-fg">Collection window complete. Review the evidence before closing it.</p>
          )}
          <div className="mt-6 flex gap-4">
            <button type="button" disabled={busy} onClick={() => void finish('completed')}
              className="rounded-md bg-accent px-4 py-2 text-label text-white disabled:opacity-40">Complete</button>
            <button type="button" disabled={busy} onClick={() => void finish('cancelled')}
              className="text-label text-warn underline underline-offset-2 disabled:opacity-40">Cancel</button>
          </div>
          <button type="button" onClick={onOpenPatient}
            className="mt-4 min-h-[52px] w-full rounded-md border border-line bg-bg text-body-lg text-fg">
            Open patient mode
          </button>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <p className="text-body text-fg">
            Starting freezes a copy of the current regimen so later analysis uses the correct baseline.
          </p>
          {availableRegimen.length === 0 && (
            <div className="rounded-md border border-line p-4">
              <p className="text-body text-warn">Add the prescribed regimen before starting collection.</p>
              <button type="button" onClick={onAddMedication}
                className="mt-3 rounded-md bg-accent px-4 py-2 text-label text-white">
                Add prescribed medication
              </button>
            </div>
          )}
          <ReminderPlanEditor plan={reminderPlan} onChange={setReminderPlan} onEnabledChange={(enabled) => void changeReminderEnabled(enabled)} />
          <button type="button" disabled={availableRegimen.length === 0 || busy} onClick={() => void start(14)}
            className="min-h-[76px] w-full rounded-md bg-accent text-title text-white disabled:opacity-40">
            Start 14-day study
          </button>
          <button type="button" disabled={availableRegimen.length === 0 || busy} onClick={() => void start(28)}
            className="min-h-[76px] w-full rounded-md border border-line bg-surface text-title text-fg disabled:opacity-40">
            Start 28-day study
          </button>
        </div>
      )}
    </div>
  );
}
