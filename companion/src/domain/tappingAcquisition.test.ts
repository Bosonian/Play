import { describe, expect, it } from 'vitest';
import {
  finishTappingAcquisition,
  interruptTappingAcquisition,
  recordTappingTouch,
  startTappingAcquisition,
} from './tappingAcquisition';

function touch(atMs: number, actualTarget: 'a' | 'b' | 'outside', pointerCount = 1) {
  return { atMs, actualTarget, pointerCount, x: 20, y: 40 };
}

describe('tapping acquisition', () => {
  it('captures [start, deadline), ignores late taps and uses the nominal duration', () => {
    const acquisition = startTappingAcquisition('left', 5_000);

    expect(recordTappingTouch(acquisition, touch(5_000, 'a'))).toBe('recorded');
    expect(recordTappingTouch(acquisition, touch(14_999, 'b'))).toBe('recorded');
    expect(recordTappingTouch(acquisition, touch(15_000, 'a'))).toBe('ignored');
    expect(finishTappingAcquisition(acquisition, 14_999)).toBeNull();

    const finished = finishTappingAcquisition(acquisition, 15_250)!;
    expect(finished.outcome).toBe('completed');
    expect(finished.result.quality).toBe('valid');
    expect(finished.result.features.durationMs).toBe(10_000);
    expect(finished.result.features.attemptedTapCount).toBe(2);
  });

  it('accepts either starting target and advances only after a successful touch', () => {
    const acquisition = startTappingAcquisition('right', 1_000);

    recordTappingTouch(acquisition, touch(1_100, 'b'));
    recordTappingTouch(acquisition, touch(1_200, 'outside'));
    recordTappingTouch(acquisition, touch(1_300, 'b'));
    recordTappingTouch(acquisition, touch(1_400, 'a'));

    expect(acquisition.samples.map((sample) => sample.expectedTarget)).toEqual([null, 'a', 'a', 'a']);
    expect(acquisition.expectedTarget).toBe('b');
    const finished = finishTappingAcquisition(acquisition, 11_000)!;
    expect(finished.result.features.successfulTapCount).toBe(2);
    expect(finished.result.features.alternationErrors).toBe(1);
    expect(finished.result.features.outsideTargetCount).toBe(1);
  });

  it('marks an in-window interruption invalid with its partial elapsed time', () => {
    const acquisition = startTappingAcquisition('left', 2_000);
    recordTappingTouch(acquisition, touch(2_100, 'a'));
    expect(interruptTappingAcquisition(acquisition, 'page-hidden', 4_500)).toBe(true);

    const finished = finishTappingAcquisition(acquisition, 4_500)!;
    expect(finished.outcome).toBe('interrupted');
    expect(finished.result.quality).toBe('invalid');
    expect(finished.result.qualityReasons).toEqual(['page-hidden', 'test-incomplete']);
    expect(finished.result.features.durationMs).toBe(2_500);
  });

  it('treats multitouch as interruption but timer lateness as normal completion', () => {
    const interrupted = startTappingAcquisition('right', 10_000);
    expect(recordTappingTouch(interrupted, touch(10_300, 'a', 2))).toBe('interrupted');
    expect(finishTappingAcquisition(interrupted, 10_300)?.outcome).toBe('interrupted');

    const completed = startTappingAcquisition('right', 10_000);
    expect(recordTappingTouch(completed, touch(20_000, 'a', 2))).toBe('ignored');
    expect(interruptTappingAcquisition(completed, 'layout-changed', 20_001)).toBe(false);
    expect(finishTappingAcquisition(completed, 20_001)?.result.quality).toBe('valid');
  });
});
