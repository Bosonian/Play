import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { GyroSample } from './stabilizer';

export type DeviceMotionStatus = 'idle' | 'running' | 'denied' | 'unavailable';

export interface UseDeviceMotionResult {
  status: DeviceMotionStatus;
  // The rAF loop in SteadyRead reads this every frame. It is a ref, not
  // React state, on purpose (SPEC RISK 2): DeviceMotion can fire near
  // 60 times/second, and routing that through setState would re-render the
  // whole screen every frame instead of letting the stabilization transform
  // be written straight to the DOM on the compositor thread.
  latestRef: MutableRefObject<GyroSample | null>;
  requestAndStart: () => Promise<void>;
  stop: () => void;
}

// iOS gates DeviceMotion behind a permission prompt that must originate
// from a real user gesture (RESEARCH.md §6) — hence this being called from
// the Begin button's onClick, never from an effect. Android has no such
// type on DeviceMotionEvent at all, so the permission branch below is
// feature-detected, not platform-sniffed.
interface DeviceMotionEventWithPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

// active=false always tears the listener down (covers Back / unmount / the
// stabilization toggle going off) — see the cleanup effect below.
export function useDeviceMotion(active: boolean): UseDeviceMotionResult {
  const [status, setStatus] = useState<DeviceMotionStatus>('idle');
  const latestRef = useRef<GyroSample | null>(null);
  // Tracks the wall-clock time of the previous event so we can measure a
  // dt ourselves when event.interval is 0/undefined (SPEC RISK 3 — some
  // Android WebViews report interval as 0 rather than omitting it).
  const lastEventTimeRef = useRef<number | null>(null);
  const listenerRef = useRef<((event: DeviceMotionEvent) => void) | null>(null);

  const handleEvent = useCallback((event: DeviceMotionEvent) => {
    const rotation = event.rotationRate;
    if (!rotation) return; // some browsers fire motion events without rotationRate populated

    const now = performance.now();
    let dt = typeof event.interval === 'number' ? event.interval / 1000 : 0;
    if (!dt || dt <= 0) {
      dt = lastEventTimeRef.current === null ? 0 : (now - lastEventTimeRef.current) / 1000;
    }
    lastEventTimeRef.current = now;

    const degToRad = Math.PI / 180;
    latestRef.current = {
      rateXRadS: (rotation.beta ?? 0) * degToRad,
      rateYRadS: (rotation.gamma ?? 0) * degToRad,
      rateZRadS: (rotation.alpha ?? 0) * degToRad,
      dt,
    };
  }, []);

  const stop = useCallback(() => {
    if (listenerRef.current) {
      window.removeEventListener('devicemotion', listenerRef.current);
      listenerRef.current = null;
    }
    lastEventTimeRef.current = null;
    latestRef.current = null;
    setStatus((prev) => (prev === 'running' ? 'idle' : prev));
  }, []);

  const start = useCallback(() => {
    listenerRef.current = handleEvent;
    window.addEventListener('devicemotion', handleEvent);
    setStatus('running');
  }, [handleEvent]);

  const requestAndStart = useCallback(async () => {
    if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) {
      setStatus('unavailable');
      return;
    }

    const DeviceMotionEventCtor = window.DeviceMotionEvent as unknown as DeviceMotionEventWithPermission;
    if (typeof DeviceMotionEventCtor.requestPermission === 'function') {
      // iOS: must be called synchronously from the gesture handler's async
      // chain (no await before this line) — Begin's onClick satisfies that.
      const result = await DeviceMotionEventCtor.requestPermission();
      if (result === 'granted') {
        start();
      } else {
        setStatus('denied');
      }
      return;
    }

    // Android (and any browser without the permission gate): start directly.
    start();
  }, [start]);

  // Tears the listener + rAF-feeding state down whenever `active` goes
  // false, and always on unmount — covers Back, the parent toggling
  // stabilization off, and navigating away mid-session (SPEC named edge
  // case: "no leaked loop").
  useEffect(() => {
    if (!active) {
      stop();
    }
    return () => {
      stop();
    };
    // `stop` is stable across renders (useCallback with no deps that
    // change), so omitting it here doesn't miss updates — only `active`
    // should re-run this effect.
  }, [active, stop]);

  return { status, latestRef, requestAndStart, stop };
}
