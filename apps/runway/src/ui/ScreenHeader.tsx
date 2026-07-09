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
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-2xl text-slate-400 hover:text-slate-100"
        >
          ‹
        </button>
      )}
      <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
    </div>
  );
}
