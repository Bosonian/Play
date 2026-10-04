import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { isPruefungEnabled, PRUEFUNG_ENABLED_KEY } from '../lib/onboarding';

/**
 * Whether the Prüfung entry point should be visible. The rule itself (and
 * why an absent row means "enabled" when an exam exists) is
 * isPruefungEnabled in lib/onboarding.ts; this only feeds it the two
 * three-state reads. `?? null` splits "row absent" from "still loading":
 * db.get() and useLiveQuery both yield undefined for the latter, and the
 * naive version cannot tell them apart.
 */
export function usePruefungEnabled(): boolean {
  const setting = useLiveQuery(async () => (await db.settings.get(PRUEFUNG_ENABLED_KEY)) ?? null, []);
  const examCount = useLiveQuery(() => db.exams.count(), []);
  return isPruefungEnabled(setting, examCount === undefined ? undefined : examCount > 0);
}
