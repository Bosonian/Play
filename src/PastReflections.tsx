import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import { listReflections } from './db/reflection';

// Brief §5.4: "useful but not loud." Reverse-chronological list of reflections
// that have actual content (skips are filtered out by listReflections). No
// search, no analytics, no "you said X four weeks in a row" — the journal is
// a record, not a judgment.
export function PastReflections({ onBack }: { onBack: () => void }) {
  const reflections = useLiveQuery(() => listReflections(), []);

  return (
    <main className="min-h-dvh max-w-xl mx-auto px-6 py-12 text-neutral-700">
      <button
        type="button"
        onClick={onBack}
        className="mb-8 text-sm text-neutral-500 hover:text-neutral-800"
      >
        ← back
      </button>

      {reflections === undefined ? (
        <p className="text-sm text-neutral-400">…</p>
      ) : reflections.length === 0 ? (
        <p className="text-sm text-neutral-500">No reflections yet.</p>
      ) : (
        <ul className="flex flex-col gap-8">
          {reflections.map((r) => (
            <li key={r.id} className="flex flex-col gap-2">
              <h3 className="text-xs uppercase tracking-wide text-neutral-400">
                Week of {format(new Date(r.weekStartDate), 'd MMM yyyy')}
              </h3>
              {r.didYouPlay && (
                <p className="text-base text-neutral-800">
                  <span className="text-neutral-500">Played: </span>
                  {r.didYouPlay}
                </p>
              )}
              {r.nextWeekScene && (
                <p className="text-base text-neutral-800">
                  <span className="text-neutral-500">Next week: </span>
                  {r.nextWeekScene}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
