// Copied verbatim from apps/runway/src/ui/Card.tsx — generic, no
// Runway-specific concept in it. See Button.tsx's header comment on the
// shared-package cleanup this and the other copied primitives are waiting
// on.
import type { ButtonHTMLAttributes } from 'react';

// A tappable card — used for list rows (e.g. a weigh-in entry on History).
// Rendered as a <button> (not a <div onClick>) so it's keyboard-reachable
// and gets native focus/press styling for free.
export function Card({ className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`min-h-12 w-full rounded-xl border border-slate-800/60 bg-surface p-4 text-left transition-colors hover:border-slate-700 hover:bg-raised/70 active:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${className}`}
      {...rest}
    />
  );
}
