import type { ButtonHTMLAttributes } from 'react';

// A tappable card — used for template and upcoming-departure rows on Home.
// Rendered as a <button> (not a <div onClick>) so it's keyboard-reachable
// and gets native focus/press styling for free.
export function Card({ className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`min-h-11 w-full rounded-md border border-slate-800 bg-slate-900 px-4 py-3 text-left transition-colors hover:border-slate-700 hover:bg-slate-800/60 active:bg-slate-800 ${className}`}
      {...rest}
    />
  );
}
