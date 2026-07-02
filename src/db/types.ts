// IndexedDB record types (persisted via Dexie in ./db.ts). Everything is local
// and offline — there is no backend (design doc §11).

import type { Side } from '../content/types';

// The five Bloom rungs a structure can be climbed through (design doc §2b).
export type Rung = 'locate' | 'name' | 'connect' | 'localize' | 'master';
export const RUNGS: Rung[] = [
  'locate',
  'name',
  'connect',
  'localize',
  'master',
];

// ---------------------------------------------------------------------------
// Settings — a single row, id === 'settings'.
// ---------------------------------------------------------------------------
export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  id: 'settings';
  theme: ThemePreference;
  // Daily review is time-capped so a missed week never becomes a wall of due
  // cards (design doc §4a). Minutes, user-adjustable.
  dailyQueueMinutes: number;
  onboardingComplete: boolean;
  // Accessibility overrides (default: follow the OS / off).
  highContrast: boolean;
  reduceMotionOverride: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  theme: 'system',
  dailyQueueMinutes: 15,
  onboardingComplete: false,
  highContrast: false,
  reduceMotionOverride: false,
};

// ---------------------------------------------------------------------------
// SRS cards — SM-2 scheduling state, one per (fact, skin-independent) item.
// The scheduler decides *what* is due; the skin layer decides *how* it's shown
// (design doc §4). Not exercised in Increment 1; defined so Increment 3 fills it.
// ---------------------------------------------------------------------------
export interface SrsCard {
  id: string; // typically the fact id
  factId: string;
  // SM-2 state.
  ease: number; // ease factor, starts ~2.5
  intervalDays: number;
  reps: number;
  lapses: number;
  // ISO-8601 date (YYYY-MM-DD) in Europe/Berlin — the day boundary is fixed to
  // the user's timezone so "due today" is stable offline (design doc §4a).
  dueOn: string;
  lastReviewedOn?: string;
}

// ---------------------------------------------------------------------------
// Mastery — per-structure progression state. `learned` and `retained` bars are
// computed from this + SRS state (design doc §5a). Keyed by structureId.
// ---------------------------------------------------------------------------
export interface RungProgress {
  attempts: number;
  correct: number;
  // The last few results, for the "3 of last 4 correct" unlock rule (§5a).
  recent: boolean[];
}

export interface Mastery {
  structureId: string;
  rungs: Partial<Record<Rung, RungProgress>>;
}

// ---------------------------------------------------------------------------
// Attempt log — one row per answered question. Stats, the weak-spots list, and
// the retention-over-time chart are all views over this table (design doc §9).
// A single append-only log is simpler and more flexible than maintaining
// several derived tables; those are computed on read.
// ---------------------------------------------------------------------------
export interface Attempt {
  id: string; // uuid
  factId: string;
  mode: 'atlas' | 'drill' | 'cases' | 'timeAttack' | 'rideTheTract';
  rung?: Rung;
  correct: boolean;
  // For Cases, localization is multi-axis; record which axes were right.
  axes?: { level: boolean; side: boolean; structure: boolean };
  side?: Side;
  at: string; // ISO-8601 datetime
}

// ---------------------------------------------------------------------------
// Achievements — earned badges. Definition lives in code; this row records the
// unlock. Keyed by achievement id.
// ---------------------------------------------------------------------------
export interface AchievementUnlock {
  id: string;
  unlockedAt: string; // ISO-8601 datetime
}
