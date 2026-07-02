// Today — the daily review landing (design doc §8.1, §8.8).
//
// In Increment 1 there are no SRS cards yet, so this always shows the
// "nothing due" state: calm, factual, an optional door forward — never a nag,
// never confetti. The daily Case-of-the-Day cold-open and the due queue arrive
// with the SRS engine (Increment 3).

export function Today({ onGoMap }: { onGoMap: () => void }) {
  return (
    <div className="flex h-full flex-col px-4 pt-3">
      <h1 className="text-title font-semibold text-fg">Today</h1>

      <div className="mt-8">
        <p className="text-body-lg text-fg">Nothing is due for review.</p>
        <p className="mt-1 text-body text-fg-muted">
          Your retention is current.
        </p>

        <div className="mt-8">
          <p className="text-caption font-medium uppercase tracking-wide text-fg-faint">
            If you want to go on
          </p>
          <button
            type="button"
            onClick={onGoMap}
            className="mt-2 flex w-full items-center justify-between rounded-md border border-line bg-surface px-4 py-3 text-left"
          >
            <span className="text-body text-fg">Open the map</span>
            <span className="text-caption text-fg-faint">choose a region</span>
          </button>
        </div>
      </div>
    </div>
  );
}
