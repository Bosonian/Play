interface ScreenHeaderProps {
  title: string;
  onBack?: () => void;
}

// Shared header for the non-Home screens: a back action (when there's
// somewhere to go back to) plus a title. Kept intentionally plain — no
// breadcrumbs, no icons beyond the back caret — per CLAUDE.md's "calm,
// spare" tone.
export function ScreenHeader({ title, onBack }: ScreenHeaderProps) {
  return (
    <div className="flex items-center gap-3 pb-6">
      {onBack && (
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex min-h-12 min-w-12 items-center justify-center rounded-lg text-2xl text-slate-400 transition-colors hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
        >
          ‹
        </button>
      )}
      <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
    </div>
  );
}
