import type { ButtonHTMLAttributes } from 'react';

// A tappable card — used for template and upcoming-departure rows on Home.
// Rendered as a <button> (not a <div onClick>) so it's keyboard-reachable
// and gets native focus/press styling for free. `surface`/`raised` and the
// 60%-opacity border are the UI-polish increment's fixed card tokens.
export function Card({ className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`min-h-12 w-full rounded-xl border border-slate-800/60 bg-surface p-4 text-left transition-colors hover:border-slate-700 hover:bg-raised/70 active:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${className}`}
      {...rest}
    />
  );
}
