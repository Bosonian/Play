import { useLiveQuery } from 'dexie-react-hooks';
import { db, getActiveObservationStudy } from '../../db/store';
import { observationProgress, type ObservationStudy } from '../../../domain/observation';

export function ObservationStatus({ patientCode, onStart }: {
  patientCode: string; onStart: (study: ObservationStudy) => void;
}) {
  const study = useLiveQuery(
    () => getActiveObservationStudy(db, patientCode),
    [patientCode],
  );

  if (!study) return null;
  const progress = observationProgress(study);
  return (
    <section className="mb-8 rounded-md border border-line bg-surface-soft p-4"
      aria-label="Observation study progress">
      <p className="text-label text-fg-muted">Observation period</p>
      <p className="mt-1 text-body-lg text-fg">
        Day {progress.dayNumber} of {progress.durationDays}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface" aria-hidden="true">
        <div className="h-full bg-accent" style={{ width: `${progress.percent}%` }} />
      </div>
      <p className="mt-3 text-body text-fg-muted">
        Keep logging doses, meals and how you feel.
      </p>
      <button type="button" onClick={() => onStart(study)}
        className="mt-4 min-h-[64px] w-full rounded-md bg-accent text-body-lg font-medium text-white">
        Start finger-tapping check
      </button>
      {progress.collectionComplete && (
        <p className="mt-2 text-body text-fg">Collection complete. Keep logging until your doctor reviews it.</p>
      )}
    </section>
  );
}
