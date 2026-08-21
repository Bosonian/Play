import { formatTime } from './format';

// Witness increment (0.34.0): pure message builders for the one-tap
// "tell a real person" share. No infrastructure — these functions only
// build the TEXT that goes into the OS share sheet (src/native/shareText.ts
// sends it); nothing here ever transmits anything itself, and nothing here
// is called from an abandon path (see Sprint.tsx/TaskRun.tsx's own comments
// at their abandoned-state sites for why: a witness ritual is start and
// finish, never confession — CLAUDE.md's anti-shame rule).

/** "unit" / "units" — the one pluralization every message below needs. */
function pluralUnit(count: number): string {
  return count === 1 ? 'unit' : 'units';
}

/**
 * "Starting: 50 min on Neuroanatomy. I'll report back at 20:15." —
 * `reportAt` is computed by the CALLER (now + plannedMinutes), not derived
 * here, so this stays a pure function of its inputs rather than reaching
 * for the system clock itself (same `now`-as-argument discipline as
 * projection.ts/examProjection.ts throughout this app).
 */
export function sprintStartMessage(topicName: string, plannedMinutes: number, reportAt: Date): string {
  return `Starting: ${plannedMinutes} min on ${topicName}. I'll report back at ${formatTime(reportAt)}.`;
}

/** "Done: 50 min on Neuroanatomy." */
export function sprintDoneMessage(topicName: string, actualMinutes: number): string {
  return `Done: ${actualMinutes} min on ${topicName}.`;
}

/**
 * "Starting: Befunden EEG, 5 units. I'll report by 16:00." (deadline set) or
 * "Starting: Befunden EEG, 5 units, about 75 min." (no deadline) — mirrors
 * TaskRun.tsx's own deadline-vs-deadline-less branch (taskDeadlineResult),
 * since a task either has a real target to report against or it doesn't.
 */
export function taskStartMessage(
  name: string,
  unitCount: number,
  deadline: Date | null,
  plannedTotalMinutes: number,
): string {
  const unitPart = `${unitCount} ${pluralUnit(unitCount)}`;
  if (deadline !== null) {
    return `Starting: ${name}, ${unitPart}. I'll report by ${formatTime(deadline)}.`;
  }
  return `Starting: ${name}, ${unitPart}, about ${plannedTotalMinutes} min.`;
}

/** "Done: Befunden EEG — 5 units · 75 min." — mirrors the done summary's
 * own "N units · M min." phrasing (TaskRun.tsx's task.status === 'done'
 * branch) verbatim, so the shared message and the on-screen number never
 * read as two different accounts of the same work. */
export function taskDoneMessage(name: string, unitCount: number, actualTotalMinutes: number): string {
  return `Done: ${name} — ${unitCount} ${pluralUnit(unitCount)} · ${actualTotalMinutes} min.`;
}
