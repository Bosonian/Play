import { db } from './db';
import type { PropSeed, SceneSeed, UserProfile } from './types';

// Verbatim from brief §7.1 — edit in Settings (when that screen exists),
// not here. The user will discover which props land and curate accordingly.
const PROP_TITLES: readonly string[] = [
  'The brown hat from Mallorca',
  'The 125cc motorcycle key (just hold it)',
  'The kitchen window with the dry-erase marker',
  'A specific piano piece, even if badly played',
  'The Wispr Flow voice button held for 30 seconds of nonsense',
  'A Malayalam song from your childhood, played out loud',
  'The southwest balcony at any time',
  'A coffee made the slow way, not the fast way',
  "One of Aparna's plants — water it without checking your phone",
  'A blank page and a pen, no goal',
  'The shower with the bathroom door wide open',
  'A specific piece of clothing you save for "special"',
  "The Stuttgart hat shop on Königstraße — go look, don't buy",
  "The bicycle if it's not raining",
  'A book in any language, opened to any page',
];

// Verbatim from brief §7.2.
const SCENE_TITLES: readonly string[] = [
  '20 minutes on the balcony, no phone, just listening',
  'Walk one full lap around the block and notice everything purple',
  'Five minutes at the piano. No goal. Stop when bored.',
  "Read one page of a book in a language that's not English or German",
  'Step outside and look up for 60 seconds',
  'Cook one thing that takes only one pan',
  'Send Aparna one playful message with no context',
  "Find one object in the house that hasn't moved in a year. Move it.",
  'Lie on the floor for 5 minutes, no phone',
  "Voice-dictate a paragraph about anything that's not work",
  'Walk to the closest patch of grass and stand on it',
  'Open one of your "Hand and the Fluid" notebooks. Read one entry. Don\'t add to it.',
  'Make a cup of chai the proper way',
  'Take a single photograph of something boring',
  "15 minutes of piano with a book or score you've never opened",
  'Write one paragraph about one childhood Kerala memory',
  'Do nothing, deliberately, for 10 minutes',
  'Look at exactly one painting online (any painter, any era)',
  'Sit on the balcony and identify three sounds',
  'Touch a leaf, a stone, and a piece of fabric. Notice the differences.',
];

// Frozen per brief §2 — Storyteller / self-Competitor / Kinesthete.
// Brief §11 forbids re-prompting in v1.
const FROZEN_PLAY_PERSONALITY = {
  primary: 'storyteller',
  secondary: 'self_competitor',
  tertiary: 'kinesthete',
} as const;

// First-run seeding. Idempotent: re-running it does not duplicate rows
// because each table is checked for existing entries before inserting.
//
// Wrapped in a single rw transaction so a partial failure (e.g. user closes
// tab mid-seed) does not leave seeds half-inserted — Dexie rolls back on any
// throw inside the txn.
export async function ensureSeeded(): Promise<void> {
  await db.transaction(
    'rw',
    [db.userProfile, db.propSeeds, db.sceneSeeds],
    async () => {
      if ((await db.userProfile.count()) === 0) {
        const profile: UserProfile = {
          id: crypto.randomUUID(),
          playPersonality: { ...FROZEN_PLAY_PERSONALITY },
          reflectionDayOfWeek: 0,
          reflectionTime: '19:00',
          consecutiveSkippedReflections: 0,
          createdAt: new Date().toISOString(),
        };
        await db.userProfile.add(profile);
      }

      if ((await db.propSeeds.count()) === 0) {
        const propSeeds: PropSeed[] = PROP_TITLES.map((title) => ({
          id: crypto.randomUUID(),
          title,
          active: true,
          lastShownAt: null,
        }));
        await db.propSeeds.bulkAdd(propSeeds);
      }

      if ((await db.sceneSeeds.count()) === 0) {
        const sceneSeeds: SceneSeed[] = SCENE_TITLES.map((title) => ({
          id: crypto.randomUUID(),
          title,
          active: true,
          lastShownAt: null,
        }));
        await db.sceneSeeds.bulkAdd(sceneSeeds);
      }
    },
  );
}
