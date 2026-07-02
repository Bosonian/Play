// Stats — real progress once there's data (design doc §9). Shows the two
// overall bars, a review/accuracy summary, and a weak-spots list (most-missed
// facts) that turns wrong answers into an attackable target. All derived from
// the local tables; nothing is faked.

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { STRUCTURES, byId } from '../content';
import { computeLearned } from '../engine/progression';
import { tr } from '../lib/text';

// Turn a fact id like "tract:dcml:decussation" into a readable label.
function factLabel(factId: string): string {
  const [kind, id] = factId.split(':');
  if (kind === 'struct' || kind === 'atlas') {
    const s = byId.structure.get(id);
    if (s) return tr(s.name);
  }
  if (kind === 'tract') {
    const t = byId.tract.get(id);
    if (t) return tr(t.name);
  }
  return id ?? factId;
}

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-caption text-fg-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-soft">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-caption tabular-nums text-fg-faint">
        {pct}%
      </span>
    </div>
  );
}

export function Stats() {
  const mastery = useLiveQuery(() => db.mastery.toArray(), [], []);
  const cards = useLiveQuery(() => db.srsCards.toArray(), [], []);
  const attempts = useLiveQuery(() => db.attempts.toArray(), [], []);

  const hasData = (attempts?.length ?? 0) > 0;

  // Overall learned: mean climbed-rung fraction across authored structures.
  const masteryMap = new Map((mastery ?? []).map((m) => [m.structureId, m]));
  const learned =
    STRUCTURES.reduce((sum, s) => sum + computeLearned(masteryMap.get(s.id)), 0) /
    Math.max(STRUCTURES.length, 1);

  // Overall retained: mean interval maturity across cards (21d = fully mature).
  const retained =
    (cards ?? []).reduce((sum, c) => sum + Math.min(c.intervalDays / 21, 1), 0) /
    Math.max(cards?.length ?? 0, 1);

  const reviews = attempts?.length ?? 0;
  const correct = (attempts ?? []).filter((a) => a.correct).length;
  const accuracy = reviews ? Math.round((correct / reviews) * 100) : 0;

  // Weak spots: most-missed facts.
  const wrongByFact = new Map<string, number>();
  for (const a of attempts ?? []) {
    if (!a.correct) wrongByFact.set(a.factId, (wrongByFact.get(a.factId) ?? 0) + 1);
  }
  const weakSpots = [...wrongByFact.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (!hasData) {
    return (
      <div className="flex h-full flex-col px-4 pt-3">
        <h1 className="text-title font-semibold text-fg">Stats</h1>
        <div className="mt-8">
          <p className="text-body-lg text-fg">Nothing measured yet.</p>
          <p className="mt-1 text-body text-fg-muted">
            Your first review sets the baseline.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 pt-3">
      <h1 className="text-title font-semibold text-fg">Stats</h1>

      <div className="mt-6 space-y-3">
        <Bar label="Learned" value={learned} />
        <Bar label="Retained" value={retained} />
      </div>

      <div className="mt-6 flex gap-3">
        <div className="flex-1 rounded-md border border-line bg-surface p-3">
          <p className="text-caption text-fg-faint">Reviews</p>
          <p className="text-title font-semibold tabular-nums text-fg">{reviews}</p>
        </div>
        <div className="flex-1 rounded-md border border-line bg-surface p-3">
          <p className="text-caption text-fg-faint">Accuracy</p>
          <p className="text-title font-semibold tabular-nums text-fg">{accuracy}%</p>
        </div>
      </div>

      {weakSpots.length > 0 && (
        <section className="mt-6">
          <p className="text-caption font-medium uppercase tracking-wide text-fg-faint">
            Weak spots
          </p>
          <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-surface">
            {weakSpots.map(([factId, misses]) => (
              <li
                key={factId}
                className="flex items-center justify-between px-3 py-2.5"
              >
                <span className="text-body text-fg">{factLabel(factId)}</span>
                <span className="text-caption text-incorrect">
                  missed {misses}×
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
