// Copied verbatim from apps/runway/src/ui/TextAction.tsx. See Button.tsx's
// header comment on the shared-package cleanup this is waiting on.
import type { ButtonHTMLAttributes } from 'react';

// A quiet, secondary text-only action that shouldn't compete visually with
// a screen's primary Button — used for footer nav, "Settings", "Edit",
// "Remove", and so on. One component, one shade of slate, so every such
// action reads as the same weight regardless of which screen it's on.
export function TextAction({ className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-12 items-center rounded-lg px-2 text-sm font-medium text-slate-400 transition-colors hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${className}`}
      {...rest}
    />
  );
}
