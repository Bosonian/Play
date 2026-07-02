// Stats — mastery, streak, weak spots, retention-over-time (design doc §9).
//
// Increment 1 shows the honest empty baseline: bars at zero, not hidden. The
// real charts fill in once there's an attempt log to read (Increment 3+).

export function Stats() {
  return (
    <div className="flex h-full flex-col px-4 pt-3">
      <h1 className="text-title font-semibold text-fg">Stats</h1>

      <div className="mt-8">
        <p className="text-body-lg text-fg">Nothing measured yet.</p>
        <p className="mt-1 text-body text-fg-muted">
          Your first review sets the baseline.
        </p>
      </div>

      <div className="mt-8 space-y-3">
        {['Learned', 'Retained'].map((label) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-16 text-caption text-fg-muted">{label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-soft">
              <div className="h-full w-0 rounded-full bg-accent" />
            </div>
            <span className="w-8 text-right text-caption tabular-nums text-fg-faint">
              0%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
