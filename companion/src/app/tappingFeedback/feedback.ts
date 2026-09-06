import type { TapTarget } from '../../domain/tapping';

export const TAPPING_FEEDBACK_FLASH_MS = 100;
export interface TappingFlashState { a: boolean; b: boolean }
export interface TappingFeedbackPorts<T> {
  setFlash: (state: TappingFlashState) => void;
  requestHaptic: (requestedAtEpochMs: number) => void | Promise<unknown>;
  setTimer: (callback: () => void, delayMs: number) => T;
  clearTimer: (timer: T) => void;
}
export interface TappingFeedbackController {
  acknowledge: (result: 'recorded' | 'ignored' | 'interrupted', target: TapTarget | 'outside', at: number) => boolean;
  reset: () => void;
  dispose: () => void;
}

export function createTappingFeedbackController<T>(ports: TappingFeedbackPorts<T>): TappingFeedbackController {
  const active: TappingFlashState = { a: false, b: false };
  const timers: Partial<Record<TapTarget, T>> = {};
  let disposed = false;
  const publish = () => ports.setFlash({ ...active });
  const clear = () => {
    (['a', 'b'] as const).forEach((target) => {
      const timer = timers[target];
      if (timer !== undefined) ports.clearTimer(timer);
      delete timers[target];
      active[target] = false;
    });
  };
  return {
    acknowledge(result, target, at) {
      if (disposed || result !== 'recorded' || target === 'outside') return false;
      const previous = timers[target];
      if (previous !== undefined) ports.clearTimer(previous);
      active[target] = true;
      publish();
      timers[target] = ports.setTimer(() => {
        delete timers[target];
        if (disposed) return;
        active[target] = false;
        publish();
      }, TAPPING_FEEDBACK_FLASH_MS);
      try {
        const request = ports.requestHaptic(at);
        if (request && typeof request.then === 'function') void request.catch(() => undefined);
      } catch { /* Feedback cannot affect acquisition. */ }
      return true;
    },
    reset() { if (!disposed) { clear(); publish(); } },
    dispose() { clear(); disposed = true; },
  };
}
