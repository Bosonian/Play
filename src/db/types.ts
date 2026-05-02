// ISO 8601 timestamp string, e.g. "2026-05-02T11:08:00.000Z".
// Stored as strings (not Date objects) per CLAUDE.md's storage convention.
// Convert to Date only when arithmetic is needed; convert back to ISO for write.
export type ISODateTime = string;

// ISO 8601 date-only string, e.g. "2026-05-02".
export type ISODate = string;

// Frozen per brief §2 (and §11: no re-prompting in v1). Director exists in the
// general framework but is deliberately absent from the seeded profile —
// brief is explicit that the app should not lean into Director mode.
export type PlayPersonalityRole = 'storyteller' | 'self_competitor' | 'kinesthete';

export interface PlayPersonality {
  primary: PlayPersonalityRole;
  secondary: PlayPersonalityRole;
  tertiary: PlayPersonalityRole;
}

export interface UserProfile {
  id: string;
  playPersonality: PlayPersonality;
  // 0 = Sunday, 1 = Monday ... 6 = Saturday. Default 0 per brief §8.
  // Note: this is the only place Sunday-as-0 leaks; the rest of the app uses
  // ISO week (Monday start) per CLAUDE.md.
  reflectionDayOfWeek: number;
  // 24-hour "HH:MM", e.g. "19:00". Default per brief §5.4.
  reflectionTime: string;
  consecutiveSkippedReflections: number;
  createdAt: ISODateTime;
}

export type ReframeMode = 'joker' | 'kinesthete' | 'ninety_second';
export type TaskStatus = 'pending' | 'complete' | 'abandoned';

export interface Task {
  id: string;
  // Current title — post-reframe text if the task was reframed.
  title: string;
  // Original title preserved on reframe so the user can see what they captured.
  originalTitle: string | null;
  reframedAs: ReframeMode | null;
  status: TaskStatus;
  createdAt: ISODateTime;
  completedAt: ISODateTime | null;
  abandonedAt: ISODateTime | null;
  // Capped at 2 per brief §5.3 — enforced at the snooze action site, not in DB.
  snoozeCount: number;
  lastSurfacedAt: ISODateTime | null;
}

export type SceneOutcome = 'done' | 'skipped' | 'rotated' | 'no_response';

export interface DailyScene {
  id: string;
  // Unique date-only string. One row per day, even if skipped (brief §8).
  date: ISODate;
  propTitle: string;
  sceneTitle: string;
  outcome: SceneOutcome;
  rotatedToProp: string | null;
  rotatedToScene: string | null;
}

export interface PropSeed {
  id: string;
  title: string;
  // Booleans aren't IndexedDB-indexable — kept as a TS boolean and filtered in
  // memory. Seed list is small (~15) so this is trivial.
  active: boolean;
  lastShownAt: ISODateTime | null;
}

export interface SceneSeed {
  id: string;
  title: string;
  active: boolean;
  lastShownAt: ISODateTime | null;
}

export interface WeeklyReflection {
  id: string;
  // Monday of the week (ISO week start), per CLAUDE.md "week starts Monday".
  weekStartDate: ISODate;
  didYouPlay: string;
  nextWeekScene: string;
  submittedAt: ISODateTime;
}
