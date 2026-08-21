import type { Screen } from '../App';

/**
 * Where a back gesture (or the hardware back button — see
 * src/native/backGesture.ts) should land for a given screen. NOT a
 * standalone decision: every branch below is a mirror of that same screen's
 * own ScreenHeader `onBack` handler (or, for `report`, its own `backTarget`
 * local — see ReportProblem.tsx), verified against the source rather than
 * re-derived from first principles, so the back gesture and the on-screen
 * back chevron can never quietly disagree about where "back" means.
 *
 * `null` means "there is nowhere left to go back TO" — only `home`, the
 * root screen with no ScreenHeader/back chevron of its own. The caller
 * (registerBackGesture) is what decides what to do with that (minimize the
 * app, not exit it — see its own doc comment).
 *
 * Exhaustive switch, no `default` — the same never-trick
 * NEXT_MOVE_REASON_LINE (ExamOverview.tsx) already relies on for a
 * discriminated-union lookup: a future Screen variant added to App.tsx's
 * union without a matching case here fails to COMPILE, rather than silently
 * falling through to some default target at runtime.
 */
export function backTarget(screen: Screen): Screen | null {
  switch (screen.name) {
    case 'home':
      return null;

    // Every one of these five mirrors an onBack that always returns to
    // home, regardless of how the screen itself was reached (create vs.
    // edit, prefilled vs. blank) — none of their props change where back
    // points.
    case 'templateEdit':
    case 'departureSetup':
    case 'runway':
    case 'history':
    case 'settings':
    case 'taskSetup':
    case 'task':
      return { name: 'home' };

    // ActivityLog.tsx's own ScreenHeader onBack: always settings, the only
    // place this screen is ever reached from (its "View activity log"
    // TextAction).
    case 'activityLog':
      return { name: 'settings' };

    // Learning.tsx's own ScreenHeader onBack: always history, since that's
    // the only place this screen is ever reached from (see App.tsx's doc
    // comment on the `learning` Screen variant).
    case 'learning':
      return { name: 'history' };

    // exam itself backs to home (ExamOverview.tsx) — everything reached
    // FROM the exam overview backs to it in turn.
    case 'exam':
      return { name: 'home' };
    case 'topicEdit':
    case 'sprintSetup':
    case 'sprint':
    case 'milestoneEdit':
      return { name: 'exam' };

    // ExamSetup.tsx's own onBack: `existing ? exam : home` — `existing` is
    // "an exam was found to edit", which happens whenever `examId` was
    // passed in OR (create-link path) one already existed regardless. This
    // pure function can't replicate the "look for any existing exam" Dexie
    // query ExamSetup does for the omitted-examId case, so it mirrors the
    // simpler, always-correct half of that: examId present means edit means
    // exam; examId omitted is the create path, which backs to home exactly
    // like every other create-only screen above.
    case 'examSetup':
      return screen.examId !== undefined ? { name: 'exam' } : { name: 'home' };

    // ReportProblem.tsx's own local `backTarget`: settings if opened from
    // Settings, home otherwise (including from Home itself, or any future
    // caller that doesn't pass 'settings').
    case 'report':
      return screen.fromScreen === 'settings' ? { name: 'settings' } : { name: 'home' };
  }
}
