import { useState } from 'react';
import { DRUG_CATALOG, type DrugId } from '../../../domain/drugs';
import {
  PRESCRIBABLE_DRUG_IDS,
  validateRegimenItem,
  sortDoseTimes,
  type DoseTime,
  type RegimenItem,
} from '../../../domain/regimen';

// PHASE A (this form): the new dose-per-time model, but the SAME minimal UI
// as before — one drug, one mg field, N time rows, and the single mg value
// is copied to every time on submit. This form does NOT let a doctor enter
// an uneven regimen (100-100-50) or a strength/free-text line — that's
// Phase B's grid rebuild. Kept this way deliberately (see CLAUDE.md: "make
// incremental changes, not massive rewrites") rather than half-building the
// grid UI here.
export interface RegimenItemDraft {
  drug: DrugId;
  times: DoseTime[];
  strengthMg?: number;
  freeText?: string;
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
  // submit time.
  //
  // JUDGMENT CALL (Phase A limitation, flagged not silently accepted): this
  // form has ONE dose field, so editing an item whose times[] carry DIFFERENT
  // doseMg values (an uneven regimen, or anything with strengthMg/freeText
  // set) can only seed the first time's dose here — saving through this form
  // overwrites the whole item with that single dose copied to every time, and
  // drops strengthMg/freeText. Phase B's grid form is what actually supports
  // editing those shapes; Phase A's minimal form intentionally doesn't try.
  const [doseInput, setDoseInput] = useState<string>(
    initial && initial.times.length > 0 ? String(initial.times[0].doseMg) : '',
  );
  const [times, setTimes] = useState<string[]>(
    initial && initial.times.length > 0 ? initial.times.map((t) => t.time) : [''],
  );
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
    // The one mg value copied to every time — this is the whole Phase A
    // shape trick (§15 step 6): identical UX, new dose-per-time model.
    const draftTimes = sortDoseTimes(filledTimes.map((time) => ({ time, doseMg })));
    const validationErrors = validateRegimenItem({
      times: draftTimes,
      strengthMg: undefined,
      freeText: undefined,
    });
    setErrors(validationErrors);
    if (validationErrors.length > 0) return;

    setSaving(true);
    onSave({ drug, times: draftTimes, strengthMg: undefined, freeText: undefined });
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
