import { DRUG_CATALOG } from '../../domain/types';

// Placeholder for the patient's home screen. Real logging (doses, motor
// state, meals) is the next increment; this just proves the mode is wired up
// and that the domain model import resolves correctly from src/app/.
export function PatientHome() {
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <h1 className="text-title font-medium">Patient</h1>
      <p className="mt-2 text-body text-fg">
        Logging comes in the next increment. Nothing is recorded yet.
      </p>
      <p className="mt-2 text-caption text-fg-muted">
        Tracks {DRUG_CATALOG['levodopa'].generic} doses, motor state, and meals.
      </p>
    </div>
  );
}
