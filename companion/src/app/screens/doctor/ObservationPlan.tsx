import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, finishObservationStudy, getActiveObservationStudy, putObservationStudy } from '../../db/store';
import { buildObservationStudy, observationProgress, type ObservationDurationDays } from '../../../domain/observation';
import type { RegimenItem } from '../../../domain/regimen';
import { safeUuid } from '../../lib/uuid';
import { logEvent } from '../../activity/activityLog';

export function ObservationPlan({
  patientCode,
  regimen,
  onBack,
}: {
  patientCode: string;
  regimen: RegimenItem[];
  onBack: () => void;
}) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useLiveQuery(
    async () => (await getActiveObservationStudy(db, patientCode)) ?? null,
    [patientCode],
  );

  async function start(durationDays: ObservationDurationDays) {
    if (busyRef.current) return;
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
      });
      await putObservationStudy(db, study);
      void logEvent('lifecycle', `Started ${durationDays}-day observation study`);
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
    } catch {
      setError(`Couldn’t ${status === 'completed' ? 'complete' : 'cancel'} the observation period. Please try again.`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (active === undefined) return null;

  const progress = active ? observationProgress(active) : null;
  return (
    <div className="flex flex-col">
      <button type="button" onClick={onBack}
        className="self-start text-label text-fg-muted underline underline-offset-2">Back</button>
      <h1 className="mt-6 text-title font-medium text-fg">Observation period</h1>
      <p className="mt-2 text-body text-fg-muted">
        Collect dose, symptom and assessment data for the next consultation.
      </p>
      {error && <p className="mt-4 text-body text-warn" role="alert">{error}</p>}

      {active && progress ? (
        <div className="mt-6 rounded-md border border-line bg-surface p-4">
          <p className="text-label text-fg-muted">Active study</p>
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
          {progress.collectionComplete && (
            <p className="mt-3 text-body text-fg">Collection window complete. Review the evidence before closing it.</p>
          )}
          <div className="mt-6 flex gap-4">
            <button type="button" disabled={busy} onClick={() => void finish('completed')}
              className="rounded-md bg-accent px-4 py-2 text-label text-white disabled:opacity-40">Complete</button>
            <button type="button" disabled={busy} onClick={() => void finish('cancelled')}
              className="text-label text-warn underline underline-offset-2 disabled:opacity-40">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <p className="text-body text-fg">
            Starting freezes a copy of the current regimen so later analysis uses the correct baseline.
          </p>
          {regimen.length === 0 && (
            <p className="rounded-md border border-line p-4 text-body text-warn">
              Add the prescribed regimen before starting collection.
            </p>
          )}
          <button type="button" disabled={regimen.length === 0 || busy} onClick={() => void start(14)}
            className="min-h-[76px] w-full rounded-md bg-accent text-title text-white disabled:opacity-40">
            Start 14-day study
          </button>
          <button type="button" disabled={regimen.length === 0 || busy} onClick={() => void start(28)}
            className="min-h-[76px] w-full rounded-md border border-line bg-surface text-title text-fg disabled:opacity-40">
            Start 28-day study
          </button>
        </div>
      )}
    </div>
  );
}
