import { db } from '../db/db';

// The first-run setup nudge (increment 11) — TIDE_PLAN.md's own roadmap
// treats Health Connect and the daily-shape target as opt-in features
// (Settings' own copy for both is descriptive, not urging), but a fresh
// install has NOTHING pointing at either one — Deepak only found them
// because he was told. This file owns just the DECISION ("does the card
// have anything to say") and the durable dismissal flag; Home.tsx owns the
// actual Dexie reads for what's missing (HEALTH_CONNECT_ENABLED_SETTING,
// DAILY_SHAPE_TARGET_SETTING) and the rendering, same "pure logic here,
// live reads at the call site" split every other lib file in this app
// follows (see healthSettings.ts/dailyShapeSettings.ts).

/** Persisted once "Dismiss" is tapped on Home's setup card. DURABLE, not
 * session-only — unlike the update card's `dismissedUpdateVersions`
 * (Home.tsx, an in-memory Set that resets on every app open): a new app
 * version is genuinely new information worth re-surfacing next launch, but
 * "Deepak chose not to connect Health Connect / set a daily shape right
 * now" doesn't become stale the same way. CLAUDE.md's no-nagging rule reads
 * as "dismissing hides it permanently" here — Settings remains the durable
 * path to both features either way, so nothing is actually lost by staying
 * quiet. Same present-but-empty-string-not-a-deleted-row idiom as
 * `DAILY_SHAPE_TARGET_SETTING`/`MOVEMENT_STEP_SOURCES_SETTING`; here it's
 * simpler still, `'true'` or absent, matching `HEALTH_CONNECT_ENABLED_SETTING`'s
 * own boolean-flag shape. No un-dismiss path exists anywhere in this app's
 * UI — there's nothing to wire one to. */
export const SETUP_PROMPT_DISMISSED_SETTING = 'setupPromptDismissed';

/** What the card needs to know to decide whether it has anything left to
 * say — deliberately just two booleans, not the settings rows themselves,
 * so `shouldShowSetupPrompt` stays a plain, fixture-testable decision with
 * no Dexie import of its own. */
export interface SetupPromptInputs {
  healthConnectMissing: boolean;
  dailyShapeMissing: boolean;
}

/**
 * `false` once dismissed — permanently, regardless of what's still
 * missing, per `SETUP_PROMPT_DISMISSED_SETTING`'s own doc comment — and
 * `false` once BOTH steps are done, the ordinary "nothing left to nudge
 * about" path every install is expected to reach. `true` only while at
 * least one step is outstanding AND the card hasn't been dismissed.
 */
export function shouldShowSetupPrompt(inputs: SetupPromptInputs, dismissed: boolean): boolean {
  if (dismissed) return false;
  return inputs.healthConnectMissing || inputs.dailyShapeMissing;
}

/** The one write path "Dismiss" calls. */
export async function dismissSetupPrompt(): Promise<void> {
  await db.settings.put({ key: SETUP_PROMPT_DISMISSED_SETTING, value: 'true' });
}
