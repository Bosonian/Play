import type { DrugId } from '../../../domain/drugs';
import { doseLabel } from '../../patient/doses';

interface DoseProps {
  choices: Array<{ drug: DrugId; doseMg: number }>;
  onLog: (choice: { drug: DrugId; doseMg: number }) => void;
  onBack: () => void;
}

// Same slab styling as State.tsx/Meal.tsx (RESEARCH §1 groups these as the
// same slab-picker pattern) — presentational only, no DB imports.
const slabClass = 'w-full rounded-md border border-line bg-surface px-4 py-6 min-h-[88px] text-left';

// Extra/rescue-dose picker: one slab per distinct (drug, doseMg) already in
// the regimen. HONEST LIMITATION (flagged in the spec, not silently dropped):
// a drug not in the regimen cannot be logged this way in v1 — that would need
// a drug picker + typed dose entry, which is exactly the typing-in-the-core-
// loop anti-pattern RESEARCH §1 rules out for a population that may be
// mid-OFF while trying to log. So the extra-dose path is deliberately
// narrower than "log anything" — it only covers "an extra one of what I
// already take."
export function Dose({ choices, onLog, onBack }: DoseProps) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="self-start py-3 pr-3 text-label text-fg-muted underline underline-offset-2"
      >
        Back
      </button>
      <h1 className="text-title text-fg">Log another dose</h1>
      <p className="mt-2 text-body text-fg-muted">
        For an extra dose outside the schedule. The time is recorded as now.
      </p>
      <div className="mt-8 space-y-8">
        {choices.length === 0 ? (
          // Unreachable in practice — Home hides this screen's entry point
          // when the regimen is empty (see PatientRoot's onLogAnotherDose
          // wiring) — but a defensive empty state costs nothing and avoids a
          // blank screen if this is ever reached some other way.
          <p className="text-body text-fg-muted">No medications set up yet.</p>
        ) : (
          choices.map((choice) => (
            <button
              key={`${choice.drug}-${choice.doseMg}`}
              type="button"
              onClick={() => onLog(choice)}
              className={slabClass}
            >
              <span className="block text-title font-medium text-fg">{doseLabel(choice.drug, choice.doseMg)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
