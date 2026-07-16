import { useState } from 'react';
import { DRUG_CATALOG, type DrugId } from '../../../domain/drugs';
import { PRESCRIBABLE_DRUG_IDS, validateRegimenItem, type RegimenItem } from '../../../domain/regimen';

export interface RegimenItemDraft {
  drug: DrugId;
  doseMg: number;
  times: string[];
}

interface RegimenItemFormProps {
  initial: RegimenItem | null; // null = add
  onSave: (draft: RegimenItemDraft) => void;
  onCancel: () => void;
}

// Drug-conditional helper caption, load-bearing copy (SPEC RISK #2): the
// combination-product semantics (this app prescribes by levodopa component,
// never the combined tablet strength) are easy for a doctor to get backwards
// on autopilot, so the caption states the conversion explicitly rather than
// leaving it implicit. No entry for drugs where the dose figure needs no
// clarification (its own mg, unambiguous).
function doseHelperCaption(drug: DrugId): string | null {
  switch (drug) {
    case 'levodopa':
      return 'Enter the levodopa component only. Madopar 125 = 100 mg levodopa. The benserazide or carbidopa component is not entered separately.';
    case 'madopar-lt':
      return 'Enter the levodopa component only. Madopar LT 125 = 100 mg levodopa.';
    case 'rotigotine':
      return 'Patch rating in mg per 24 hours.';
    default:
      return null;
  }
}

function doseLabel(drug: DrugId): string {
  return drug === 'levodopa' || drug === 'madopar-lt' ? 'Dose (mg levodopa)' : 'Dose (mg)';
}

const primaryButtonClass =
  'rounded-md bg-accent px-4 py-2 text-label text-white disabled:opacity-60';
const secondaryButtonClass = 'text-label text-fg-muted underline underline-offset-2';

export function RegimenItemForm({ initial, onSave, onCancel }: RegimenItemFormProps) {
  const [drug, setDrug] = useState<DrugId>(initial?.drug ?? PRESCRIBABLE_DRUG_IDS[0]);
  // Kept as a string (not a number) while editing: an <input type="number">
  // has intermediate states ("", "-", "1.") that aren't valid numbers yet but
  // shouldn't be clobbered mid-keystroke. Number(doseInput) is parsed only at
  // submit time (see validateRegimenItem's own doseMg check for what counts
  // as valid: finite and > 0).
  const [doseInput, setDoseInput] = useState<string>(initial ? String(initial.doseMg) : '');
  const [times, setTimes] = useState<string[]>(initial ? [...initial.times] : ['']);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const spec = DRUG_CATALOG[drug];
  const helperCaption = doseHelperCaption(drug);

  function updateTime(index: number, value: string) {
    setTimes((prev) => prev.map((t, i) => (i === index ? value : t)));
  }

  function removeTime(index: number) {
    setTimes((prev) => prev.filter((_, i) => i !== index));
  }

  function addTime() {
    setTimes((prev) => [...prev, '']);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    // "" rows (an added-but-not-yet-filled time input) are dropped before
    // validation — an incomplete <input type="time"> reports "" (SPEC RISK
    // #8), and that shouldn't surface as a confusing "HH:MM" format error
    // when the real problem is just an empty row.
    const filledTimes = times.filter((t) => t !== '');
    const doseMg = Number(doseInput);
    const validationErrors = validateRegimenItem({ doseMg, times: filledTimes });
    setErrors(validationErrors);
    if (validationErrors.length > 0) return;

    setSaving(true);
    onSave({ drug, doseMg, times: filledTimes });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-line bg-surface p-4">
      <h1 className="text-title font-medium">{initial ? 'Edit medication' : 'Add medication'}</h1>

      <div className="mt-4">
        <label htmlFor="regimen-drug" className="block text-label text-fg-muted">
          Drug
        </label>
        <select
          id="regimen-drug"
          value={drug}
          onChange={(e) => setDrug(e.target.value as DrugId)}
          className="mt-1 w-full rounded-sm border border-line bg-bg px-3 py-2 text-body text-fg"
        >
          {PRESCRIBABLE_DRUG_IDS.map((id) => (
            <option key={id} value={id}>
              {DRUG_CATALOG[id].generic}
            </option>
          ))}
        </select>
        <p className="mt-1 text-caption text-fg-muted">Brands: {spec.brands.join(', ')}</p>
      </div>

      <div className="mt-4">
        <label htmlFor="regimen-dose" className="block text-label text-fg-muted">
          {doseLabel(drug)}
        </label>
        <input
          id="regimen-dose"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={doseInput}
          onChange={(e) => setDoseInput(e.target.value)}
          className="mt-1 w-full rounded-sm border border-line bg-bg px-3 py-2 text-body text-fg"
        />
        {helperCaption && <p className="mt-1 text-caption text-fg-muted">{helperCaption}</p>}
      </div>

      <div className="mt-4">
        <span className="block text-label text-fg-muted">Times</span>
        <p className="mt-1 text-caption text-fg-muted">24-hour clock, local time.</p>
        <div className="mt-2 space-y-2">
          {times.map((t, index) => (
            // Index as key: a blank "Add time" row has no value yet to key
            // off, so it has no stable identity of its own beyond position
            // in this in-form list.
            <div key={index} className="flex items-center gap-3">
              <input
                type="time"
                value={t}
                onChange={(e) => updateTime(index, e.target.value)}
                className="rounded-sm border border-line bg-bg px-3 py-2 text-body text-fg"
              />
              {times.length > 1 && (
                <button type="button" onClick={() => removeTime(index)} className={secondaryButtonClass}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addTime} className={`mt-2 ${secondaryButtonClass}`}>
          Add time
        </button>
      </div>

      {errors.length > 0 && (
        <div className="mt-4 space-y-1">
          {errors.map((err) => (
            <p key={err} className="text-label text-warn">
              {err}
            </p>
          ))}
        </div>
      )}

      <div className="mt-6 flex items-center gap-4">
        <button type="submit" disabled={saving} className={primaryButtonClass}>
          Save
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}
