import type { Screen } from '../App';

// Module-scoped ref to App's setScreen. Ordinary React state (App.tsx's
// `useState<Screen>`) is only reachable from inside the component tree —
// but the notification-tap listener (src/native/notifications.ts) is
// registered in main.tsx, before React has even rendered, so it can catch a
// cold-start tap as early as possible (see the comment on
// registerNotificationNavigation for why "as early as possible" matters
// here). That means a tap can arrive before App has mounted and handed us
// its setScreen. This module is the escape hatch for both halves of that
// gap: App registers its setter here on mount and clears it on unmount
// (there's only ever one App instance, so "the current setter" is
// unambiguous); navigateToDeparture() either uses it immediately or, if
// it's not there yet, remembers the one pending navigation and replays it
// the moment App does register. Deliberately just this one pending slot,
// not a general event queue — there's exactly one caller (a tapped
// notification) and at most one departure can be "the one that was tapped
// before the app finished booting".
let navigate: ((screen: Screen) => void) | null = null;
let pendingDepartureId: string | null = null;

export function setNavigationRef(fn: ((screen: Screen) => void) | null): void {
  navigate = fn;
  if (fn && pendingDepartureId) {
    const departureId = pendingDepartureId;
    pendingDepartureId = null;
    fn({ name: 'runway', departureId });
  }
}

/** Called by the notification-tap listener. Navigates immediately if the app
 * has already mounted; otherwise queues the one pending navigation for App
 * to replay on mount (the cold-start race). */
export function navigateToDeparture(departureId: string): void {
  if (navigate) {
    navigate({ name: 'runway', departureId });
  } else {
    pendingDepartureId = departureId;
  }
}
