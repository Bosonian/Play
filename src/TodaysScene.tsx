import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from './db/db';
import {
  currentDisplay,
  getOrCreateTodayScene,
  recordOutcome,
  rotate,
} from './db/scene';
import { todayISO } from './lib/time';

// Brief §5.1 / §10. The top section of the single-screen app.
// One prop + one scene + three actions (✓ ✗ ↻). On ✓, the brief mandates
// a 2-second "Phone down. Go." overlay before the calm resolved state.
export function TodaysScene() {
  const [overlay, setOverlay] = useState<string | null>(null);

  // Ensure today's row exists. useLiveQuery picks it up reactively.
  useEffect(() => {
    void getOrCreateTodayScene();
  }, []);

  const scene = useLiveQuery(
    () => db.dailyScenes.where('date').equals(todayISO()).first(),
    [],
  );

  // Auto-dismiss the overlay after 2s. Cleanup cancels if the component
  // unmounts mid-overlay.
  useEffect(() => {
    if (!overlay) return;
    const id = window.setTimeout(() => setOverlay(null), 2000);
    return () => window.clearTimeout(id);
  }, [overlay]);

  if (overlay) {
    return (
      <section className="text-base font-semibold italic text-neutral-800">
        {overlay}
      </section>
    );
  }

  if (!scene) {
    // Brief flicker on first paint while the row is created.
    return <section className="text-sm text-neutral-400">…</section>;
  }

  if (scene.outcome === 'done') {
    return (
      <section className="text-sm text-neutral-500">Today&apos;s scene is done.</section>
    );
  }

  if (scene.outcome === 'skipped') {
    return <section className="text-sm text-neutral-500">Skipped today.</section>;
  }

  const { prop, sceneTitle } = currentDisplay(scene);

  return (
    <section className="flex flex-col gap-3">
      <p className="text-base text-neutral-800">
        <span className="text-neutral-500">Today&apos;s prop: </span>
        <span className="font-medium">{prop}</span>
      </p>
      <p className="text-base text-neutral-800">
        <span className="text-neutral-500">Today&apos;s scene: </span>
        <span className="font-medium">{sceneTitle}</span>
      </p>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-neutral-600">
        <button
          type="button"
          onClick={async () => {
            await recordOutcome('done');
            setOverlay('Phone down. Go.');
          }}
          className="hover:text-neutral-900"
        >
          Already did this ✓
        </button>
        <button
          type="button"
          onClick={() => recordOutcome('skipped')}
          className="hover:text-neutral-900"
        >
          Skip today ✗
        </button>
        <button
          type="button"
          onClick={() => rotate()}
          className="hover:text-neutral-900"
        >
          Show me a different one ↻
        </button>
      </div>
    </section>
  );
}
