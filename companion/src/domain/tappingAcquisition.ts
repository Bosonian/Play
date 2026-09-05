import {
  TAPPING_DURATION_MS,
  analyseTapping,
  type HandSide,
  type TapSample,
  type TapTarget,
  type TappingResult,
} from './tapping';

export type TappingInterruptionReason =
  | 'page-hidden'
  | 'pagehide'
  | 'layout-changed'
  | 'multiple-pointers'
  | 'user-stopped-before-hand';

export interface TappingAcquisition {
  side: HandSide;
  startedAtMs: number;
  deadlineMs: number;
  expectedTarget: TapTarget | null;
  samples: TapSample[];
  interruption?: {
    reason: TappingInterruptionReason;
    atMs: number;
  };
}

export interface TappingTouch {
  atMs: number;
  x: number;
  y: number;
  actualTarget: TapSample['actualTarget'];
  pointerCount: number;
}

export interface FinishedTappingAcquisition {
  outcome: 'completed' | 'interrupted';
  result: TappingResult;
}

export function startTappingAcquisition(side: HandSide, startedAtMs: number): TappingAcquisition {
  return {
    side,
    startedAtMs,
    deadlineMs: startedAtMs + TAPPING_DURATION_MS,
    expectedTarget: null,
    samples: [],
  };
}

export function recordTappingTouch(
  acquisition: TappingAcquisition,
  touch: TappingTouch,
): 'recorded' | 'ignored' | 'interrupted' {
  if (acquisition.interruption) return 'ignored';
  if (touch.atMs >= acquisition.deadlineMs) return 'ignored';
  if (touch.pointerCount > 1) {
    interruptTappingAcquisition(acquisition, 'multiple-pointers', touch.atMs);
    return 'interrupted';
  }

  const expectedTarget = acquisition.expectedTarget;
  acquisition.samples.push({
    atMs: touch.atMs - acquisition.startedAtMs,
    x: touch.x,
    y: touch.y,
    expectedTarget,
    actualTarget: touch.actualTarget,
  });
  if (touch.actualTarget !== 'outside'
      && (expectedTarget === null || touch.actualTarget === expectedTarget)) {
    acquisition.expectedTarget = touch.actualTarget === 'a' ? 'b' : 'a';
  }
  return 'recorded';
}

export function interruptTappingAcquisition(
  acquisition: TappingAcquisition,
  reason: TappingInterruptionReason,
  atMs: number,
): boolean {
  if (acquisition.interruption) return true;
  if (atMs >= acquisition.deadlineMs) return false;
  acquisition.interruption = { reason, atMs };
  return true;
}

export function finishTappingAcquisition(
  acquisition: TappingAcquisition,
  atMs: number,
): FinishedTappingAcquisition | null {
  if (!acquisition.interruption && atMs < acquisition.deadlineMs) return null;

  if (acquisition.interruption) {
    const elapsedMs = Math.max(
      0,
      Math.min(TAPPING_DURATION_MS, acquisition.interruption.atMs - acquisition.startedAtMs),
    );
    return {
      outcome: 'interrupted',
      result: analyseTapping(
        acquisition.side,
        acquisition.samples,
        elapsedMs,
        [acquisition.interruption.reason],
      ),
    };
  }

  return {
    outcome: 'completed',
    // The protocol window ends at the monotonic deadline. Callback lateness
    // does not lengthen the acquisition or make an otherwise valid run fail.
    result: analyseTapping(acquisition.side, acquisition.samples, TAPPING_DURATION_MS),
  };
}
