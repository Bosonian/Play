import { useEffect, useState } from 'react';

/**
 * Ticks roughly every `intervalMs`, returning the current time on each
 * tick. The Runway screen re-derives its whole live projection from this
 * every second (RUNWAY_PLAN.md §4) — the equation itself stays pure
 * (projection.ts takes `now` as an explicit argument), and this hook is the
 * one place that decides *when* a fresh `now` gets produced.
 *
 * That separation is also why this is its own hook rather than a
 * `setInterval` inlined in Runway.tsx: increment 4 adds Wake Lock (keep the
 * screen on while this view is up, RUNWAY_PLAN.md §5.2) and that behaviour
 * belongs right here, next to the ticking, not scattered into the screen
 * component.
 *
 * Pauses the interval while the tab/app is hidden and immediately produces
 * a fresh `now` on return to visibility — cheap (one extra event listener)
 * and avoids ticking a screen nobody can see, per the increment-2 spec's
 * performance note.
 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;

    function start() {
      if (intervalId !== undefined) return;
      intervalId = setInterval(() => setNow(new Date()), intervalMs);
    }

    function stop() {
      if (intervalId === undefined) return;
      clearInterval(intervalId);
      intervalId = undefined;
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        stop();
      } else {
        setNow(new Date());
        start();
      }
    }

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [intervalMs]);

  return now;
}
