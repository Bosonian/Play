import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { TextAction } from '../ui/TextAction';
import { DELETE_CONFIRM_WINDOW_MS, isArmStillValid, isConfirmTooSoon } from '../lib/deleteArm';
import { logEvent } from '../lib/eventLog';
import { hapticImpact } from '../native/haptics';

interface HistoryProps {
  onNavigate: (screen: Screen) => void;
}

/** Runway's own field-tested lesson, carried over verbatim (see its
 * History.tsx / README): "data with no surface reads as lost." A weigh-in
 * saved through WeighInEntry needs somewhere it's visibly there, or the
 * feature might as well not persist it. */
export function History({ onNavigate }: HistoryProps) {
  // Ascending by the indexed `at` field, then reversed in JS — same idiom
  // Runway's own History.tsx uses (see its comment there): Dexie's
  // reverse() doesn't reliably combine with every query shape, and
  // reversing an already-small in-memory array costs nothing worth
  // avoiding it for.
  const weighIns = useLiveQuery(async () => {
    const rows = await db.weighIns.orderBy('at').toArray();
    return rows.reverse();
  }, []);

  // Delete-a-weigh-in increment (6): a bad reading (a misattributed Renpho
  // reading — the scale is multi-user) permanently distorts the trend, this
  // app's whole north star, with no way to fix it before this increment.
  // `expandedId` is which row is showing its "Remove" action; `armedAtMs`
  // is when the FIRST tap on Remove landed for that row, or `null` if
  // nothing is armed. `isArmStillValid` (lib/deleteArm.ts) reads
  // `armedAtMs` against `Date.now()` to decide whether the NEXT tap on the
  // same row's Remove confirms the delete or re-arms it. Only one row at a
  // time: switching to a different row (`handleRowTap`) always disarms
  // whatever was armed, matching this increment's spec ("only ONE row may
  // be expanded/armed at a time").
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [armedAtMs, setArmedAtMs] = useState<number | null>(null);
  // The setTimeout that reverts "Tap again to remove" back to "Remove"
  // after DELETE_CONFIRM_WINDOW_MS even with no second tap — the UI
  // shouldn't sit indefinitely claiming a stray tap will delete something.
  // Cleared on unmount, on collapsing/switching rows, and on a confirmed
  // delete, so it never fires against a row that's no longer armed.
  const armTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (armTimeoutRef.current !== null) clearTimeout(armTimeoutRef.current);
    };
  }, []);

  function clearArmTimeout() {
    if (armTimeoutRef.current !== null) {
      clearTimeout(armTimeoutRef.current);
      armTimeoutRef.current = null;
    }
  }

  function disarm() {
    clearArmTimeout();
    setArmedAtMs(null);
  }

  function handleRowTap(id: string) {
    disarm();
    setExpandedId((current) => (current === id ? null : id));
  }

  function handleRemoveTap(id: string) {
    const now = Date.now();
    if (isArmStillValid(armedAtMs, now)) {
      void performDelete(id);
      return;
    }
    // Too soon after arming to be a second DECISION (review fix, 0.7.1) —
    // this is the back half of one accidental double-tap. Ignore it
    // entirely: returning WITHOUT re-arming is the point, since re-arming
    // would restart the clock and turn a stutter-tap into "the delete just
    // needs one more tap" rather than "that tap didn't count". The row
    // stays armed on its original timer, so a genuine confirm still works.
    if (isConfirmTooSoon(armedAtMs, now)) return;
    setArmedAtMs(now);
    clearArmTimeout();
    armTimeoutRef.current = setTimeout(() => setArmedAtMs(null), DELETE_CONFIRM_WINDOW_MS);
  }

  async function performDelete(id: string) {
    const weighIn = (weighIns ?? []).find((w) => w.id === id);
    disarm();
    setExpandedId(null);
    await db.weighIns.delete(id);
    void hapticImpact('light');
    if (weighIn) {
      // "24 Jul" — day + short month, no year and no time: History's own
      // list already groups by nothing finer than a full date, so a log
      // line naming the exact time would claim more precision than the
      // list itself displays. Deletions must be traceable in the activity
      // log (this increment's spec) since they change the trend — a bare
      // "Weigh-in removed." with no number would leave nothing to trace.
      const dateLabel = new Date(weighIn.at).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
      void logEvent('weighin', `Weigh-in removed: ${weighIn.weightKg.toFixed(1)} kg, ${dateLabel}.`);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="History" onBack={() => onNavigate({ name: 'home' })} />
      </div>

      {weighIns !== undefined && weighIns.length === 0 && (
        <p className="text-slate-400">No weigh-ins yet.</p>
      )}

      <div className="flex flex-col gap-2">
        {(weighIns ?? []).map((weighIn) => {
          const at = new Date(weighIn.at);
          const isExpanded = expandedId === weighIn.id;
          const isArmed = isExpanded && armedAtMs !== null;
          return (
            // A plain bordered <div>, not the <Card> primitive, for this
            // row — Card renders as a single <button> wrapping its whole
            // content, and this row now needs TWO independent tap targets
            // (the row itself, to expand/collapse; "Remove", to arm/
            // confirm). Nesting a <button> (TextAction) inside another
            // <button> (Card) is invalid HTML and unreliable across
            // browsers for click/focus handling, so the row's own tappable
            // area is a plain <button> here, matching Card's visual
            // classes minus the border/background it delegates to this
            // wrapping div instead.
            <div
              key={weighIn.id}
              className="overflow-hidden rounded-xl border border-slate-800/60 bg-surface"
            >
              <button
                type="button"
                onClick={() => handleRowTap(weighIn.id)}
                className="flex min-h-12 w-full items-center justify-between p-4 text-left transition-colors hover:bg-raised/70 active:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                <div className="flex flex-col">
                  <span className="text-slate-100 tabular-nums">{weighIn.weightKg.toFixed(1)} kg</span>
                  <span className="text-sm text-slate-500">
                    {at.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    {' · '}
                    {at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                </div>
                {weighIn.bodyFatPct !== null && (
                  <span className="text-sm text-slate-400 tabular-nums">{weighIn.bodyFatPct.toFixed(1)}% BF</span>
                )}
              </button>
              {isExpanded && (
                <div className="flex justify-end border-t border-slate-800/60 px-4 py-2">
                  {/* Double-tap-guard interaction, mirroring Runway's own
                      StepFocus check-off guard's SHAPE (lib/deleteArm.ts's
                      own header comment has the full precedent/difference
                      reasoning) — not a modal, not immediate: the first tap
                      arms ("Tap again to remove"), the second within
                      DELETE_CONFIRM_WINDOW_MS confirms. onBlur disarms too,
                      so tabbing away from an armed row doesn't leave it
                      silently primed to delete on whatever gets focus next. */}
                  <TextAction onClick={() => handleRemoveTap(weighIn.id)} onBlur={disarm}>
                    {isArmed ? 'Tap again to remove' : 'Remove'}
                  </TextAction>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
