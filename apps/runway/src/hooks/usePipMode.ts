import { useEffect, useState } from 'react';
import { addPipModeChangedListener } from '../native/pip';

/**
 * Whether the app is currently showing as the small PiP pill rather than the
 * full screen — StepFocus.tsx reads this to swap in the compact layout (see
 * that file's own early-return branch). `false` on web/dev and for the
 * whole first render on native, before the listener has actually attached;
 * there is no synchronous way to ask "am I in PiP right now" at mount, only
 * the async listener registered here, so a device that somehow mounted
 * StepFocus already inside PiP would render full-screen for one frame before
 * correcting — not a real path today (PiP is only ever entered FROM this
 * screen while it's already mounted, never the reverse), but worth naming
 * rather than assuming away.
 *
 * `cancelled`, not the returned unsubscribe alone, guards against a
 * StrictMode double-invoke committing a stale listener's setState after the
 * effect has already been torn down and re-run — same shape
 * useLiveTravel.ts's own mount effect uses for its in-flight fetch, applied
 * here to an in-flight `addPipModeChangedListener` registration instead.
 */
export function usePipMode(): boolean {
  const [isInPip, setIsInPip] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void addPipModeChangedListener((next) => {
      if (!cancelled) setIsInPip(next);
    }).then((unsub) => {
      if (cancelled) {
        unsub();
        return;
      }
      unsubscribe = unsub;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return isInPip;
}
