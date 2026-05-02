import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';
import {
  addProp,
  addScene,
  removeProp,
  removeScene,
  updateReflectionDay,
  updateReflectionTime,
} from './db/settings';
import { resetEverything, resetTasksAndSeeds } from './db/reset';

// Day-of-week ordering: Monday-first per CLAUDE.md, with Sunday at the end.
// Values map to JS Date.getDay() — Sunday=0, Monday=1, etc.
const DAYS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

// Brief §9 step 9. Edit prop/scene seeds, change reflection time, two
// scoped reset buttons (per user decision).
//
// We deliberately don't expose inline edit on the seed titles — add + delete
// covers the same ground for v1, with less UX surface. If editing becomes a
// felt need, lift it in v1.5.
//
// Last-item delete is suppressed: deleting the only prop or only scene
// would leave Today's Scene unable to render. User can Reset to recover the
// defaults if they really want a clean slate.
export function Settings({ onBack }: { onBack: () => void }) {
  const profile = useLiveQuery(() => db.userProfile.toCollection().first());
  const props = useLiveQuery(() => db.propSeeds.toArray(), []);
  const scenes = useLiveQuery(() => db.sceneSeeds.toArray(), []);

  const [newProp, setNewProp] = useState('');
  const [newScene, setNewScene] = useState('');

  async function handleResetSeeds() {
    const ok = window.confirm(
      'Reset tasks, daily scene history, and the prop/scene pools to defaults? Reflections and reflection settings will be kept. This cannot be undone.',
    );
    if (!ok) return;
    await resetTasksAndSeeds();
  }

  async function handleResetEverything() {
    const ok = window.confirm(
      'Wipe ALL data — tasks, daily scenes, props, scenes, AND every reflection you have ever written. Reflection day/time settings will be kept. This cannot be undone.',
    );
    if (!ok) return;
    await resetEverything();
  }

  return (
    <main className="min-h-dvh max-w-xl mx-auto px-6 py-12 text-ink-soft">
      <button
        type="button"
        onClick={onBack}
        className="mb-8 text-sm text-ink-mute hover:text-ink"
      >
        ← back
      </button>

      <div className="flex flex-col gap-12">
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-wide text-ink-fade">
            Reflection
          </h2>
          {profile && (
            <>
              <label className="flex items-center gap-3 text-sm text-ink-mute">
                <span className="w-12">Day</span>
                <select
                  value={profile.reflectionDayOfWeek}
                  onChange={(e) => updateReflectionDay(Number(e.target.value))}
                  className="bg-transparent border-b border-ink-ghost py-1 text-base text-ink focus:border-clay focus:outline-none"
                >
                  {DAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-3 text-sm text-ink-mute">
                <span className="w-12">Time</span>
                <input
                  type="time"
                  value={profile.reflectionTime}
                  onChange={(e) => updateReflectionTime(e.target.value)}
                  className="bg-transparent border-b border-ink-ghost py-1 text-base text-ink focus:border-clay focus:outline-none"
                />
              </label>
            </>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-wide text-ink-fade">
            Props {props ? `(${props.length})` : ''}
          </h2>
          <ul className="flex flex-col gap-1">
            {props?.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 py-1 text-base text-ink"
              >
                <span className="flex-1">{p.title}</span>
                {props.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeProp(p.id)}
                    aria-label={`Remove ${p.title}`}
                    className="text-base text-ink-fade hover:text-clay"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await addProp(newProp);
              setNewProp('');
            }}
          >
            <input
              type="text"
              value={newProp}
              onChange={(e) => setNewProp(e.target.value)}
              placeholder="Add a prop"
              className="w-full bg-transparent border-b border-ink-ghost px-1 py-2 text-base text-ink placeholder:text-ink-fade focus:border-clay focus:outline-none"
              autoCorrect="off"
              spellCheck={false}
            />
          </form>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-wide text-ink-fade">
            Scenes {scenes ? `(${scenes.length})` : ''}
          </h2>
          <ul className="flex flex-col gap-1">
            {scenes?.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 py-1 text-base text-ink"
              >
                <span className="flex-1">{s.title}</span>
                {scenes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeScene(s.id)}
                    aria-label={`Remove ${s.title}`}
                    className="text-base text-ink-fade hover:text-clay"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await addScene(newScene);
              setNewScene('');
            }}
          >
            <input
              type="text"
              value={newScene}
              onChange={(e) => setNewScene(e.target.value)}
              placeholder="Add a scene"
              className="w-full bg-transparent border-b border-ink-ghost px-1 py-2 text-base text-ink placeholder:text-ink-fade focus:border-clay focus:outline-none"
              autoCorrect="off"
              spellCheck={false}
            />
          </form>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-wide text-ink-fade">Data</h2>
          <button
            type="button"
            onClick={handleResetSeeds}
            className="self-start text-sm text-ink-soft hover:text-ink"
          >
            Reset tasks and seeds
          </button>
          <button
            type="button"
            onClick={handleResetEverything}
            className="self-start text-sm text-ink-soft hover:text-ink"
          >
            Reset everything (including reflections)
          </button>
        </section>
      </div>
    </main>
  );
}
