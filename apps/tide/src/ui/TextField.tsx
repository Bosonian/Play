// Copied verbatim from apps/runway/src/ui/TextField.tsx. See Button.tsx's
// header comment on the shared-package cleanup this is waiting on.
import type { InputHTMLAttributes } from 'react';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  /** Class names for the outer wrapper (layout, e.g. `flex-1` in a row of
   * side-by-side fields) — kept separate from `className`, which targets
   * the `<input>` itself, so a caller doing layout doesn't accidentally
   * override the input's own styling. */
  containerClassName?: string;
}

// Labeled text input, min-h-12 touch target. `hint` renders below the input
// for the cases where a label alone would be ambiguous (per CLAUDE.md:
// exact copy over vague copy).
//
// Contrast note (increment 6 polish pass): `text-slate-600` measures ≈2.7:1
// against this app's dark background — below WCAG AA's 4.5:1 floor, and
// below even the large-text floor of 3.0:1. `placeholder:text-slate-500`
// (≈4.2:1) below is the floor for placeholder text specifically; do not
// reintroduce slate-600 for anything meant to be read, here or elsewhere in
// src/ — see tailwind.config.ts's own note on this.
export function TextField({ label, hint, id, className = '', containerClassName = '', ...rest }: TextFieldProps) {
  const inputId = id ?? `field-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className={`flex flex-col gap-1.5 ${containerClassName}`}>
      <label htmlFor={inputId} className="text-sm font-medium text-slate-400">
        {label}
      </label>
      <input
        id={inputId}
        className={`min-h-12 rounded-lg border border-slate-700 bg-raised px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none ${className}`}
        {...rest}
      />
      {hint && <p className="text-sm text-slate-500">{hint}</p>}
    </div>
  );
}
