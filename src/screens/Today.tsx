// Today — the daily review landing (design doc §8.1, §8.8). When cards are due
// it offers a single "start review" action; when nothing is due it shows the
// calm all-clear (never a nag, never confetti) with an optional door forward.

export function Today({
  dueCount,
  onStartReview,
  onGoMap,
}: {
  dueCount: number;
  onStartReview: () => void;
  onGoMap: () => void;
}) {
  if (dueCount > 0) {
    return (
      <div className="flex h-full flex-col px-4 pt-3">
        <h1 className="text-title font-semibold text-fg">Today</h1>
        <div className="mt-8">
          <p className="text-body-lg text-fg">{dueCount} due for review.</p>
          <p className="mt-1 text-body text-fg-muted">
            A few minutes keeps what you’ve learned from fading.
          </p>
          <button
            type="button"
            onClick={onStartReview}
            className="mt-6 rounded-md bg-accent px-5 py-3 text-body font-medium text-white"
          >
            Start review
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col px-4 pt-3">
      <h1 className="text-title font-semibold text-fg">Today</h1>
      <div className="mt-8">
        <p className="text-body-lg text-fg">Nothing is due for review.</p>
        <p className="mt-1 text-body text-fg-muted">Your retention is current.</p>

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
