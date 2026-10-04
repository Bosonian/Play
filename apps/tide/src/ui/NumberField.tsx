// Copied verbatim from apps/runway/src/ui/NumberField.tsx. See Button.tsx's
// header comment on the shared-package cleanup this is waiting on. Used by
// WeighInEntry for weight (kg) and body-fat (%) — this integer-only variant
// is a fine fit for kg entered as whole numbers, but WeighInEntry itself
// needs one decimal place for weight (e.g. 98.4 kg), so it uses a plain
// TextField with inputMode="decimal" instead — see that screen's own
// comment. Kept here anyway since it's a generic primitive worth carrying
// over for future integer fields (e.g. steps).
interface NumberFieldProps {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  id?: string;
}

// Separate from TextField (rather than TextField with type="number") because
// the value/onChange contract is number in, number out — callers shouldn't
// have to parseInt() at every call site. Empty-input is coerced to 0 rather
// than left NaN.
export function NumberField({ label, hint, value, onChange, min = 0, id }: NumberFieldProps) {
  const inputId = id ?? `field-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-400">
        {label}
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={min}
        value={value}
        onChange={(e) => {
          const parsed = Number.parseInt(e.target.value, 10);
          onChange(Number.isNaN(parsed) ? 0 : parsed);
        }}
        className="min-h-12 w-24 rounded-lg border border-slate-700 bg-raised px-3 py-2 text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
      />
      {hint && <p className="text-sm text-slate-500">{hint}</p>}
    </div>
  );
}
