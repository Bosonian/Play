/**
 * Generic try/catch wrapper for a render-time computation that must never
 * take a whole screen down with it — built for Learning.tsx's hardening
 * (see that screen's top-of-component invariant comment) but written
 * generically enough for any screen with the same "many independent
 * derived-data sections, one bad one shouldn't blank the rest" shape.
 *
 * `compute` runs; if it throws, `onError` is called with the caller's own
 * `label` (whatever names the section to a human reading a log line) and
 * the caught error, and `fallback` is returned in `compute`'s place — the
 * throw never reaches React's render tree, so a single malformed row of
 * data degrades one section instead of blanking the screen.
 *
 * `onError` is threaded in as a plain callback rather than hardcoded to
 * eventLog.ts's `logEvent` so this stays pure and unit-testable without
 * touching IndexedDB — see safely.test.ts, which passes a mock in its
 * place. The caller decides what "handle this failure" means (log it,
 * count it for a "some data could not be shown" banner, both).
 */
export function safely<T>(
  compute: () => T,
  fallback: T,
  label: string,
  onError: (label: string, err: unknown) => void,
): T {
  try {
    return compute();
  } catch (err) {
    onError(label, err);
    return fallback;
  }
}
