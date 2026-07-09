import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

// min-h-11 (44px) everywhere — the spec's touch-target floor. Variants are
// deliberately few: primary (the one action per screen that matters),
// secondary (everything else), danger (destructive, used once for
// "delete template").
const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-sky-500 text-slate-950 hover:bg-sky-400 active:bg-sky-600',
  secondary: 'bg-slate-800 text-slate-100 hover:bg-slate-700 active:bg-slate-900',
  danger: 'bg-red-950 text-red-300 hover:bg-red-900 active:bg-red-950',
};

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      className={`min-h-11 rounded-md px-4 py-2 text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  );
}
