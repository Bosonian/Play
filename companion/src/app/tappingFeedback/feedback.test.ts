import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTappingFeedbackController,
  TAPPING_FEEDBACK_FLASH_MS,
  type TappingFeedbackPorts,
} from './feedback';

type Timer = ReturnType<typeof setTimeout>;

function createPorts(
  requestHaptic: TappingFeedbackPorts<Timer>['requestHaptic'] = vi.fn(),
) {
  return {
    setFlash: vi.fn(),
    requestHaptic,
    setTimer: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
    clearTimer: vi.fn((timer: Timer) => clearTimeout(timer)),
  } satisfies TappingFeedbackPorts<Timer>;
}

describe('tapping feedback controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flashes the recorded target and requests haptic feedback at the recorded time', () => {
    const ports = createPorts();
    const controller = createTappingFeedbackController(ports);

    expect(controller.acknowledge('recorded', 'a', 1_234)).toBe(true);
    expect(ports.setFlash).toHaveBeenLastCalledWith({ a: true, b: false });
    expect(ports.requestHaptic).toHaveBeenCalledOnce();
    expect(ports.requestHaptic).toHaveBeenCalledWith(1_234);

    vi.advanceTimersByTime(TAPPING_FEEDBACK_FLASH_MS - 1);
    expect(ports.setFlash).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(ports.setFlash).toHaveBeenLastCalledWith({ a: false, b: false });
  });

  it.each([
    ['recorded', 'outside'],
    ['ignored', 'a'],
    ['interrupted', 'b'],
  ] as const)('does not acknowledge %s touches on %s', (result, target) => {
    const ports = createPorts();
    const controller = createTappingFeedbackController(ports);

    expect(controller.acknowledge(result, target, 2_000)).toBe(false);
    expect(ports.setFlash).not.toHaveBeenCalled();
    expect(ports.requestHaptic).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renews a repeated target flash from the most recent recorded touch', () => {
    const ports = createPorts();
    const controller = createTappingFeedbackController(ports);

    controller.acknowledge('recorded', 'a', 1_000);
    vi.advanceTimersByTime(60);
    controller.acknowledge('recorded', 'a', 1_060);

    expect(ports.clearTimer).toHaveBeenCalledOnce();
    expect(ports.requestHaptic).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(40);
    expect(ports.setFlash).toHaveBeenLastCalledWith({ a: true, b: false });

    vi.advanceTimersByTime(60);
    expect(ports.setFlash).toHaveBeenLastCalledWith({ a: false, b: false });
  });

  it('reset clears every target and dispose prevents queued or later feedback', () => {
    const ports = createPorts();
    const controller = createTappingFeedbackController(ports);

    controller.acknowledge('recorded', 'a', 1_000);
    controller.acknowledge('recorded', 'b', 1_001);
    controller.reset();

    expect(ports.clearTimer).toHaveBeenCalledTimes(2);
    expect(ports.setFlash).toHaveBeenLastCalledWith({ a: false, b: false });
    const publishesAfterReset = ports.setFlash.mock.calls.length;

    controller.reset();
    expect(ports.setFlash).toHaveBeenLastCalledWith({ a: false, b: false });
    controller.dispose();
    expect(controller.acknowledge('recorded', 'a', 1_002)).toBe(false);

    vi.runAllTimers();
    expect(ports.setFlash).toHaveBeenCalledTimes(publishesAfterReset + 1);
    expect(ports.requestHaptic).toHaveBeenCalledTimes(2);
  });

  it('keeps acquisition feedback active when haptic requests throw or reject', async () => {
    const syncFailure = createPorts(vi.fn(() => {
      throw new Error('native bridge unavailable');
    }));
    const syncController = createTappingFeedbackController(syncFailure);

    expect(syncController.acknowledge('recorded', 'a', 3_000)).toBe(true);
    expect(syncFailure.setFlash).toHaveBeenLastCalledWith({ a: true, b: false });

    const asyncFailure = createPorts(vi.fn(() => Promise.reject(new Error('native rejection'))));
    const asyncController = createTappingFeedbackController(asyncFailure);

    expect(asyncController.acknowledge('recorded', 'b', 3_001)).toBe(true);
    await Promise.resolve();
    expect(asyncFailure.setFlash).toHaveBeenLastCalledWith({ a: false, b: true });
  });
});
