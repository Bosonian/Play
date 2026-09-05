import { DRUG_CATALOG, isCatalogDrug, medicationName } from '../../../domain/drugs';
import { dailyMg, regimenWarnings, computeRegimenLedd, type RegimenItem } from '../../../domain/regimen';
import { sigLine } from '../../../domain/grid';

interface RegimenListProps {
  patientCode: string;
  items: RegimenItem[]; // pre-sorted by the container (sortRegimenItems)
  lastRemoved: RegimenItem | null;
  onAdd: () => void;
  onEdit: (item: RegimenItem) => void;
  onRemove: (item: RegimenItem) => void;
  onUndoRemove: () => void;
}

export function RegimenList({
  patientCode,
  items,
  lastRemoved,
  onAdd,
  onEdit,
  onRemove,
  onUndoRemove,
}: RegimenListProps) {
  const warnings = regimenWarnings(items);
  // computeLedd is reused unmodified (SPEC RISK #3/#4): regimenDailyDoses
  // expands each item into one entry per clock time first, so computeLedd's
  // own once-per-day dedup for fixed/fraction factors (safinamide,
  // entacapone, opicapone) sees the right shape of input.
  const ledd = computeRegimenLedd(items);
  const hasBaclofen = items.some((item) => item.drug === 'baclofen');
  const excludedNames = ledd.excludedMedicationNames;
  const isPartialLedd = ledd.isPartial;

  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <h1 className="text-title font-medium">Prescribed regimen</h1>
      <p className="mt-1 text-caption text-fg-muted">Patient {patientCode}</p>

      {items.length === 0 ? (
        <p className="mt-4 text-body text-fg-muted">No medications in the regimen yet.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {items.map((item) => {
            const name = medicationName(item);
            const isPatch = isCatalogDrug(item.drug) && DRUG_CATALOG[item.drug].formulation === 'transdermal-patch';
            const isFreeText = (item.freeText ?? '').trim().length > 0;
            return (
              <div key={item.id} className="rounded-sm bg-surface-soft p-3">
                <p className="text-body font-medium text-fg">{name}</p>
                {item.drug === 'custom' && (
                  <p className="text-caption text-fg-muted">{item.customFormulation}</p>
                )}
                <p className="text-label text-fg-muted">{sigLine(item)}</p>
                {!isPatch && !isFreeText && (
                  <p className="text-caption text-fg-muted">{dailyMg(item)} mg/day</p>
                )}
                {isFreeText && (
                  <p className="text-caption text-fg-muted">Not in LEDD or the patient's dose list.</p>
                )}
                <div className="mt-2 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => onEdit(item)}
                    className="text-label text-fg-muted underline underline-offset-2"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(item)}
                    className="text-label text-warn underline underline-offset-2"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lastRemoved && (
        <div className="mt-4 flex items-center gap-4">
          <p className="text-label text-fg-muted">Removed {medicationName(lastRemoved)}.</p>
          <button
            type="button"
            onClick={onUndoRemove}
            className="text-label text-accent underline underline-offset-2"
          >
            Undo
          </button>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-4 space-y-1">
          {warnings.map((warning) => (
            <p key={warning} className="text-label text-warn">
              {warning}
            </p>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-4">
          <p className="text-body-lg font-medium text-fg">
            {isPartialLedd ? 'Partial LEDD subtotal' : 'Total LEDD'}: {Math.round(ledd.totalMg)} mg/day
          </p>
          <p className="text-caption text-fg-muted">
            Levodopa-equivalent daily dose, calculated from the regimen with standard conversion
            factors. A comparison number, not a target.
          </p>
          {hasBaclofen && (
            <p className="text-caption text-fg-muted">Baclofen is excluded from the LEDD total.</p>
          )}
          {isPartialLedd && (
            <p className="text-caption text-fg-muted">
              Excludes medicine{excludedNames.length === 1 ? '' : 's'} without a computable schedule or
              catalog LEDD factor: {excludedNames.join(', ')}.
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onAdd}
        className="mt-6 rounded-md bg-accent px-4 py-2 text-label text-white"
      >
        Add medication
      </button>
    </div>
  );
}
