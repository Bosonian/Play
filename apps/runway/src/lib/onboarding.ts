import type { Departure, Setting } from '../db/types';

// First-run onboarding (0.52.0) — pure decisions only, no Dexie handles, so
// every rule here is unit-testable and the screen/App/Home stay thin.
//
// Three different "first time" flags exist in this codebase; do not mix them:
//   - Home's `firstRunDismissed`: native-only permissions/setup card.
//   - guidedPass.ts's `pruefungGuidedDone`: a walkthrough INSIDE Prüfung.
//   - `onboardingDone` (this file): "has a stranger been introduced to what
//     this app is". Nothing else reads or writes it.

/** settings-table key: the row exists (any value) once onboarding was
 * finished OR skipped OR found to be unnecessary (existing data). */
export const ONBOARDING_DONE_KEY = 'onboardingDone';

/** settings-table key: 'true' / 'false' once the person has chosen whether
 * Prüfung is shown. ABSENT is a real third state — see isPruefungEnabled. */
export const PRUEFUNG_ENABLED_KEY = 'pruefungEnabled';

/** Id of the template db.ts's on('populate') handler seeds. Lives here (and
 * is imported by db.ts) so "is this template real user data" and "what did
 * we seed" can never name two different ids. */
export const SEED_TEMPLATE_ID = 'seed-standard-template';

/** The seed template's name — see db.ts for why it changed in 0.52.0. */
export const SEED_TEMPLATE_NAME = 'Leaving home';

/**
 * Starter prep steps. Used twice: by the seed template (db.ts) and as the
 * editable defaults in onboarding step 2. One list so the template a
 * stranger later finds on Home is recognisably the same routine they just
 * edited, rather than two lists that drift apart.
 */
export const STARTER_STEPS: ReadonlyArray<{ name: string; minutes: number }> = [
  { name: 'Get dressed', minutes: 10 },
  { name: 'Pack bag', minutes: 5 },
  { name: 'Shoes and keys', minutes: 5 },
];

export const DEFAULT_TRAVEL_MINUTES = 20;
export const DEFAULT_BUFFER_MINUTES = 10;

/**
 * What "the database looks fresh" is judged on. Plain numbers/booleans, not
 * Dexie handles. `nonSeedTemplateCount` must already EXCLUDE the seed
 * template (the caller counts templates whose id !== SEED_TEMPLATE_ID):
 * a seed template alone is what every fresh install contains, so it is not
 * evidence of use. Tradeoff: someone who edited only the seed template and
 * never planned anything still counts as fresh.
 */
export interface FreshnessFacts {
  departureCount: number;
  taskCount: number;
  hasExam: boolean;
  nonSeedTemplateCount: number;
}

export function looksFresh(facts: FreshnessFacts): boolean {
  return (
    facts.departureCount === 0 &&
    facts.taskCount === 0 &&
    !facts.hasExam &&
    facts.nonSeedTemplateCount === 0
  );
}

/**
 * Whether to show onboarding. Three-state sentinel for `flag`, the same
 * idiom as Home's firstRunSetting (see guidedPass.ts's doc comment for why
 * the naive version fails: db.settings.get() yields `undefined` for a
 * missing row, which is also what useLiveQuery yields while loading):
 *   undefined = still loading  -> false (never flash at an existing user)
 *   null      = loaded, absent -> eligible
 *   row       = decided        -> false
 * `facts` undefined (its own query still loading) also returns false.
 *
 * Returns false for an existing install by construction: any departure,
 * task, exam or non-seed template means not fresh.
 */
export function shouldShowOnboarding(
  flag: Pick<Setting, 'value'> | null | undefined,
  facts: FreshnessFacts | undefined,
): boolean {
  if (flag === undefined || facts === undefined) return false;
  if (flag !== null) return false;
  return looksFresh(facts);
}

/**
 * True when the flag should be written WITHOUT showing anything: an
 * existing install, seen once. Persisting this means that if such a person
 * later deletes everything, they are not welcomed as a stranger. Same
 * loading rules as above.
 */
export function shouldBackfillOnboardingDone(
  flag: Pick<Setting, 'value'> | null | undefined,
  facts: FreshnessFacts | undefined,
): boolean {
  if (flag === undefined || facts === undefined) return false;
  return flag === null && !looksFresh(facts);
}

/**
 * Whether Prüfung is visible. Rule: an explicit choice wins; with no choice
 * recorded, an existing exam means enabled. That second clause is what
 * keeps Deepak's pre-0.52.0 install (exam present, setting row never
 * written) unchanged, and also covers a backup restored onto a new device.
 *
 *   setting undefined or hasExam undefined (loading) -> false. Brief
 *     pop-in for an existing user beats a flash of Prüfung for a stranger.
 *   setting 'true'  -> true
 *   setting 'false' -> false (even if an exam exists: data is kept, the
 *     entry point is hidden)
 *   setting null    -> hasExam
 */
export function isPruefungEnabled(
  setting: Pick<Setting, 'value'> | null | undefined,
  hasExam: boolean | undefined,
): boolean {
  if (setting === undefined || hasExam === undefined) return false;
  if (setting === null) return hasExam;
  return setting.value === 'true';
}

/**
 * The appointment time for a bare HH:mm: today if still at least a minute
 * ahead, otherwise tomorrow. A stranger opening the app at 22:00 and typing
 * 09:00 means tomorrow; asking for a date would be a second field in a
 * two-minute flow. Returns null for malformed input. The screen shows
 * "today" or "tomorrow" explicitly so the guess is never silent.
 */
export function resolveAppointment(timeHHmm: string, now: Date): { at: Date; isTomorrow: boolean } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(timeHHmm);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
  if (at.getTime() > now.getTime() + 60_000) return { at, isTomorrow: false };
  // Calendar-day arithmetic via the Date constructor (not +24h in ms) so a
  // DST change between today and tomorrow cannot shift the wall-clock time.
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hours, minutes, 0, 0);
  return { at: tomorrow, isTomorrow: true };
}

export interface FirstDepartureInput {
  name: string;
  appointmentAt: Date;
  travelMinutes: number;
  steps: { name: string; minutes: number }[];
  now: Date;
  newId: () => string;
}

/**
 * Builds the Departure row for onboarding step 2. Mirrors the CREATE path of
 * DepartureSetup's handleSave (no template, no repeat, status 'planned',
 * originalAppointmentAt equal to appointmentAt). Steps with a blank name are
 * dropped; blank steps never reach the database. `estimateSource` is
 * 'manual': these minutes are the person's own guess (or an accepted
 * default), and estimateBias.ts must be able to tell that from a learned one.
 */
export function buildFirstDeparture(input: FirstDepartureInput): Departure {
  const appointmentIso = input.appointmentAt.toISOString();
  const name = input.name.trim() || 'First departure';
  return {
    id: input.newId(),
    templateId: null,
    name,
    destination: '',
    appointmentAt: appointmentIso,
    originalAppointmentAt: appointmentIso,
    travelMinutes: input.travelMinutes,
    bufferMinutes: DEFAULT_BUFFER_MINUTES,
    steps: input.steps
      .filter((step) => step.name.trim() !== '')
      .map((step) => ({
        id: input.newId(),
        name: step.name.trim(),
        plannedMinutes: step.minutes,
        checkedAt: null,
        estimateSource: 'manual' as const,
      })),
    arrivalSteps: [],
    arrivalWifiSsid: null,
    status: 'planned',
    startedAt: null,
    leftAt: null,
    arrivalResult: null,
    arrivalLateMinutes: null,
    createdAt: input.now.toISOString(),
    scheduledForDate: null,
    wasReplanned: false,
    arrivedAt: null,
  };
}
