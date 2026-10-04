// Copied verbatim from apps/runway/src/ui/Button.tsx — this component is
// generic (no Runway-specific concept leaks into it). A shared `ui` package
// across apps/tide and apps/runway is a future cleanup, not a one-increment
// job; see this app's README for the note.
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

// min-h-12 (48px) everywhere — the touch-target floor. Variants are
// deliberately few: primary (the one action per screen that matters),
// secondary (everything else), danger (destructive). Primary's inverted
// text (dark-on-sky rather than the usual light-on-dark) reads as present
// without shouting the way a bright fill + bright text would.
const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-sky-500 text-slate-950 font-semibold hover:bg-sky-400 active:bg-sky-600',
  secondary: 'border border-slate-700 bg-transparent text-slate-200 hover:bg-slate-800/40',
  danger: 'border border-red-900 bg-red-950/60 text-red-300 hover:bg-red-900/40',
};

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      className={`min-h-12 rounded-lg px-4 py-2 text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  );
}
