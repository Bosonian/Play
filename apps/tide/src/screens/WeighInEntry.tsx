import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { db } from '../db/db';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { ScreenHeader } from '../ui/ScreenHeader';
import { TextField } from '../ui/TextField';
import { logEvent } from '../lib/eventLog';
import { hapticImpact } from '../native/haptics';

interface WeighInEntryProps {
  onNavigate: (screen: Screen) => void;
}

/** A weigh-in taken more than this many kg from a sane human adult range is
 * almost certainly a typo (a stray digit, a decimal point in the wrong
 * place) — not a hard validation limit, just enough to catch the obvious
 * fat-fingered case before it corrupts the trend. Generously wide on
 * purpose: this app has no business second-guessing a real number inside
 * this range. */
const PLAUSIBLE_WEIGHT_KG: [number, number] = [30, 300];

/**
 * The manual weigh-in form — increment 1's only way to add a WeighIn row
 * (Health Connect's automatic path is increment 3). Local-draft state,
 * same pattern as every form in apps/runway (DepartureSetup, ExamSetup...):
 * a half-typed number shouldn't write to Dexie character by character.
 *
 * Weight uses a plain TextField with `inputMode="decimal"`, not the copied
 * NumberField primitive — NumberField parses with `parseInt`, which would
 * silently truncate "98.4" to 98. A decimal-aware field is a two-line
 * `parseFloat` here rather than a second copied-and-modified primitive
 * for one call site; if a second decimal field shows up in a later
 * increment, that's the moment to promote this into a shared component.
 */
export function WeighInEntry({ onNavigate }: WeighInEntryProps) {
  const [weightDraft, setWeightDraft] = useState('');
  const [bodyFatDraft, setBodyFatDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  function clearDraft() {
    setWeightDraft('');
    setBodyFatDraft('');
    setError(null);
  }

  // Esc-to-clear (CLAUDE.md's keyboard-shortcut guidance: "Enter to
  // submit, Esc to clear" — Enter's half is the <form>'s native submit
  // behaviour, needing no handler of its own).
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape') clearDraft();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const weightKg = Number.parseFloat(weightDraft.replace(',', '.'));
    if (Number.isNaN(weightKg) || weightKg < PLAUSIBLE_WEIGHT_KG[0] || weightKg > PLAUSIBLE_WEIGHT_KG[1]) {
      setError('Enter a weight in kg.');
      return;
    }

    let bodyFatPct: number | null = null;
    if (bodyFatDraft.trim() !== '') {
      const parsed = Number.parseFloat(bodyFatDraft.replace(',', '.'));
      if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
        setError('Body fat, if entered, must be a percentage between 0 and 100.');
        return;
      }
      bodyFatPct = parsed;
    }

    await db.weighIns.add({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      weightKg,
      bodyFatPct,
      source: 'manual',
    });
    // toFixed(1), not the raw draft string — the log should read the same
    // rounded number Home/History's own display shows, not a leftover
    // dictation artifact from what was typed (e.g. "98.40" or "98,4").
    void logEvent('weighin', `Weigh-in logged: ${weightKg.toFixed(1)} kg.`);
    // Haptic-on-save (increment 6 polish): saving previously gave no
    // acknowledgement at all, and the trend's EMA barely moves on any one
    // reading — so a save could feel like nothing happened. One light tap
    // is the calm, non-gamified confirmation; see native/haptics.ts's own
    // comment for why this never throws.
    void hapticImpact('light');

    onNavigate({ name: 'home' });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Add weigh-in" onBack={() => onNavigate({ name: 'home' })} />
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} onKeyDown={handleKeyDown} className="flex flex-col gap-4">
        <TextField
          label="Weight (kg)"
          type="text"
          inputMode="decimal"
          autoFocus
          value={weightDraft}
          onChange={(e) => setWeightDraft(e.target.value)}
          placeholder="98.4"
        />
        <TextField
          label="Body fat % (optional)"
          type="text"
          inputMode="decimal"
          value={bodyFatDraft}
          onChange={(e) => setBodyFatDraft(e.target.value)}
          placeholder="From the scale's BIA reading, if it has one"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" className="w-full">
          Save
        </Button>
      </form>
    </div>
  );
}
