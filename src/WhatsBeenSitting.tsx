import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  dropTask,
  listSurfaced,
  markTaskDone,
  snoozeTask,
  SNOOZE_CAP,
} from './db/task';
import { ReframeFlow } from './ReframeFlow';
import type { Task } from './db/types';

// Brief §5.3 / §9 step 5. Bottom section. Up to 3 pending tasks aged 3+ days.
// Returns null when nothing qualifies — no empty-state message per §10.
//
// Two view states share the section: list of surfaced tasks, OR the reframe
// flow for one task. Plus the transient overlay after Done / reframe-pick.
export function WhatsBeenSitting() {
  const [overlay, setOverlay] = useState<string | null>(null);
  const [reframingId, setReframingId] = useState<string | null>(null);
  const tasks = useLiveQuery(() => listSurfaced(), []);

  // 2-second auto-dismiss for the overlay (brief §10).
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

  if (!tasks || tasks.length === 0) return null;

  if (reframingId) {
    const task = tasks.find((t) => t.id === reframingId);
    if (!task) {
      // Task vanished from the surface (e.g. another tab dropped it).
      // Bail back to list view — live-query update will re-render.
      setReframingId(null);
      return null;
    }
    return (
      <ReframeFlow
        task={task}
        onChose={() => {
          setReframingId(null);
          setOverlay('Now close this and go.');
        }}
        onDropped={() => setReframingId(null)}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xs uppercase tracking-wide text-neutral-400">
        What&apos;s been sitting
      </h2>
      <ul className="flex flex-col gap-6">
        {tasks.map((t) => (
          <SurfacedItem
            key={t.id}
            task={t}
            onDone={async () => {
              await markTaskDone(t.id);
              setOverlay('Done. Close the app.');
            }}
            onDrop={() => dropTask(t.id)}
            onReframe={() => setReframingId(t.id)}
            onSnooze={() => snoozeTask(t.id)}
          />
        ))}
      </ul>
    </section>
  );
}

interface ItemProps {
  task: Task;
  onDone: () => void | Promise<void>;
  onDrop: () => void | Promise<void>;
  onReframe: () => void;
  onSnooze: () => void | Promise<void>;
}

function SurfacedItem({ task, onDone, onDrop, onReframe, onSnooze }: ItemProps) {
  const canSnooze = task.snoozeCount < SNOOZE_CAP;
  return (
    <li className="flex flex-col gap-2">
      <p className="text-base text-neutral-800">{task.title}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-600">
        <button type="button" onClick={onDone} className="hover:text-neutral-900">
          Done
        </button>
        <button type="button" onClick={onDrop} className="hover:text-neutral-900">
          Drop it
        </button>
        <button type="button" onClick={onReframe} className="hover:text-neutral-900">
          Reframe
        </button>
        {canSnooze && (
          <button type="button" onClick={onSnooze} className="hover:text-neutral-900">
            Snooze 3 days
          </button>
        )}
      </div>
    </li>
  );
}
