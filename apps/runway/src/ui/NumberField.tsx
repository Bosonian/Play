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
// than left NaN, since every numeric field in this app (minutes) is
// meaningless as NaN and callers can rely on always getting a number back.
export function NumberField({ label, hint, value, onChange, min = 0, id }: NumberFieldProps) {
  const inputId = id ?? `field-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-300">
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
        className="min-h-11 w-24 rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
      />
      {hint && <p className="text-sm text-slate-500">{hint}</p>}
    </div>
  );
}
