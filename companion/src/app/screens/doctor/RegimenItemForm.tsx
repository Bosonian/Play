import { useState } from 'react';
import { DRUG_CATALOG, type DrugId } from '../../../domain/drugs';
import {
  PRESCRIBABLE_DRUG_IDS,
  COMMON_STRENGTHS_MG,
  validateRegimenItem,
  sortDoseTimes,
  type DoseTime,
  type RegimenItem,
} from '../../../domain/regimen';
import {
  SLOT_DEFS,
  FREQUENCY_PRESETS,
  gridToTimes,
  itemToGrid,
  applyPreset,
  sigLine,
  type SlotId,
  type GridState,
  type GridSlot,
  type FrequencyPreset,
} from '../../../domain/grid';
import { parseQuantity, formatQuantity } from '../../../domain/quantity';

// PHASE B: the German 1-1-1-1 grid CPOE form. Replaces Phase A's minimal
// one-dose-field form with three schedule shapes (grid / custom times list /
// free text) plus a dedicated patch mode, all thin UI over grid.ts and
// quantity.ts — see those files for the actual mapping/parsing rules. This
// file's job is state plumbing and layout only; it does not reimplement any
// domain math.
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

// Drug-conditional helper caption, load-bearing copy (SPEC RISK #2, carried
// over verbatim from Phase A): the combination-product semantics (this app
// prescribes by levodopa component, never the combined tablet strength) are
// easy for a doctor to get backwards on autopilot, so the caption states the
// conversion explicitly. Also doubles as the patch-mode caption (rotigotine
// is the only patch drug, so isPatch implies this branch).
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

const primaryButtonClass =
  'rounded-md bg-accent px-4 py-2 text-label text-white disabled:opacity-60';
const secondaryButtonClass = 'text-label text-fg-muted underline underline-offset-2';

// Chip = a tap-target shortcut that fills a text field (strength presets,
// frequency presets). It never OWNS the value — the field itself is always
// the source of truth, so a chip tap is just "setState to this string."
function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-sm border border-accent bg-accent px-3 py-1 text-label text-white'
          : 'rounded-sm border border-line bg-bg px-3 py-1 text-label text-fg'
      }
    >
      {label}
    </button>
  );
}

const DEFAULT_GRID_TIMES: Record<SlotId, string> = Object.fromEntries(
  SLOT_DEFS.map((def) => [def.id, def.defaultTime]),
) as Record<SlotId, string>;

const EMPTY_GRID_QTY_INPUTS: Record<SlotId, string> = Object.fromEntries(
  SLOT_DEFS.map((def) => [def.id, '']),
) as Record<SlotId, string>;

// mg-mode display never goes through formatQuantity (that function's ¼/½/¾
// notation is a TABLET convention — a plain mg value like 62.5 should read
// "62.5", not "62½"). qty===0 renders as '' so the input shows its '0'
// placeholder rather than a misleading literal zero.
function displayQty(qty: number, tabletMode: boolean): string {
  if (qty === 0) return '';
  return tabletMode ? formatQuantity(qty) : String(qty);
}

// One-time (mount-only) derivation of every piece of editable state from the
// `initial` item, per the form's mode-selection rules (see the class doc
// comment above and the CLAUDE-facing spec this was built from). Kept as a
// standalone function — called once from a useState lazy initializer — so
// the mode logic is readable in one place instead of scattered across many
// individual useState(() => ...) calls that would each recompute it.
function computeInitialFormState(initial: RegimenItem | null) {
  const drug = initial?.drug ?? PRESCRIBABLE_DRUG_IDS[0];
  const isPatchInit = DRUG_CATALOG[drug].formulation === 'transdermal-patch';
  const hasFreeTextInit = (initial?.freeText ?? '').trim().length > 0;

  let scheduleMode: 'grid' | 'custom' = 'grid';
  let gridStrengthInput = '';
  let gridQtyInputs: Record<SlotId, string> = { ...EMPTY_GRID_QTY_INPUTS };
  let gridTimes: Record<SlotId, string> = { ...DEFAULT_GRID_TIMES };
  let customRows: Array<{ time: string; doseInput: string }> = [{ time: '', doseInput: '' }];
  let openedAsCustomFallback = false;
  let strengthDroppedNotice = false;
  let patchStrengthInput = '';
  let patchTime = '08:00';

  if (initial && isPatchInit) {
    patchStrengthInput = initial.times[0] ? String(initial.times[0].doseMg) : '';
    patchTime = initial.times[0]?.time ?? '08:00';
  } else if (initial && !hasFreeTextInit) {
    const mapping = itemToGrid(initial);
    if (mapping.kind === 'grid') {
      const { grid } = mapping;
      const tabletMode = grid.strengthMg !== null;
      gridStrengthInput = tabletMode ? String(grid.strengthMg) : '';
      gridQtyInputs = Object.fromEntries(
        SLOT_DEFS.map((def) => [def.id, displayQty(grid.slots[def.id].qty, tabletMode)]),
      ) as Record<SlotId, string>;
      gridTimes = Object.fromEntries(
        SLOT_DEFS.map((def) => [def.id, grid.slots[def.id].time]),
      ) as Record<SlotId, string>;
      // itemToGrid's Rule 3: a stored strength that no longer evenly divides
      // the doses is discarded in favour of mg mode rather than shown wrong.
      strengthDroppedNotice = initial.strengthMg !== undefined && grid.strengthMg === null;
    } else {
      scheduleMode = 'custom';
      openedAsCustomFallback = true;
      customRows =
        initial.times.length > 0
          ? initial.times.map((t) => ({ time: t.time, doseInput: String(t.doseMg) }))
          : [{ time: '', doseInput: '' }];
    }
  }

  return {
    drug,
    freeTextMode: hasFreeTextInit,
    freeTextValue: initial?.freeText ?? '',
    scheduleMode,
    gridStrengthInput,
    gridQtyInputs,
    gridTimes,
    customRows,
    openedAsCustomFallback,
    strengthDroppedNotice,
    patchStrengthInput,
    patchTime,
  };
}

// CORRECTION (orchestrator, over the original spec): parseQuantity's >20 cap
// is a TABLET-count fat-finger guard — it does not apply here. The grid's mg
// mode holds a millgram value directly (100, 137, ...), which routinely
// exceeds 20 for real levodopa doses. mg-mode cells go through this parser
// instead: no fraction grammar (mg doses aren't written as fractions), no
// upper cap, blank/zero means "not taken" (same convention parseQuantity
// itself uses for its own '0' case).
function parseMgQuantity(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  const n = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

type BuildResult =
  | { ok: true; times: DoseTime[]; strengthMg?: number; freeText?: string }
  | { ok: false; error: string };

export function RegimenItemForm({ initial, onSave, onCancel }: RegimenItemFormProps) {
  const [initialState] = useState(() => computeInitialFormState(initial));

  const [drug, setDrug] = useState<DrugId>(initialState.drug);
  const [freeTextMode, setFreeTextMode] = useState<boolean>(initialState.freeTextMode);
  const [freeTextValue, setFreeTextValue] = useState<string>(initialState.freeTextValue);
  const [scheduleMode, setScheduleMode] = useState<'grid' | 'custom'>(initialState.scheduleMode);
  const [gridStrengthInput, setGridStrengthInput] = useState<string>(initialState.gridStrengthInput);
  const [gridQtyInputs, setGridQtyInputs] = useState<Record<SlotId, string>>(initialState.gridQtyInputs);
  const [gridTimes, setGridTimes] = useState<Record<SlotId, string>>(initialState.gridTimes);
  const [customRows, setCustomRows] = useState<Array<{ time: string; doseInput: string }>>(
    initialState.customRows,
  );
  const [customFitNotice, setCustomFitNotice] = useState<string | null>(null);
  const [patchStrengthInput, setPatchStrengthInput] = useState<string>(initialState.patchStrengthInput);
  const [patchTime, setPatchTime] = useState<string>(initialState.patchTime);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Static (mount-time) flags — these describe how the doctor got here, not
  // the live draft, so they don't need to be state.
  const openedAsCustomFallback = initialState.openedAsCustomFallback;
  const strengthDroppedNotice = initialState.strengthDroppedNotice;

  const spec = DRUG_CATALOG[drug];
  const isPatch = spec.formulation === 'transdermal-patch';

  function handleDrugChange(nextDrug: DrugId) {
    const wasPatch = DRUG_CATALOG[drug].formulation === 'transdermal-patch';
    const willBePatch = DRUG_CATALOG[nextDrug].formulation === 'transdermal-patch';
    setDrug(nextDrug);
    if (wasPatch !== willBePatch) {
      // Crossing the patch/pill boundary changes the whole SHAPE of the
      // schedule section (one daily patch time vs. a 4-slot grid) — a
      // half-filled draft from the other shape isn't meaningful here, so
      // reset to that mode's defaults rather than carry over stale state.
      setFreeTextMode(false);
      setScheduleMode('grid');
      setPatchStrengthInput('');
      setPatchTime('08:00');
      setGridStrengthInput('');
      setGridQtyInputs({ ...EMPTY_GRID_QTY_INPUTS });
      setGridTimes({ ...DEFAULT_GRID_TIMES });
      setCustomRows([{ time: '', doseInput: '' }]);
      setCustomFitNotice(null);
      setFreeTextValue('');
    }
  }

  function updateGridQty(id: SlotId, value: string) {
    setGridQtyInputs((prev) => ({ ...prev, [id]: value }));
  }
  function updateGridTime(id: SlotId, value: string) {
    setGridTimes((prev) => ({ ...prev, [id]: value }));
  }

  function applyPresetToGrid(preset: FrequencyPreset) {
    const tabletMode = gridStrengthInput.trim() !== '';
    const strengthMg = tabletMode ? Number(gridStrengthInput.trim().replace(',', '.')) : null;
    // applyPreset only reads each slot's .time (qty is fully replaced by the
    // preset), so the qty placeholders here are never read back.
    const slots = {} as Record<SlotId, GridSlot>;
    for (const def of SLOT_DEFS) {
      slots[def.id] = { qty: 0, time: gridTimes[def.id] };
    }
    const result = applyPreset({ strengthMg, slots }, preset);
    setGridQtyInputs(
      Object.fromEntries(
        SLOT_DEFS.map((def) => [def.id, displayQty(result.slots[def.id].qty, tabletMode)]),
      ) as Record<SlotId, string>,
    );
  }

  function updateCustomTime(index: number, value: string) {
    setCustomRows((prev) => prev.map((row, i) => (i === index ? { ...row, time: value } : row)));
    setCustomFitNotice(null);
  }
  function updateCustomDose(index: number, value: string) {
    setCustomRows((prev) => prev.map((row, i) => (i === index ? { ...row, doseInput: value } : row)));
    setCustomFitNotice(null);
  }
  function removeCustomRow(index: number) {
    setCustomRows((prev) => prev.filter((_, i) => i !== index));
    setCustomFitNotice(null);
  }
  function addCustomRow() {
    setCustomRows((prev) => [...prev, { time: '', doseInput: '' }]);
    setCustomFitNotice(null);
  }

  function switchToCustomFromGrid() {
    const build = buildGridDraft();
    if (build.ok && build.times.length > 0) {
      setCustomRows(build.times.map((t) => ({ time: t.time, doseInput: String(t.doseMg) })));
    }
    setCustomFitNotice(null);
    setScheduleMode('custom');
  }

  function tryUseGrid() {
    const filled = customRows.filter((row) => row.time !== '');
    const times: DoseTime[] = filled.map((row) => ({
      time: row.time,
      doseMg: Number(row.doseInput.trim().replace(',', '.')),
    }));
    const mapping = itemToGrid({ times, strengthMg: undefined });
    if (mapping.kind === 'custom') {
      setCustomFitNotice('These times do not fit the 4-slot grid.');
      return;
    }
    const { grid } = mapping; // always mg mode here — custom rows carry no strength
    setGridStrengthInput('');
    setGridQtyInputs(
      Object.fromEntries(
        SLOT_DEFS.map((def) => [def.id, displayQty(grid.slots[def.id].qty, false)]),
      ) as Record<SlotId, string>,
    );
    setGridTimes(
      Object.fromEntries(SLOT_DEFS.map((def) => [def.id, grid.slots[def.id].time])) as Record<
        SlotId,
        string
      >,
    );
    setCustomFitNotice(null);
    setScheduleMode('grid');
  }

  // --- Draft builders --------------------------------------------------
  // Each mode's builder either returns the DoseTime[]/strengthMg/freeText it
  // would submit, or a client-side parse error (distinct from the DOMAIN
  // errors validateRegimenItem produces — those only ever see numbers, never
  // raw strings, so an unparseable grid cell has to be caught here first).
  // Shared by both the live Sig preview and the submit handler so the two
  // can never disagree about what the current draft "is".

  function buildPatchDraft(): BuildResult {
    const trimmed = patchStrengthInput.trim();
    // Left as NaN when unparseable (not caught here): validateRegimenItem's
    // own doseMg>0 check already produces the right domain error for that,
    // so there's no need for a second, redundant client-side message.
    const doseMg = trimmed === '' ? NaN : Number(trimmed.replace(',', '.'));
    return { ok: true, times: [{ time: patchTime, doseMg }] };
  }

  function buildGridDraft(): BuildResult {
    const tabletMode = gridStrengthInput.trim() !== '';
    const slots = {} as Record<SlotId, GridSlot>;
    for (const def of SLOT_DEFS) {
      const raw = gridQtyInputs[def.id];
      const parsed = tabletMode ? parseQuantity(raw) : parseMgQuantity(raw);
      if (parsed === null) {
        return { ok: false, error: 'Enter quantities as numbers or fractions (e.g. ½, 1, 1½).' };
      }
      slots[def.id] = { qty: parsed, time: gridTimes[def.id] };
    }
    // Left as NaN when tabletMode but unparseable, same reasoning as the
    // patch builder above: validateRegimenItem's strengthMg>0 check produces
    // 'Enter a strength greater than 0.' for that case without our help.
    const strengthMg = tabletMode ? Number(gridStrengthInput.trim().replace(',', '.')) : null;
    const grid: GridState = { strengthMg, slots };
    return { ok: true, times: gridToTimes(grid), strengthMg: tabletMode ? strengthMg! : undefined };
  }

  function buildCustomDraft(): BuildResult {
    // A blank row (never given a time) is dropped rather than validated —
    // same convention as Phase A's "Add time" rows (SPEC RISK #8): an
    // incomplete <input type="time"> reports "", and that's a non-entry, not
    // a formatting error.
    const filled = customRows.filter((row) => row.time !== '');
    const times = filled.map((row) => ({
      time: row.time,
      doseMg: Number(row.doseInput.trim().replace(',', '.')), // '' -> 0, caught by validateRegimenItem's dose>0 check
    }));
    return { ok: true, times, strengthMg: undefined };
  }

  function buildFreeTextDraft(): BuildResult {
    const trimmed = freeTextValue.trim();
    if (trimmed === '') {
      return { ok: false, error: 'Enter the schedule as free text, or switch back to the grid.' };
    }
    return { ok: true, times: [], freeText: trimmed };
  }

  function currentBuild(): BuildResult {
    if (isPatch) return buildPatchDraft();
    if (freeTextMode) return buildFreeTextDraft();
    return scheduleMode === 'grid' ? buildGridDraft() : buildCustomDraft();
  }

  // Live Sig preview — recomputed every render (all inputs are cheap, pure
  // functions; no need to memoize a form this small). Only rendered when the
  // draft is fully domain-valid, per spec: a half-typed dose shouldn't flash
  // a misleading preview line.
  const liveBuild = currentBuild();
  let previewLine: string | null = null;
  if (liveBuild.ok) {
    const draftItem = { drug, times: liveBuild.times, strengthMg: liveBuild.strengthMg, freeText: liveBuild.freeText };
    if (validateRegimenItem(draftItem).length === 0) {
      previewLine = sigLine(draftItem);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    const build = currentBuild();
    if (!build.ok) {
      setErrors([build.error]);
      return;
    }
    const draftItem = { drug, times: build.times, strengthMg: build.strengthMg, freeText: build.freeText };
    const validationErrors = validateRegimenItem(draftItem);
    setErrors(validationErrors);
    if (validationErrors.length > 0) return;

    setSaving(true);
    onSave({ drug, times: sortDoseTimes(build.times), strengthMg: build.strengthMg, freeText: build.freeText });
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
          onChange={(e) => handleDrugChange(e.target.value as DrugId)}
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

      {isPatch && (
        <div className="mt-4">
          <label htmlFor="regimen-patch-strength" className="block text-label text-fg-muted">
            Dose (mg/24h)
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {(COMMON_STRENGTHS_MG.rotigotine ?? []).map((n) => (
              <Chip
                key={n}
                label={String(n)}
                active={patchStrengthInput.trim() === String(n)}
                onClick={() => setPatchStrengthInput(String(n))}
              />
            ))}
            <input
              id="regimen-patch-strength"
              type="text"
              inputMode="decimal"
              value={patchStrengthInput}
              onChange={(e) => setPatchStrengthInput(e.target.value)}
              className="w-24 rounded-sm border border-line bg-bg px-3 py-2 text-body text-fg"
            />
          </div>
          {doseHelperCaption(drug) && (
            <p className="mt-1 text-caption text-fg-muted">{doseHelperCaption(drug)}</p>
          )}

          <label htmlFor="regimen-patch-time" className="mt-4 block text-label text-fg-muted">
            Application time
          </label>
          <input
            id="regimen-patch-time"
            type="time"
            value={patchTime}
            onChange={(e) => setPatchTime(e.target.value)}
            className="mt-1 rounded-sm border border-line bg-bg px-3 py-2 text-body text-fg"
          />
          <p className="mt-2 text-caption text-fg-muted">
            Patch: applied once daily at the same time. Rotate the application site.
          </p>
        </div>
      )}

      {!isPatch && !freeTextMode && scheduleMode === 'grid' && (
        <div className="mt-4">
          <label htmlFor="regimen-strength" className="block text-label text-fg-muted">
            Strength per tablet (mg)
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {(COMMON_STRENGTHS_MG[drug] ?? []).map((n) => (
              <Chip
                key={n}
                label={String(n)}
                active={gridStrengthInput.trim() === String(n)}
                onClick={() => setGridStrengthInput(String(n))}
              />
            ))}
            <input
              id="regimen-strength"
              type="text"
              inputMode="decimal"
              value={gridStrengthInput}
              onChange={(e) => setGridStrengthInput(e.target.value)}
              className="w-24 rounded-sm border border-line bg-bg px-3 py-2 text-body text-fg"
            />
          </div>
          {doseHelperCaption(drug) && (
            <p className="mt-1 text-caption text-fg-muted">{doseHelperCaption(drug)}</p>
          )}
          {gridStrengthInput.trim() === '' && (
            <p className="mt-1 text-caption text-fg-muted">No strength set — enter doses in mg per intake.</p>
          )}
          {strengthDroppedNotice && (
            <p className="mt-1 text-caption text-warn">
              Stored strength does not divide these doses; editing in mg.
            </p>
          )}

          <p className="mt-4 text-label text-fg-muted">Schema</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {FREQUENCY_PRESETS.map((preset) => (
              <Chip key={preset.id} label={preset.label} onClick={() => applyPresetToGrid(preset)} />
            ))}
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2">
            {SLOT_DEFS.map((def) => (
              <div key={def.id}>
                <p className="text-label text-fg">{def.label}</p>
                <p className="text-caption text-fg-muted">{def.helper}</p>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  aria-label={`${def.label} quantity`}
                  value={gridQtyInputs[def.id]}
                  onChange={(e) => updateGridQty(def.id, e.target.value)}
                  className="mt-1 w-full rounded-sm border border-line bg-bg px-2 py-1 text-body text-fg"
                />
                <input
                  type="time"
                  aria-label={`${def.label} time`}
                  value={gridTimes[def.id]}
                  onChange={(e) => updateGridTime(def.id, e.target.value)}
                  className="mt-1 w-full rounded-sm border border-line bg-bg px-2 py-1 text-body text-fg"
                />
              </div>
            ))}
          </div>
          <p className="mt-1 text-caption text-fg-muted">
            {gridStrengthInput.trim() === ''
              ? 'Dose per intake, in mg.'
              : `Quantity per intake, in tablets of ${gridStrengthInput.trim()} mg. Fractions: ½, ¼, 1½ or 0,5.`}
          </p>

          <button type="button" onClick={switchToCustomFromGrid} className={`mt-2 ${secondaryButtonClass}`}>
            Edit as a list of times
          </button>
        </div>
      )}

      {!isPatch && !freeTextMode && scheduleMode === 'custom' && (
        <div className="mt-4">
          {openedAsCustomFallback && (
            <p className="text-label text-warn">
              This schedule does not fit the 4-slot grid; editing as a list of times.
            </p>
          )}
          <div className="mt-2 space-y-2">
            {customRows.map((row, index) => (
              // Index as key: a blank added row has no value yet to key off,
              // same convention as Phase A's time rows.
              <div key={index} className="flex items-center gap-3">
                <input
                  type="time"
                  value={row.time}
                  onChange={(e) => updateCustomTime(index, e.target.value)}
                  className="rounded-sm border border-line bg-bg px-3 py-2 text-body text-fg"
                />
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Dose (mg)"
                  value={row.doseInput}
                  onChange={(e) => updateCustomDose(index, e.target.value)}
                  className="w-28 rounded-sm border border-line bg-bg px-3 py-2 text-body text-fg"
                />
                {customRows.length > 1 && (
                  <button type="button" onClick={() => removeCustomRow(index)} className={secondaryButtonClass}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={addCustomRow} className={`mt-2 ${secondaryButtonClass}`}>
            Add time
          </button>
          <div className="mt-2">
            <button type="button" onClick={tryUseGrid} className={secondaryButtonClass}>
              Use the grid
            </button>
            {customFitNotice && <p className="mt-1 text-caption text-warn">{customFitNotice}</p>}
          </div>
        </div>
      )}

      {!isPatch && freeTextMode && (
        <div className="mt-4">
          <label htmlFor="regimen-freetext" className="block text-label text-fg-muted">
            Schedule as free text
          </label>
          <textarea
            id="regimen-freetext"
            value={freeTextValue}
            onChange={(e) => setFreeTextValue(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-sm border border-line bg-bg px-3 py-2 text-body text-fg"
          />
          <p className="mt-1 text-caption text-fg-muted">
            Free-text lines are not included in the LEDD total and do not appear in the patient's dose list.
          </p>
        </div>
      )}

      {!isPatch && (
        <button
          type="button"
          onClick={() => setFreeTextMode((prev) => !prev)}
          className={`mt-4 ${secondaryButtonClass}`}
        >
          {freeTextMode ? 'Use the schedule grid instead' : 'Enter as free text instead'}
        </button>
      )}

      {previewLine && (
        <div className="mt-4 rounded-sm border border-line bg-surface-soft p-3">
          <p className="text-body text-fg">{previewLine}</p>
          <p className="mt-1 text-caption text-fg-muted">Check this line before saving.</p>
        </div>
      )}

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
