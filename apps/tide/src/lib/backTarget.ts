import type { Screen } from '../App';

/**
 * Where a back gesture (or the hardware back button — see
 * src/native/backGesture.ts) should land for a given screen. Ported from
 * apps/runway/src/lib/backTarget.ts, adapted: Tide has no overlay concept
 * (no StepFocus/BackdateDialog equivalent — every `Screen` here is a real,
 * separately-navigable place, never a lens rendered as a sibling of one), so
 * there is no `backOverride.ts` port either — see src/native/backGesture.ts's
 * own header comment for that omission, stated plainly there rather than
 * left as a silent gap.
 *
 * Every branch below mirrors that same screen's own `ScreenHeader onBack`
 * handler (or, for `reportProblem`, its own local back-target logic).
 * ReportProblem.tsx IMPORTS this function rather than recomputing the same
 * `fromScreen === 'settings' ? settings : home` logic inline the way
 * Runway's own ReportProblem.tsx still does (see that screen's own comment
 * there) — a small deliberate improvement on the ported pattern: with one
 * shared source of truth, the on-screen back chevron and a hardware back
 * gesture can never quietly disagree about where "back" means, instead of
 * merely being kept in sync by two hand-verified comments.
 *
 * `null` means "there is nowhere left to go back TO" — only `home`, the
 * root screen with no `ScreenHeader`/back chevron of its own. The caller
 * (`registerBackGesture`) decides what to do with that (minimize the app,
 * not exit it — see its own doc comment).
 *
 * Exhaustive switch, no `default` — a future `Screen` variant added to
 * App.tsx's union without a matching case here fails to COMPILE rather than
 * silently falling through to some default target at runtime. Same
 * never-trick Runway's own backTarget.ts relies on.
 */
export function backTarget(screen: Screen): Screen | null {
  switch (screen.name) {
    case 'home':
      return null;

    // Every one of these five mirrors an onBack that always returns to
    // home, regardless of how the screen itself was reached — none of
    // their own props/state change where back points.
    case 'weighInEntry':
    case 'history':
    case 'settings':
    case 'plateCheckIn':
    case 'platesToday':
      return { name: 'home' };

    // ActivityLog.tsx's own ScreenHeader onBack: always settings, the only
    // place this screen is ever reached from (Settings' "View activity
    // log" TextAction).
    case 'activityLog':
      return { name: 'settings' };

    // ReportProblem.tsx's own back target: settings if opened from
    // Settings, home otherwise (including from Home itself, or any future
    // caller that doesn't pass 'settings').
    case 'reportProblem':
      return screen.fromScreen === 'settings' ? { name: 'settings' } : { name: 'home' };
  }
}
