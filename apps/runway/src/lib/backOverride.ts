/**
 * A tiny module-level stack of "something else wants this back gesture"
 * handlers — the escape hatch for overlays that sit ON TOP of a screen
 * (StepFocus, BackdateDialog) rather than being a screen of their own.
 *
 * Why this needs to exist at all: navigation in this app is plain React
 * state (App.tsx's Screen union), and `backTarget.ts` maps EVERY screen to
 * a destination — but StepFocus and BackdateDialog aren't screens. They're
 * overlays a screen renders as a sibling (Runway.tsx's own comment on
 * `focusStepId`: "the overlay is a LENS over this live departure, not a
 * place with its own identity"). A back gesture while one of these is open
 * has to close IT, not navigate the screen underneath — and the native
 * listener (src/native/backGesture.ts) has no way to know an overlay is
 * open unless something tells it. This module is that something: an
 * overlay owner pushes a handler while it's mounted/open, and the back
 * listener checks here FIRST, before ever consulting `backTarget`.
 *
 * Module-level, not React context: the native listener
 * (src/native/backGesture.ts) is registered once in App.tsx, outside any
 * particular screen's component tree, and needs to reach whichever overlay
 * (if any) is currently open regardless of which screen rendered it — the
 * same "escape hatch outside the component tree" reasoning
 * src/lib/navigationRef.ts already documents for cross-tree navigation.
 *
 * A STACK, not a single slot: nothing today nests two overrides at once
 * (StepFocus and BackdateDialog are mutually exclusive per Runway.tsx/
 * TaskRun.tsx's own handoff comments — closing one is what opens the
 * other), but a stack costs nothing extra and means a future nested case
 * doesn't silently clobber an outer override's registration. The TOP of the
 * stack (the most recently pushed, still-registered handler) is always the
 * one a back gesture reaches.
 */
type BackOverrideHandler = () => void;

let overrides: BackOverrideHandler[] = [];

/**
 * Registers `handler` as the new top of the stack. Returns an unregister
 * function that removes THIS specific handler by identity (`filter`, not
 * `pop`) — if a second override was pushed after this one and is still
 * registered when this one unregisters, popping blindly would remove the
 * WRONG entry. In practice every call site unregisters in an effect cleanup
 * keyed to its own overlay closing/unmounting, so the order handlers
 * unregister in doesn't necessarily match the order they were pushed.
 */
export function pushBackOverride(handler: BackOverrideHandler): () => void {
  overrides.push(handler);
  return () => {
    overrides = overrides.filter((h) => h !== handler);
  };
}

/**
 * Called by the native back listener (src/native/backGesture.ts) on every
 * backButton event, before it computes a `backTarget`. If an override is
 * registered, this calls the TOP-most one and returns `true` — the gesture
 * is fully consumed, the caller does nothing else. Returns `false` when the
 * stack is empty, meaning "no overlay wants this, fall through to ordinary
 * screen navigation."
 *
 * Deliberately does NOT unregister the handler it calls — the override
 * stays registered until its owner unregisters it (overlay closed/
 * unmounted), the same way the overlay itself stays open until the OWNER
 * closes it. A second back gesture while the same overlay is still open
 * must consume it again, not fall through to screen navigation because the
 * first gesture silently deregistered it.
 */
export function consumeBackOverride(): boolean {
  if (overrides.length === 0) return false;
  overrides[overrides.length - 1]();
  return true;
}

/** Test-only reset — vitest module state otherwise leaks between test
 * files/cases that both push overrides and never get a real unmount to
 * clean up after themselves. Not imported by any production code path. */
export function _resetBackOverridesForTest(): void {
  overrides = [];
}
