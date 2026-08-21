import type { ButtonHTMLAttributes } from 'react';

// The "Replan from now." class of link (UI-polish increment design system
// doc) — a real action, but a quiet, secondary one that shouldn't compete
// visually with a screen's primary Button. Used everywhere a screen offers
// a text-only tap target that isn't a state-tied prompt (e.g. the amber
// "The plan no longer fits" hint keeps its own amber — that's reporting a
// state, not offering a neutral action) — Home's footer nav, Abandon,
// Replan, Add milestone, Edit, Remove, Retry, and so on. One component, one
// shade of slate, so all of those read as the same weight of action
// regardless of which screen they're on, rather than each screen inventing
// its own slightly different grey.
export function TextAction({ className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-12 items-center rounded-lg px-2 text-sm font-medium text-slate-400 transition-colors hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${className}`}
      {...rest}
    />
  );
}
